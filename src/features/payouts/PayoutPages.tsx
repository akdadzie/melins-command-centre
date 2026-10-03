import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Dialog } from '../../components/Dialog'
import { Money, PromptDialog, StatusBadge, Tabs, useAction } from '../../components/ui'
import { formatDate, formatMoney, parseMoney } from '../../lib/format'
import { db, supabase } from '../../lib/supabase'
import { expenses as expensesResource, statutoryLines } from '../../resources/definitions'
import { lookups } from '../../resources/lookups'
import { ResourceList } from '../../resources/ResourceList'
import { fetchLookupRows, friendlyError } from '../../resources/useLookups'
import { PayoutActions, ReviewActions } from './PayoutActions'

type Status = 'prepared' | 'approved' | 'paid' | 'cancelled' | 'all'

function statusTabs(rows: { status: string }[]) {
  const c = (s: string) => rows.filter((r) => r.status === s).length
  return [{ key: 'prepared' as Status, label: 'To approve', count: c('prepared') }, { key: 'approved' as Status, label: 'To pay', count: c('approved') },
    { key: 'paid' as Status, label: 'Paid' }, { key: 'cancelled' as Status, label: 'Cancelled' }, { key: 'all' as Status, label: 'All' }]
}

function useRefresh(keys: string[]) {
  const qc = useQueryClient()
  return async () => { for (const k of keys) await qc.invalidateQueries({ queryKey: [k] }) }
}

// ---------------------------------------------------------------------------
// Supplier payments (brief §7.5): settle supplier bills; WHT at the supplier's rate
// ---------------------------------------------------------------------------
async function listPaymentsOut() {
  const { data, error } = await supabase.from('payments_out').select('*, supplier:suppliers(name), job:jobs(job_number)')
    .order('created_at', { ascending: false }).limit(2000)
  if (error) throw error
  return data
}

export function PaymentsOutPage() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  const { data = [], isLoading, error } = useQuery({ queryKey: ['payments_out'], queryFn: listPaymentsOut })
  const [tab, setTab] = useState<Status>(role === 'owner' ? 'prepared' : 'approved')
  const [creating, setCreating] = useState(false)
  const rows = data.filter((r) => tab === 'all' || r.status === tab)
  const openId = params.get('id')
  return (
    <section>
      <header className="page-header">
        <div><h1>Payments out</h1><p className="muted">Supplier and subcontractor payments: prepared by Admin, approved by the Owner, then paid. Record the bill first under <Link to="/expenses">Expenses</Link> ("Supplier bill (pay later)").</p></div>
        <div className="actions">{canWrite(role) && ['owner', 'accountant', 'admin'].includes(role ?? '') && <button className="primary" onClick={() => setCreating(true)}>+ Prepare a payment</button>}</div>
      </header>
      <Tabs value={tab} onChange={setTab} tabs={statusTabs(data)} />
      {error && <p className="form-error">{friendlyError(error as Error)}</p>}
      {isLoading ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="empty">Nothing here.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Supplier</th><th>For</th><th className="num">Gross</th><th className="num">WHT</th><th className="num">Net paid</th><th>Paid</th><th>Status</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => setParams({ id: p.id })}>
              <td>{p.supplier?.name}</td><td>{p.description}{p.job && <span className="muted"> · {p.job.job_number}</span>}</td>
              <td><Money value={p.gross_amount} /></td><td><Money value={p.wht_amount} /></td><td><Money value={p.net_amount} /></td>
              <td>{formatDate(p.status === 'paid' ? p.payment_date : null)}</td><td><StatusBadge status={p.status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {creating && <NewPaymentOut onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setParams({ id }) }} />}
      {openId && <PaymentOutDetail id={openId} onClose={() => setParams({})} />}
    </section>
  )
}

function NewPaymentOut({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const suppliers = useQuery({ queryKey: ['lookup', 'suppliers'], queryFn: () => fetchLookupRows(lookups.supplier) })
  const jobs = useQuery({ queryKey: ['lookup', 'jobs'], queryFn: () => fetchLookupRows(lookups.job) })
  const [supplier, setSupplier] = useState('')
  const [job, setJob] = useState('')
  const [description, setDescription] = useState('')
  const action = useAction()
  const refresh = useRefresh(['payments_out'])
  function submit(e: FormEvent) {
    e.preventDefault()
    action.run(async () => {
      const { data, error } = await db.from('payments_out').insert({ supplier_id: supplier, job_id: job || null, description }).select('id').single()
      if (error) return friendlyError(error)
      await refresh(); onCreated(data.id)
    })
  }
  return (
    <Dialog title="Prepare a payment" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>Supplier<select value={supplier} onChange={(e) => setSupplier(e.target.value)} required>
          <option value="">Choose…</option>{(suppliers.data ?? []).map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}
        </select></label>
        <label>Job (optional)<select value={job} onChange={(e) => setJob(e.target.value)}>
          <option value="">—</option>{(jobs.data ?? []).map((j) => <option key={String(j.id)} value={String(j.id)}>{lookups.job.label(j)}</option>)}
        </select></label>
        <label>What it's for<input value={description} onChange={(e) => setDescription(e.target.value)} required /></label>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Next: choose the bills</button></div>
      </form>
    </Dialog>
  )
}

function PaymentOutDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { role } = useAuth()
  const refresh = useRefresh(['payments_out', 'payment_out', 'payment_items', 'bills_open'])
  const payment = useQuery({ queryKey: ['payment_out', id], queryFn: async () =>
    (await supabase.from('payments_out').select('*, supplier:suppliers(name)').eq('id', id).maybeSingle()).data })
  const p = payment.data
  const items = useQuery({ queryKey: ['payment_items', id], queryFn: async () =>
    (await supabase.from('payment_out_items').select('id, amount, expense:expenses(id, description, expense_date, amount)').eq('payment_out_id', id)).data ?? [] })
  const bills = useQuery({ queryKey: ['bills_open', p?.supplier_id], enabled: !!p, queryFn: async () =>
    (await supabase.from('supplier_bills_open').select('*').eq('supplier_id', p!.supplier_id)).data ?? [] })
  const action = useAction()
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  if (!p) return <Dialog title="Payment" onClose={onClose}><p className="muted">{payment.isLoading ? 'Loading…' : 'Not found.'}</p></Dialog>
  const editable = p.status === 'prepared' && canWrite(role)
  const onItem = new Set<string | null | undefined>((items.data ?? []).map((i) => i.expense?.id))

  return (
    <Dialog title={`Payment to ${p.supplier?.name}`} onClose={onClose}>
      <p>{p.description}</p>
      <table className="totals"><tbody>
        <tr><td>Gross (bills settled)</td><td className="num"><Money value={p.gross_amount} /></td></tr>
        <tr><td>WHT deducted ({Math.round(Number(p.wht_rate) * 10000) / 100}%)</td><td className="num">−<Money value={p.wht_amount} /></td></tr>
        <tr className="grand"><td>Net to pay</td><td className="num"><Money value={p.net_amount} strong /></td></tr>
      </tbody></table>
      <PayoutActions table="payments_out" row={p} onChanged={refresh} />

      <h3>Bills this payment settles</h3>
      <div className="table-wrap"><table className="compact">
        <thead><tr><th>Bill</th><th>Date</th><th className="num">Paying</th>{editable && <th />}</tr></thead>
        <tbody>
          {(items.data ?? []).map((i) => (
            <tr key={i.id}><td>{i.expense?.description}</td><td>{formatDate(i.expense?.expense_date)}</td><td><Money value={i.amount} /></td>
              {editable && <td><button className="link" onClick={() => action.run(async () => {
                const { error } = await supabase.from('payment_out_items').delete().eq('id', i.id)
                if (error) return friendlyError(error)
                await refresh()
              })}>Remove</button></td>}</tr>
          ))}
          {(items.data ?? []).length === 0 && <tr><td colSpan={4} className="muted">No bills yet.</td></tr>}
        </tbody>
      </table></div>
      {editable && (
        <>
          <h3>Open bills from {p.supplier?.name}</h3>
          {(bills.data ?? []).filter((b) => !onItem.has(b.id)).length === 0 ? <p className="muted small">None open. Record the bill under Expenses as a supplier bill.</p> : (
            <div className="table-wrap"><table className="compact">
              <thead><tr><th>Bill</th><th>Date</th><th className="num">Still owed</th><th>Pay now</th><th /></tr></thead>
              <tbody>{(bills.data ?? []).filter((b) => !onItem.has(b.id)).map((b) => (
                <tr key={b.id!}>
                  <td>{b.description}</td><td>{formatDate(b.expense_date)}</td><td><Money value={b.outstanding} /></td>
                  <td><input inputMode="decimal" style={{ maxWidth: 130 }} value={amounts[b.id!] ?? String(b.outstanding)} onChange={(e) => setAmounts({ ...amounts, [b.id!]: e.target.value })} /></td>
                  <td><button disabled={action.busy} onClick={() => action.run(async () => {
                    const amount = parseMoney(amounts[b.id!] ?? String(b.outstanding))
                    if (!amount || amount <= 0) return 'Enter the amount to pay'
                    const { error } = await supabase.from('payment_out_items').insert({ payment_out_id: id, expense_id: b.id!, amount })
                    if (error) return friendlyError(error)
                    await refresh()
                  })}>Add</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      {action.error && <p className="form-error">{action.error}</p>}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Staff payments: reimbursing approved out-of-pocket claims
// ---------------------------------------------------------------------------
async function listStaffPayments() {
  const { data, error } = await supabase.from('staff_payments').select('*, staff:staff(full_name)').order('created_at', { ascending: false }).limit(2000)
  if (error) throw error
  return data
}

export function StaffPaymentsPage() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  const { data = [], isLoading } = useQuery({ queryKey: ['staff_payments'], queryFn: listStaffPayments })
  const [tab, setTab] = useState<Status>(role === 'owner' ? 'prepared' : 'approved')
  const [creating, setCreating] = useState(false)
  const rows = data.filter((r) => tab === 'all' || r.status === tab)
  const openId = params.get('id')
  return (
    <section>
      <header className="page-header">
        <div><h1>Staff payments</h1><p className="muted">Reimbursing out-of-pocket claims once their approver has approved them. Per diems arrive in Phase B.</p></div>
        <div className="actions">{canWrite(role) && ['owner', 'accountant', 'admin'].includes(role ?? '') && <button className="primary" onClick={() => setCreating(true)}>+ Prepare a reimbursement</button>}</div>
      </header>
      <Tabs value={tab} onChange={setTab} tabs={statusTabs(data)} />
      {isLoading ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="empty">Nothing here.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Staff member</th><th className="num">Amount</th><th>Paid</th><th>Status</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => setParams({ id: p.id })}>
              <td>{p.staff?.full_name}{p.is_to_owner && <span className="badge badge-warn">to the Owner</span>}</td>
              <td><Money value={p.amount} /></td><td>{formatDate(p.status === 'paid' ? p.payment_date : null)}</td><td><StatusBadge status={p.status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {creating && <NewStaffPayment onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setParams({ id }) }} />}
      {openId && <StaffPaymentDetail id={openId} onClose={() => setParams({})} />}
    </section>
  )
}

function NewStaffPayment({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const claims = useQuery({ queryKey: ['approved-claims'], queryFn: async () =>
    (await supabase.from('expenses').select('staff_id, amount, staff:staff(full_name)').eq('payment_source', 'staff_out_of_pocket')
      .eq('reimbursement_status', 'approved').is('staff_payment_id', null)).data ?? [] })
  const byStaff = new Map<string, { name: string; total: number; n: number }>()
  for (const c of claims.data ?? []) {
    const cur = byStaff.get(c.staff_id!) ?? { name: c.staff?.full_name ?? '', total: 0, n: 0 }
    cur.total += Number(c.amount); cur.n += 1
    byStaff.set(c.staff_id!, cur)
  }
  const action = useAction()
  const refresh = useRefresh(['staff_payments'])
  return (
    <Dialog title="Prepare a reimbursement" onClose={onClose}>
      {byStaff.size === 0 ? <p className="empty">No approved claims waiting to be paid.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Staff member</th><th>Claims</th><th className="num">Total</th><th /></tr></thead>
          <tbody>{[...byStaff.entries()].map(([staffId, s]) => (
            <tr key={staffId}><td>{s.name}</td><td>{s.n}</td><td><Money value={s.total} /></td>
              <td><button className="primary" disabled={action.busy} onClick={() => action.run(async () => {
                const { data, error } = await supabase.from('staff_payments').insert({ staff_id: staffId }).select('id').single()
                if (error) return friendlyError(error)
                const { error: e2 } = await supabase.from('expenses').update({ staff_payment_id: data.id })
                  .eq('staff_id', staffId).eq('reimbursement_status', 'approved').is('staff_payment_id', null)
                if (e2) return friendlyError(e2)
                await refresh(); onCreated(data.id)
              })}>Prepare</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {action.error && <p className="form-error">{action.error}</p>}
    </Dialog>
  )
}

function StaffPaymentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const refresh = useRefresh(['staff_payments', 'staff_payment', 'staff_payment_claims', 'approved-claims'])
  const payment = useQuery({ queryKey: ['staff_payment', id], queryFn: async () =>
    (await supabase.from('staff_payments').select('*, staff:staff(full_name)').eq('id', id).maybeSingle()).data })
  const claims = useQuery({ queryKey: ['staff_payment_claims', id], queryFn: async () =>
    (await supabase.from('expenses').select('id, expense_date, description, amount').eq('staff_payment_id', id).order('expense_date')).data ?? [] })
  const action = useAction()
  const p = payment.data
  if (!p) return <Dialog title="Reimbursement" onClose={onClose}><p className="muted">Loading…</p></Dialog>
  const editable = p.status === 'prepared'
  return (
    <Dialog title={`Reimbursement to ${p.staff?.full_name}`} onClose={onClose}>
      {p.is_to_owner && <p className="form-error">A payment to the Owner: both Directors are told when it's approved, and the Accountant must review it (D-010).</p>}
      <p>Amount: <Money value={p.amount} strong /></p>
      <PayoutActions table="staff_payments" row={p} onChanged={refresh} />
      <h3>Claims</h3>
      <div className="table-wrap"><table className="compact">
        <thead><tr><th>Date</th><th>Claim</th><th className="num">Amount</th>{editable && <th />}</tr></thead>
        <tbody>{(claims.data ?? []).map((c) => (
          <tr key={c.id}><td>{formatDate(c.expense_date)}</td><td>{c.description}</td><td><Money value={c.amount} /></td>
            {editable && <td><button className="link" onClick={() => action.run(async () => {
              const { error } = await supabase.from('expenses').update({ staff_payment_id: null }).eq('id', c.id)
              if (error) return friendlyError(error)
              await refresh()
            })}>Remove</button></td>}</tr>
        ))}</tbody>
      </table></div>
      {action.error && <p className="form-error">{action.error}</p>}
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Expenses page: the list plus claims waiting for this approver
// ---------------------------------------------------------------------------
export function ExpensesPage() {
  const { role, profile } = useAuth()
  const claims = useQuery({
    queryKey: ['claims-to-approve'],
    enabled: role === 'owner' || role === 'project_lead',
    queryFn: async () => (await supabase.from('expenses').select('id, expense_date, description, amount, staff_id, receipt_path, staff:staff(full_name)')
      .eq('payment_source', 'staff_out_of_pocket').eq('reimbursement_status', 'owed').order('expense_date')).data ?? [],
  })
  const refresh = useRefresh(['claims-to-approve', 'resource'])
  const action = useAction()
  const [rejecting, setRejecting] = useState<string | null>(null)
  const mine = (claims.data ?? []).filter((c) => role === 'owner' || c.staff_id !== profile?.staff_id)
  const decide = (id: string, status: 'approved' | 'rejected', note?: string) => action.run(async () => {
    const { error } = await supabase.from('expenses').update({ reimbursement_status: status, claim_note: note ?? null }).eq('id', id)
    if (error) return friendlyError(error)
    await refresh()
  })
  return (
    <>
      {mine.length > 0 && (
        <section className="panel" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>Expense claims to approve</h2>
          <div className="table-wrap"><table className="compact">
            <thead><tr><th>Date</th><th>Who</th><th>Claim</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>{mine.map((c) => (
              <tr key={c.id}><td>{formatDate(c.expense_date)}</td><td>{c.staff?.full_name}</td><td>{c.description}{!c.receipt_path && <div className="muted small">no receipt attached</div>}</td>
                <td><Money value={c.amount} /></td>
                <td className="row-actions"><button className="primary" disabled={action.busy} onClick={() => decide(c.id, 'approved')}>Approve</button>
                  <button disabled={action.busy} onClick={() => setRejecting(c.id)}>Reject</button></td></tr>
            ))}</tbody>
          </table></div>
          {action.error && <p className="form-error">{action.error}</p>}
        </section>
      )}
      <ResourceList resource={expensesResource} />
      {rejecting && <PromptDialog title="Reject this claim" label="Reason" confirmLabel="Reject" onClose={() => setRejecting(null)}
        onSubmit={async (note) => { await decide(rejecting, 'rejected', note); return null }} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Tax and statutory ledger (brief §7.6; D-016 payments: Accountant prepares,
// Owner approves, then paid)
// ---------------------------------------------------------------------------
export function StatutoryPage() {
  const { role } = useAuth()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'ledger' | 'payments' | 'lines' | 'credits'>(params.get('tab') === 'credits' ? 'credits' : 'ledger')
  const ledger = useQuery({ queryKey: ['statutory_ledger'], queryFn: async () =>
    (await supabase.from('statutory_ledger').select('*').order('due_date', { nullsFirst: true })).data ?? [] })
  const payments = useQuery({ queryKey: ['statutory_payments'], queryFn: async () =>
    (await supabase.from('statutory_payments').select('*, line:statutory_lines(type, period_start, payee)').order('created_at', { ascending: false })).data ?? [] })
  const credits = useQuery({ queryKey: ['tax-credit-balances'], queryFn: async () =>
    (await supabase.from('tax_credit_balances').select('*').order('as_at')).data ?? [] })
  const applications = useQuery({ queryKey: ['tax-credit-applications'], queryFn: async () =>
    (await supabase.from('tax_credit_applications').select('*, line:statutory_lines(type, period_start, is_opening_arrears)').order('created_at', { ascending: false })).data ?? [] })
  const refresh = useRefresh(['statutory_ledger', 'statutory_payments', 'tax-credit-balances', 'tax-credit-applications'])
  const [applying, setApplying] = useState<{ id: string; label: string; outstanding: number } | null>(null)
  const [preparing, setPreparing] = useState<{ id: string; label: string; outstanding: number } | null>(null)
  const canPrepare = role === 'accountant' || role === 'owner'
  const arrears = new Map<string, number>()
  for (const l of ledger.data ?? []) if (l.status === 'overdue') arrears.set(l.label!, (arrears.get(l.label!) ?? 0) + Number(l.outstanding))

  const table = (children: ReactNode) => <div className="table-wrap"><table>{children}</table></div>
  return (
    <section>
      <header className="page-header"><div><h1>Tax and statutory</h1>
        <p className="muted">PAYE, SSNIT and WHT lines are created automatically from payroll and payments. Enter opening arrears under "Lines".</p></div></header>
      {arrears.size > 0 && <p className="form-error">Overdue: {[...arrears.entries()].map(([k, v]) => `${k} ${formatMoney(v)}`).join(' · ')}</p>}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'ledger', label: 'Obligations' },
        { key: 'payments', label: 'Payments', count: (payments.data ?? []).filter((p) => p.status === 'prepared' || p.status === 'approved').length },
        { key: 'credits', label: 'Credits', count: (credits.data ?? []).filter((c) => Number(c.remaining) > 0.005).length },
        { key: 'lines', label: 'Lines (add / import)' }]} />
      {tab === 'ledger' && table(<>
        <thead><tr><th>Obligation</th><th>Period</th><th>Payee</th><th>Due</th><th className="num">Due amount</th><th className="num">Paid</th><th className="num">Credit</th><th className="num">Outstanding</th><th>Status</th><th /></tr></thead>
        <tbody>{(ledger.data ?? []).map((l) => (
          <tr key={l.id!} className={l.status === 'overdue' ? 'row-bad' : undefined}>
            <td>{l.label}{l.is_opening_arrears && <div className="muted small">opening arrears</div>}
              {l.notes && <div className="small warn-text">{l.notes}</div>}</td>
            <td>{l.period_start ? formatDate(l.period_start).slice(-8) : '—'}</td><td>{l.payee ?? <span className="warn-text">set payee</span>}</td>
            <td>{formatDate(l.due_date)}</td><td><Money value={l.amount_due} /></td><td><Money value={l.amount_paid} /></td><td>{Number(l.credit_applied) > 0 ? <Money value={l.credit_applied} /> : ''}</td><td><Money value={l.outstanding} /></td>
            <td><StatusBadge status={l.status} /></td>
            <td className="row-actions">{canPrepare && Number(l.outstanding) > 0 && <button onClick={() => setPreparing({ id: l.id!, label: l.label!, outstanding: Number(l.outstanding) })}>Prepare payment</button>}
              {canPrepare && Number(l.outstanding) > 0 && /^gra$/i.test(l.payee ?? '') && (credits.data ?? []).some((c) => Number(c.remaining) > 0.005 && /^gra$/i.test(c.authority ?? '')) &&
                <button onClick={() => setApplying({ id: l.id!, label: `${l.label}${l.period_start ? ` ${formatDate(l.period_start).slice(-8)}` : ' (arrears)'}`, outstanding: Number(l.outstanding) })}>Apply credit</button>}</td>
          </tr>
        ))}</tbody>
      </>)}
      {tab === 'payments' && table(<>
        <thead><tr><th>For</th><th className="num">Amount</th><th>Status and actions</th></tr></thead>
        <tbody>{(payments.data ?? []).map((p) => (
          <tr key={p.id}><td>{p.line?.type.replace(/_/g, ' ')} {p.line?.period_start && formatDate(p.line.period_start).slice(-8)} · {p.line?.payee}</td>
            <td><Money value={p.amount} /></td>
            <td><PayoutActions table="statutory_payments" row={p} onChanged={refresh} payRoles={['owner', 'accountant']} /></td></tr>
        ))}</tbody>
      </>)}
      {tab === 'lines' && <ResourceList resource={statutoryLines} />}
      {tab === 'credits' && <>
        <p className="muted small">What GRA (or another authority) owes MeLiNS (D-032). A credit set to offset VAT returns is used on each later VAT line automatically, oldest first.
          To set one against another GRA liability, such as PAYE arrears, use "Apply credit" on that line once GRA has approved the offset.</p>
        {table(<>
          <thead><tr><th>Credit</th><th>As at</th><th>Offsets</th><th className="num">Amount</th><th className="num">Used</th><th className="num">Left</th></tr></thead>
          <tbody>{(credits.data ?? []).map((c) => (
            <tr key={c.id!}><td>{c.authority}: {c.description}{c.notes && <div className="muted small">{c.notes}</div>}</td><td>{formatDate(c.as_at)}</td>
              <td>{c.auto_offset_type ? `${c.auto_offset_type.replace(/_/g, ' ').toUpperCase()} returns, automatically` : 'by hand, with GRA approval'}</td>
              <td><Money value={c.amount} /></td><td><Money value={c.applied} /></td><td><Money value={c.remaining} strong /></td></tr>
          ))}
          {(credits.data ?? []).length === 0 && <tr><td colSpan={6} className="muted">No credits. Add them in Settings › Setup, step 4.</td></tr>}</tbody>
        </>)}
        {(applications.data ?? []).length > 0 && <>
          <h2>Where credit has been used</h2>
          {table(<>
            <thead><tr><th>Date</th><th>Against</th><th>How</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>{(applications.data ?? []).map((a) => (
              <tr key={a.id}><td>{formatDate(a.applied_on)}</td>
                <td>{a.line?.type.replace(/_/g, ' ')} {a.line?.is_opening_arrears ? 'arrears' : a.line?.period_start && formatDate(a.line.period_start).slice(-8)}</td>
                <td>{a.kind === 'auto' ? 'automatic offset' : <>GRA-approved offset, ref {a.gra_reference}{a.notes && <span className="muted small"> · {a.notes}</span>}</>}</td>
                <td><Money value={a.amount} /></td>
                <td>{role === 'owner' && a.kind === 'gra_offset' && <button className="link" onClick={async () => {
                  if (!confirm('Undo this offset? The credit goes back to the balance.')) return
                  await supabase.from('tax_credit_applications').delete().eq('id', a.id); await refresh()
                }}>Undo</button>}</td></tr>
            ))}</tbody>
          </>)}
        </>}
      </>}
      {applying && <ApplyCreditDialog line={applying} credits={(credits.data ?? []).filter((c) => Number(c.remaining) > 0.005 && /^gra$/i.test(c.authority ?? ''))}
        onClose={() => setApplying(null)} onDone={async () => { setApplying(null); await refresh() }} />}
      {preparing && (
        <PromptDialog title={`Prepare payment: ${preparing.label}`} label={`Amount (outstanding ${formatMoney(preparing.outstanding)})`} confirmLabel="Prepare for approval"
          onClose={() => setPreparing(null)}
          onSubmit={async (v) => {
            const amount = parseMoney(v)
            if (!amount || amount <= 0) return 'Enter the amount'
            const { error } = await supabase.from('statutory_payments').insert({ statutory_line_id: preparing.id, amount })
            if (error) return friendlyError(error)
            await refresh(); setTab('payments'); return null
          }} />
      )}
    </section>
  )
}

function ApplyCreditDialog({ line, credits, onClose, onDone }: {
  line: { id: string; label: string; outstanding: number }
  credits: { id: string | null; description: string | null; remaining: number | null }[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [credit, setCredit] = useState(credits[0]?.id ?? '')
  const chosen = credits.find((c) => c.id === credit)
  const [amount, setAmount] = useState(String(Math.min(line.outstanding, Number(chosen?.remaining ?? 0))))
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  const action = useAction()
  return (
    <Dialog title={`Apply a credit to ${line.label}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); action.run(async () => {
        const n = parseMoney(amount)
        if (!n || n <= 0) return 'Enter the amount'
        const { error } = await supabase.rpc('apply_tax_credit', { p_credit: credit, p_line: line.id, p_amount: n, p_gra_reference: ref, p_notes: notes || undefined })
        if (error) return friendlyError(error)
        await onDone()
      }) }}>
        <p className="muted small">Only once GRA has approved setting the credit against this liability (D-032). It's recorded with GRA's reference and in the audit log.</p>
        <label>Credit<select value={credit} onChange={(e) => setCredit(e.target.value)}>
          {credits.map((c) => <option key={c.id!} value={c.id!}>{c.description} ({formatMoney(c.remaining)} left)</option>)}</select></label>
        <label>Amount (this line still owes {formatMoney(line.outstanding)})<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
        <label>GRA's reference for the approval<input value={ref} onChange={(e) => setRef(e.target.value)} required /></label>
        <label>Note<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Apply credit</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  )
}

export { ReviewActions }
