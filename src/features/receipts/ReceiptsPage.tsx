import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Attachment } from '../../components/Attachment'
import { Dialog } from '../../components/Dialog'
import { Money, PromptDialog, StatusBadge, Tabs, useAction } from '../../components/ui'
import { formatDate, formatMoney, parseMoney, todayAccra } from '../../lib/format'
import { db, supabase } from '../../lib/supabase'
import { lookups } from '../../resources/lookups'
import { fetchLookupRows, friendlyError } from '../../resources/useLookups'

const SOURCES = [
  ['office_cash_cheque', 'Cheque or cash at the office'], ['remittance_advice', 'Remittance advice'],
  ['reported_by_owner', 'Reported by the Owner'], ['found_on_statement', 'Found on statement'],
  ['received_by_director', 'Received by a director'],
] as const
const METHODS = [['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['cash', 'Cash'], ['mobile_money', 'Mobile money'], ['other', 'Other']] as const

async function listReceipts() {
  const { data, error } = await supabase.from('receipts')
    .select('*, client:clients(name), allocations:receipt_allocations(cash_amount, wht_amount, vat_withheld_amount)')
    .order('receipt_date', { ascending: false }).limit(2000)
  if (error) throw error
  return data
}
type Receipt = Awaited<ReturnType<typeof listReceipts>>[number]

const total = (r: Pick<Receipt, 'cash_amount' | 'wht_amount' | 'vat_withheld_amount'>) =>
  Number(r.cash_amount) + Number(r.wht_amount) + Number(r.vat_withheld_amount)
const allocated = (r: Receipt) => (r.allocations ?? []).reduce((s, a) => s + total(a), 0)

type TabKey = 'reported' | 'review' | 'confirmed' | 'rejected' | 'all'

export function ReceiptsPage() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  const { data = [], isLoading, error } = useQuery({ queryKey: ['receipts'], queryFn: listReceipts })
  const [tab, setTab] = useState<TabKey>('reported')
  // /receipts?new=quick opens the Owner's quick-log (the home screen's "+ Payment received").
  const [creating, setCreating] = useState<null | 'quick' | 'full'>(() => (params.get('new') === 'quick' && role === 'owner' ? 'quick' : null))
  const openId = params.get('id')
  const writer = canWrite(role) && ['owner', 'accountant', 'admin'].includes(role ?? '')

  const toReview = (r: Receipt) => r.status === 'confirmed' && r.review_status === 'recorded'
  const rows = data.filter((r) => tab === 'all' || (tab === 'review' ? toReview(r) : r.status === tab))
  const reportedCount = data.filter((r) => r.status === 'reported').length
  const reviewCount = data.filter(toReview).length

  return (
    <section>
      <header className="page-header">
        <div>
          <h1>Payments received</h1>
          <p className="muted">Whoever hears first logs it; the Accountant confirms it against the statement (the Owner can confirm as backup, and the Accountant then reviews it). Only confirmed payments count as cash.</p>
        </div>
        <div className="actions">
          {role === 'owner' && <button className="primary" onClick={() => setCreating('quick')}>+ Payment received</button>}
          {writer && <button className={role === 'owner' ? '' : 'primary'} onClick={() => setCreating('full')}>{role === 'owner' ? 'Full entry' : '+ Record a payment'}</button>}
        </div>
      </header>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'reported', label: 'To confirm', count: reportedCount },
        ...(reviewCount > 0 || role === 'accountant' ? [{ key: 'review' as const, label: 'Owner-confirmed to review', count: reviewCount }] : []),
        { key: 'confirmed', label: 'Confirmed' }, { key: 'rejected', label: 'Rejected' }, { key: 'all', label: 'All' }]} />
      {error && <p className="form-error">{friendlyError(error as Error)}</p>}
      {isLoading ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="empty">Nothing here.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Client</th><th className="num">Cash</th><th className="num">WHT</th><th className="num">VAT withheld</th><th>How</th><th>Allocated</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => {
            const unallocated = total(r) - allocated(r)
            return (
              <tr key={r.id} className="clickable" onClick={() => setParams({ id: r.id })}>
                <td>{formatDate(r.receipt_date)}</td>
                <td>{r.client?.name}</td>
                <td><Money value={r.cash_amount} /></td><td><Money value={r.wht_amount} /></td><td><Money value={r.vat_withheld_amount} /></td>
                <td>{r.method?.replace(/_/g, ' ') ?? <span className="muted">details missing</span>}{r.received_by_director_id && <div className="small">held by a director</div>}</td>
                <td>{Math.abs(unallocated) < 0.005 ? 'Yes' : <span className="warn-text">{formatMoney(unallocated)} not allocated</span>}</td>
                <td><StatusBadge status={r.status} />{toReview(r) && <div className="small warn-text">to review</div>}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}
      {creating === 'quick' && <QuickLog onClose={() => setCreating(null)} onSaved={(id) => { setCreating(null); setParams({ id }) }} />}
      {creating === 'full' && <ReceiptForm onClose={() => setCreating(null)} onSaved={(id) => { setCreating(null); setParams({ id }) }} />}
      {openId && <ReceiptDetail id={openId} onClose={() => setParams({})} />}
    </section>
  )
}

/** The Owner's "+ Payment received" (brief §7.4): under 20 seconds on a phone. */
function QuickLog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient()
  const clients = useQuery({ queryKey: ['lookup', 'clients'], queryFn: () => fetchLookupRows(lookups.client) })
  const invoices = useQuery({
    queryKey: ['open-invoices-all'],
    queryFn: async () => (await supabase.from('invoices').select('id, invoice_number, outstanding, client_id, client:clients(name)')
      .in('status', ['approved', 'sent', 'part_paid', 'disputed']).gt('outstanding', 0).order('invoice_number')).data ?? [],
  })
  const [target, setTarget] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayAccra())
  const action = useAction()

  function submit(e: FormEvent) {
    e.preventDefault()
    action.run(async () => {
      const n = parseMoney(amount)
      if (!n || n <= 0) return 'Enter the amount'
      const [kind, id] = target.split(':')
      const { data, error } = await supabase.rpc('quick_log_payment', {
        p_amount: n, p_date: date, p_invoice_id: kind === 'inv' ? id : undefined, p_client_id: kind === 'client' ? id : undefined,
      })
      if (error) return friendlyError(error)
      await qc.invalidateQueries({ queryKey: ['receipts'] })
      onSaved(data as string)
    })
  }

  return (
    <Dialog title="Payment received" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>Invoice or client
          <select value={target} onChange={(e) => {
            setTarget(e.target.value)
            const inv = invoices.data?.find((i) => `inv:${i.id}` === e.target.value)
            if (inv && !amount) setAmount(String(inv.outstanding))
          }} required>
            <option value="">Choose…</option>
            <optgroup label="Open invoices">
              {(invoices.data ?? []).map((i) => <option key={i.id} value={`inv:${i.id}`}>{i.invoice_number} · {i.client?.name} · {formatMoney(i.outstanding)}</option>)}
            </optgroup>
            <optgroup label="Client (no invoice yet)">
              {(clients.data ?? []).map((c) => <option key={String(c.id)} value={`client:${c.id}`}>{String(c.name)}</option>)}
            </optgroup>
          </select>
        </label>
        <label>Amount received (GHS)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <p className="muted small">Saved as Reported. Admin completes the details; the Accountant confirms it against the statement.</p>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Log payment</button></div>
      </form>
    </Dialog>
  )
}

interface ReceiptFields {
  client_id: string; receipt_date: string; cash_amount: string; wht_amount: string; vat_withheld_amount: string
  account_id: string; received_by_director_id: string; method: string; reference: string; source: string; notes: string
  statement_line_id?: string | null
}

function fieldsFrom(r?: Partial<Receipt>): ReceiptFields {
  return {
    client_id: r?.client_id ?? '', receipt_date: r?.receipt_date ?? todayAccra(),
    cash_amount: r?.cash_amount != null ? String(r.cash_amount) : '', wht_amount: r?.wht_amount ? String(r.wht_amount) : '',
    vat_withheld_amount: r?.vat_withheld_amount ? String(r.vat_withheld_amount) : '',
    account_id: r?.account_id ?? '', received_by_director_id: r?.received_by_director_id ?? '', method: r?.method ?? '',
    reference: r?.reference ?? '', source: r?.source ?? 'remittance_advice', notes: r?.notes ?? '',
    statement_line_id: r?.statement_line_id ?? null,
  }
}

function toRow(f: ReceiptFields): Record<string, unknown> | string {
  const cash = parseMoney(f.cash_amount) ?? 0, wht = parseMoney(f.wht_amount) ?? 0, vat = parseMoney(f.vat_withheld_amount) ?? 0
  if (cash + wht + vat <= 0) return 'Enter the amount received (cash, WHT or VAT withheld)'
  if (!f.client_id) return 'Choose the client'
  const byDirector = f.source === 'received_by_director'
  if (byDirector && !f.received_by_director_id) return 'Choose the director who received it'
  return {
    client_id: f.client_id, receipt_date: f.receipt_date, cash_amount: cash, wht_amount: wht, vat_withheld_amount: vat,
    account_id: byDirector ? null : f.account_id || null, received_by_director_id: byDirector ? f.received_by_director_id : null,
    method: f.method || null, reference: f.reference || null, source: f.source, notes: f.notes || null,
    ...(f.statement_line_id ? { statement_line_id: f.statement_line_id } : {}),
  }
}

function ReceiptFieldsForm({ value, onChange, disabled, lockClient }: { value: ReceiptFields; onChange: (v: ReceiptFields) => void; disabled?: boolean; lockClient?: boolean }) {
  const { role } = useAuth()
  const clients = useQuery({ queryKey: ['lookup', 'clients'], queryFn: () => fetchLookupRows(lookups.client) })
  const accounts = useQuery({ queryKey: ['lookup', 'account_picker'], queryFn: () => fetchLookupRows(lookups.account) })
  const directors = useQuery({ queryKey: ['lookup', 'directors'], queryFn: () => fetchLookupRows(lookups.director), enabled: role !== 'admin' })
  const set = (k: keyof ReceiptFields) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value })
  const byDirector = value.source === 'received_by_director'
  return (
    <div className="form-grid">
      <label>Client
        <select value={value.client_id} onChange={set('client_id')} disabled={disabled || lockClient} required>
          <option value="">Choose…</option>
          {(clients.data ?? []).map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
        </select>
      </label>
      <label>Date received<input type="date" value={value.receipt_date} onChange={set('receipt_date')} disabled={disabled} required /></label>
      <label>Cash received (GHS)<input inputMode="decimal" value={value.cash_amount} onChange={set('cash_amount')} disabled={disabled} /></label>
      <label>WHT deducted by client (GHS)<input inputMode="decimal" value={value.wht_amount} onChange={set('wht_amount')} disabled={disabled} /></label>
      <label>VAT withheld (GHS)<input inputMode="decimal" value={value.vat_withheld_amount} onChange={set('vat_withheld_amount')} disabled={disabled} /></label>
      <label>How we learnt of it
        <select value={value.source} onChange={set('source')} disabled={disabled}>
          {SOURCES.filter(([k]) => role !== 'admin' || k !== 'received_by_director').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {byDirector ? (
        <label>Director who received it
          <select value={value.received_by_director_id} onChange={set('received_by_director_id')} disabled={disabled} required>
            <option value="">Choose…</option>
            {(directors.data ?? []).map((d) => <option key={String(d.id)} value={String(d.id)}>{String(d.full_name)}</option>)}
          </select>
        </label>
      ) : (
        <label>Paid into account
          <select value={value.account_id} onChange={set('account_id')} disabled={disabled}>
            <option value="">Not known yet</option>
            {(accounts.data ?? []).map((a) => <option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>)}
          </select>
        </label>
      )}
      <label>Method
        <select value={value.method} onChange={set('method')} disabled={disabled}>
          <option value="">Not known yet</option>
          {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label>Reference<input value={value.reference} onChange={set('reference')} disabled={disabled} /></label>
      <label>Notes<input value={value.notes} onChange={set('notes')} disabled={disabled} /></label>
      {byDirector && <p className="help">It settles the invoice but counts as owed by that director until they transfer it to a MeLiNS account.</p>}
    </div>
  )
}

export function ReceiptForm({ onClose, onSaved, initial }: { onClose: () => void; onSaved: (id: string) => void; initial?: Partial<Receipt> }) {
  const qc = useQueryClient()
  const [value, setValue] = useState<ReceiptFields>(() => fieldsFrom(initial))
  const action = useAction()
  function submit(e: FormEvent) {
    e.preventDefault()
    action.run(async () => {
      const row = toRow(value)
      if (typeof row === 'string') return row
      const { data, error } = await db.from('receipts').insert(row).select('id').single()
      if (error) return friendlyError(error)
      await qc.invalidateQueries({ queryKey: ['receipts'] })
      onSaved(data.id)
    })
  }
  return (
    <Dialog title="Record a payment received" onClose={onClose}>
      <form onSubmit={submit}>
        <ReceiptFieldsForm value={value} onChange={setValue} />
        <p className="muted small">Next you allocate it to the client's invoices.</p>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Save and allocate</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  )
}

function ReceiptDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const receipt = useQuery({
    queryKey: ['receipt', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('receipts').select('*, client:clients(name)').eq('id', id).maybeSingle()
      if (error) throw error
      return data
    },
  })
  const r = receipt.data
  const allocs = useQuery({
    queryKey: ['receipt-allocations', id],
    queryFn: async () => (await supabase.from('receipt_allocations').select('*, invoice:invoices(invoice_number, outstanding)').eq('receipt_id', id)).data ?? [],
  })
  const openInvoices = useQuery({
    queryKey: ['client-open-invoices', r?.client_id],
    enabled: !!r?.client_id,
    queryFn: async () => (await supabase.from('invoices').select('id, invoice_number, invoice_date, outstanding, gross_total')
      .eq('client_id', r!.client_id).in('status', ['approved', 'sent', 'part_paid', 'disputed']).gt('outstanding', 0).order('invoice_date')).data ?? [],
  })
  const [value, setValue] = useState<ReceiptFields | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [sendingBack, setSendingBack] = useState(false)
  const action = useAction()
  useEffect(() => { if (r) setValue(fieldsFrom(r as unknown as Receipt)) }, [r])

  const writer = canWrite(role) && ['owner', 'accountant', 'admin'].includes(role ?? '')
  const editable = writer && r?.status === 'reported'

  async function refresh() {
    for (const k of ['receipts', 'receipt', 'receipt-allocations', 'client-open-invoices', 'invoices', 'invoice']) await qc.invalidateQueries({ queryKey: [k] })
  }

  if (!r || !value) return <Dialog title="Payment" onClose={onClose}><p className="muted">{receipt.isLoading ? 'Loading…' : 'Not found, or your role can\'t see it.'}</p></Dialog>

  const totalAllocated = (allocs.data ?? []).reduce((s, a) => s + total(a), 0)
  const remaining = total(r) - totalAllocated

  return (
    <Dialog title={`Payment from ${r.client?.name}`} onClose={onClose}>
      <p><StatusBadge status={r.status} /> {r.status === 'confirmed' && <span className="muted small">confirmed {formatDate(r.confirmed_at)}</span>}
        {r.status === 'rejected' && <span className="muted small">{r.rejection_reason}</span>}</p>
      <form onSubmit={(e) => {
        e.preventDefault()
        action.run(async () => {
          const row = toRow(value)
          if (typeof row === 'string') return row
          const { error } = await db.from('receipts').update(row).eq('id', id)
          if (error) return friendlyError(error)
          await refresh()
        })
      }}>
        <ReceiptFieldsForm value={value} onChange={setValue} disabled={!editable} lockClient={(allocs.data ?? []).length > 0} />
        {editable && <div className="form-actions"><button disabled={action.busy}>Save details</button></div>}
      </form>

      <Attachment table="receipts" column="attachment_path" recordId={id} path={r.attachment_path} label="Cheque, deposit slip or remittance advice" editable={writer} />

      <h3>Allocation to invoices</h3>
      <p className="small">{formatMoney(total(r))} received (cash + WHT + VAT withheld) · {formatMoney(totalAllocated)} allocated ·{' '}
        <strong className={Math.abs(remaining) > 0.005 ? 'warn-text' : undefined}>{formatMoney(remaining)} left</strong></p>
      <Allocations receiptId={id} receipt={r} allocs={allocs.data ?? []} openInvoices={openInvoices.data ?? []} editable={!!editable} onChanged={refresh} remaining={remaining} />

      {r.status === 'confirmed' && r.review_status === 'recorded' && (
        <p className="warn-text small">Confirmed by the Owner as the Accountant's backup: waiting for the Accountant's review (D-028).</p>
      )}
      {r.status === 'confirmed' && r.review_status === 'reviewed' && <p className="muted small">Owner's confirmation reviewed by the Accountant {formatDate(r.reviewed_at)}.</p>}
      {r.status === 'reported' && r.review_note && <p className="warn-text small">Sent back by the Accountant: {r.review_note}</p>}
      {action.error && <p className="form-error">{action.error}</p>}
      <div className="form-actions">
        {(role === 'accountant' || role === 'owner') && r.status === 'reported' && (
          <button className="primary" disabled={action.busy} onClick={() => action.run(async () => {
            const { error } = await supabase.from('receipts').update({ status: 'confirmed' }).eq('id', id)
            if (error) return friendlyError(error)
            await refresh()
          })}>{role === 'owner' ? 'Confirm (as Accountant\'s backup)' : 'Confirm against statement'}</button>
        )}
        {role === 'accountant' && r.status === 'confirmed' && r.review_status === 'recorded' && <>
          <button className="primary" disabled={action.busy} onClick={() => action.run(async () => {
            const { error } = await supabase.from('receipts').update({ review_status: 'reviewed' }).eq('id', id)
            if (error) return friendlyError(error)
            await refresh()
          })}>Reviewed: matches the statement</button>
          <button onClick={() => setSendingBack(true)}>Send back to Reported</button>
        </>}
        {(role === 'accountant' || role === 'owner') && r.status === 'reported' && <button onClick={() => setRejecting(true)}>Reject</button>}
        <button onClick={onClose}>Close</button>
      </div>
      {sendingBack && (
        <PromptDialog title="Send back to Reported" label="Why? (e.g. not on the statement)" confirmLabel="Send back"
          onClose={() => setSendingBack(false)}
          onSubmit={async (note) => {
            const { error } = await supabase.from('receipts').update({ status: 'reported', review_note: note }).eq('id', id)
            if (error) return friendlyError(error)
            await refresh(); return null
          }} />
      )}
      {rejecting && (
        <PromptDialog title="Reject this payment" label="Reason (e.g. duplicate, not on the statement)" confirmLabel="Reject"
          onClose={() => setRejecting(false)}
          onSubmit={async (reason) => {
            const { error } = await supabase.from('receipts').update({ status: 'rejected', rejection_reason: reason }).eq('id', id)
            if (error) return friendlyError(error)
            await refresh(); return null
          }} />
      )}
    </Dialog>
  )
}

type Alloc = { id: string; invoice_id: string; cash_amount: number; wht_amount: number; vat_withheld_amount: number; invoice: { invoice_number: string | null; outstanding: number } | null }

function Allocations({ receiptId, receipt, allocs, openInvoices, editable, onChanged, remaining }: {
  receiptId: string
  receipt: { cash_amount: number; wht_amount: number; vat_withheld_amount: number }
  allocs: Alloc[]
  openInvoices: { id: string; invoice_number: string | null; invoice_date: string; outstanding: number }[]
  editable: boolean
  onChanged: () => void
  remaining: number
}) {
  const action = useAction()
  const allocatedTo = new Set(allocs.map((a) => a.invoice_id))
  const candidates = useMemo(() => openInvoices.filter((i) => !allocatedTo.has(i.id)), [openInvoices, allocatedTo])
  const left = (k: 'cash_amount' | 'wht_amount' | 'vat_withheld_amount') =>
    Number(receipt[k]) - allocs.reduce((s, a) => s + Number(a[k]), 0)

  /** Allocate as much as fits: WHT and VAT withheld first (they belong to the invoice), then cash. */
  function allocate(inv: { id: string; outstanding: number }) {
    action.run(async () => {
      let room = Number(inv.outstanding)
      const take = (avail: number) => { const t = Math.max(0, Math.min(avail, room)); room -= t; return Math.round(t * 100) / 100 }
      const wht = take(left('wht_amount')), vat = take(left('vat_withheld_amount')), cash = take(left('cash_amount'))
      if (wht + vat + cash <= 0) return 'Nothing left to allocate'
      const { error } = await supabase.from('receipt_allocations').insert({ receipt_id: receiptId, invoice_id: inv.id, cash_amount: cash, wht_amount: wht, vat_withheld_amount: vat })
      if (error) return friendlyError(error)
      onChanged()
    })
  }

  return (
    <>
      <div className="table-wrap"><table className="compact">
        <thead><tr><th>Invoice</th><th className="num">Cash</th><th className="num">WHT</th><th className="num">VAT withheld</th>{editable && <th />}</tr></thead>
        <tbody>
          {allocs.map((a) => (
            <tr key={a.id}>
              <td><Link to={`/invoices/${a.invoice?.invoice_number}`}>{a.invoice?.invoice_number}</Link></td>
              <td><Money value={a.cash_amount} /></td><td><Money value={a.wht_amount} /></td><td><Money value={a.vat_withheld_amount} /></td>
              {editable && <td><button className="link" onClick={() => action.run(async () => {
                const { error } = await supabase.from('receipt_allocations').delete().eq('id', a.id)
                if (error) return friendlyError(error)
                onChanged()
              })}>Remove</button></td>}
            </tr>
          ))}
          {allocs.length === 0 && <tr><td colSpan={5} className="muted">Not allocated yet.</td></tr>}
        </tbody>
      </table></div>
      {editable && remaining > 0.005 && (
        candidates.length === 0 ? <p className="muted small">No other open invoices for this client.</p> : (
          <div className="table-wrap"><table className="compact">
            <thead><tr><th>Open invoice</th><th>Date</th><th className="num">Outstanding</th><th /></tr></thead>
            <tbody>{candidates.map((i) => (
              <tr key={i.id}><td>{i.invoice_number}</td><td>{formatDate(i.invoice_date)}</td><td><Money value={i.outstanding} /></td>
                <td><button disabled={action.busy} onClick={() => allocate(i)}>Allocate</button></td></tr>
            ))}</tbody>
          </table></div>
        )
      )}
      {action.error && <p className="form-error">{action.error}</p>}
    </>
  )
}

/** /receipts/new?statement_line=… : the "Record this receipt" task from reconciliation (brief §7.4 rule 4). */
export function NewReceiptFromStatement() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const lineId = params.get('statement_line')
  const task = useQuery({
    queryKey: ['receipt-task', lineId],
    enabled: !!lineId,
    queryFn: async () => (await supabase.from('receipt_tasks').select('*').eq('statement_line_id', lineId!).maybeSingle()).data,
  })
  if (lineId && task.isLoading) return <p className="muted">Loading…</p>
  const t = task.data
  return (
    <section>
      <h1>Record this receipt</h1>
      {t && <p className="muted">From the statement: {formatMoney(t.amount)} on {formatDate(t.line_date)}: {t.description}</p>}
      <ReceiptForm
        initial={t ? { receipt_date: t.line_date!, cash_amount: t.amount!, source: 'found_on_statement', statement_line_id: t.statement_line_id } as Partial<Receipt> : undefined}
        onClose={() => navigate('/receipts')}
        onSaved={(id) => navigate(`/receipts?id=${id}`)} />
    </section>
  )
}
