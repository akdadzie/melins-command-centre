// Detail pages (brief §5, §7.2, §7.4):
//   /clients/:id      the client, their jobs, invoices, payments and WHT certificates
//   /referrers/:id    the referrer and the work they've sent (contact log and BD fees: Phase B)
//   /directors        each director's current-account balance, and the entries
//   /directors/:id    one director's account with a running balance, and payments to them
// Admin sees amounts per invoice but never totals (A-019); totals are for finance roles.
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Dialog } from '../../components/Dialog'
import { Money, StatusBadge, Tabs, useAction } from '../../components/ui'
import { formatDate, formatMoney, parseMoney, todayAccra } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import * as R from '../../resources/definitions'
import { ResourceForm } from '../../resources/ResourceForm'
import { ResourceList } from '../../resources/ResourceList'
import type { ResourceDef, Row } from '../../resources/types'
import { friendlyError } from '../../resources/useLookups'
import { PayoutActions } from '../payouts/PayoutActions'

const isFinance = (role: string | null) => role === 'owner' || role === 'director' || role === 'accountant'
const label = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—')

function EditButton({ resource, row, onSaved }: { resource: ResourceDef; row: Row; onSaved: () => void }) {
  const { role } = useAuth()
  const [open, setOpen] = useState(false)
  if (!canWrite(role) || !resource.editRoles.includes(role!)) return null
  return <>
    <button onClick={() => setOpen(true)}>Edit</button>
    {open && <Dialog title={`Edit ${resource.singular.toLowerCase()}`} onClose={() => setOpen(false)}>
      <ResourceForm resource={resource} row={row} onDone={() => { setOpen(false); onSaved() }} />
    </Dialog>}
  </>
}

// ---------------------------------------------------------------------------
// /clients/:id
// ---------------------------------------------------------------------------
export function ClientDetail() {
  const { id = '' } = useParams()
  const { role } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'invoices' | 'jobs' | 'payments' | 'wht'>('invoices')
  const client = useQuery({ queryKey: ['client', id], queryFn: async () => (await supabase.from('clients').select('*').eq('id', id).maybeSingle()).data })
  const jobs = useQuery({
    queryKey: ['client-jobs', id],
    queryFn: async () => (await supabase.from('jobs').select('id, job_number, title, delivery_status, fee, due_date').eq('client_id', id).order('job_number', { ascending: false })).data ?? [],
  })
  const invoices = useQuery({
    queryKey: ['client-invoices', id],
    queryFn: async () => (await supabase.from('invoices').select('id, invoice_number, draft_ref, invoice_date, due_date, status, gross_total, outstanding')
      .eq('client_id', id).order('invoice_date', { ascending: false })).data ?? [],
  })
  const receipts = useQuery({
    queryKey: ['client-receipts', id],
    enabled: role !== 'project_lead',
    queryFn: async () => (await supabase.from('receipts').select('id, receipt_date, cash_amount, wht_amount, vat_withheld_amount, status, method')
      .eq('client_id', id).order('receipt_date', { ascending: false })).data ?? [],
  })
  const certs = useQuery({
    queryKey: ['client-wht', id],
    enabled: role !== 'project_lead',
    queryFn: async () => (await supabase.from('wht_certificates').select('id, amount, certificate_number, status, expected_by, date_received')
      .eq('client_id', id).order('expected_by', { ascending: false })).data ?? [],
  })
  const c = client.data
  if (client.isLoading) return <p className="muted">Loading…</p>
  if (!c) return <section><h1>Client</h1><p className="empty">Not found, or your role can't see it.</p></section>
  const fin = isFinance(role)
  const today = todayAccra()
  const open = (invoices.data ?? []).filter((i) => ['approved', 'sent', 'part_paid', 'disputed'].includes(i.status) && Number(i.outstanding) > 0)

  return (
    <section>
      <p className="small"><Link to="/clients">Clients</Link></p>
      <header className="page-header">
        <div><h1>{c.name}</h1><p className="muted">{[c.organisation, label(c.type)].filter(Boolean).join(' · ')}</p></div>
        <div className="actions"><EditButton resource={R.clients} row={c as unknown as Row} onSaved={() => qc.invalidateQueries({ queryKey: ['client', id] })} /></div>
      </header>
      <div className="detail-grid">
        <div className="panel">
          <dl className="facts">
            <dt>Phone</dt><dd>{c.phone ?? '—'}</dd>
            <dt>Email</dt><dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</dd>
            <dt>TIN</dt><dd>{c.tin ?? '—'}</dd>
            <dt>VAT number</dt><dd>{c.vat_number ?? '—'}</dd>
            <dt>Deducts WHT</dt><dd>{c.deducts_wht ? `Yes (${c.wht_category ?? 'category not set'})` : 'No'}</dd>
            <dt>VAT withholding agent</dt><dd>{c.is_vat_withholding_agent ? 'Yes' : 'No'}</dd>
            <dt>Payment terms</dt><dd>{c.payment_terms_days ? `${c.payment_terms_days} days` : 'Standard'}</dd>
          </dl>
          {c.notes && <p className="small">{c.notes}</p>}
        </div>
        <div className="stats" style={{ margin: 0, alignContent: 'start' }}>
          <div className="stat"><span className="label">Open invoices</span><strong>{open.length}</strong>
            {fin && <span className="muted small">{formatMoney(open.reduce((s, i) => s + Number(i.outstanding), 0))} outstanding</span>}</div>
          <div className="stat"><span className="label">Overdue</span><strong className={open.some((i) => i.due_date && i.due_date < today) ? 'bad' : undefined}>
            {open.filter((i) => i.due_date && i.due_date < today).length}</strong></div>
          <div className="stat"><span className="label">Jobs</span><strong>{(jobs.data ?? []).length}</strong></div>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'invoices', label: 'Invoices' }, { key: 'jobs', label: 'Jobs' },
        ...(role !== 'project_lead' ? [{ key: 'payments' as const, label: 'Payments' }, { key: 'wht' as const, label: 'WHT certificates' }] : [])]} />
      {tab === 'invoices' && ((invoices.data ?? []).length === 0 ? <p className="empty">No invoices.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th className="num">Gross</th><th className="num">Outstanding</th><th>Status</th></tr></thead>
          <tbody>{(invoices.data ?? []).map((i) => (
            <tr key={i.id}><td><Link to={`/invoices/${i.invoice_number ?? i.draft_ref}`}>{i.invoice_number ?? i.draft_ref}</Link></td>
              <td>{formatDate(i.invoice_date)}</td><td>{formatDate(i.due_date)}{open.includes(i) && i.due_date && i.due_date < today && <span className="bad small"> overdue</span>}</td>
              <td><Money value={i.gross_total} /></td><td><Money value={i.outstanding} /></td><td><StatusBadge status={i.status} /></td></tr>
          ))}</tbody>
        </table></div>
      ))}
      {tab === 'jobs' && ((jobs.data ?? []).length === 0 ? <p className="empty">No jobs.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Job</th><th>Status</th><th>Due</th><th className="num">Fee</th></tr></thead>
          <tbody>{(jobs.data ?? []).map((j) => (
            <tr key={j.id}><td><Link to={`/jobs/${j.job_number}`}>{j.job_number}</Link> {j.title}</td><td>{label(j.delivery_status)}</td>
              <td>{formatDate(j.due_date)}</td><td><Money value={j.fee} /></td></tr>
          ))}</tbody>
        </table></div>
      ))}
      {tab === 'payments' && ((receipts.data ?? []).length === 0 ? <p className="empty">No payments recorded.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th className="num">Cash</th><th className="num">WHT</th><th className="num">VAT withheld</th><th>How</th><th>Status</th></tr></thead>
          <tbody>{(receipts.data ?? []).map((r) => (
            <tr key={r.id}><td><Link to={`/receipts?id=${r.id}`}>{formatDate(r.receipt_date)}</Link></td><td><Money value={r.cash_amount} /></td>
              <td><Money value={r.wht_amount} /></td><td><Money value={r.vat_withheld_amount} /></td><td>{label(r.method)}</td><td><StatusBadge status={r.status} /></td></tr>
          ))}</tbody>
        </table></div>
      ))}
      {tab === 'wht' && ((certs.data ?? []).length === 0 ? <p className="empty">No WHT certificates.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Certificate</th><th className="num">Amount</th><th>Expected by</th><th>Received</th><th>Status</th></tr></thead>
          <tbody>{(certs.data ?? []).map((w) => (
            <tr key={w.id}><td>{w.certificate_number ?? '—'}</td><td><Money value={w.amount} /></td><td>{formatDate(w.expected_by)}</td>
              <td>{formatDate(w.date_received)}</td><td><StatusBadge status={w.status} /></td></tr>
          ))}</tbody>
        </table></div>
      ))}
    </section>
  )
}

// ---------------------------------------------------------------------------
// /referrers/:id
// ---------------------------------------------------------------------------
export function ReferrerDetail() {
  const { id = '' } = useParams()
  const { role } = useAuth()
  const qc = useQueryClient()
  const referrer = useQuery({ queryKey: ['referrer', id], queryFn: async () => (await supabase.from('referrers').select('*').eq('id', id).maybeSingle()).data })
  const jobs = useQuery({
    queryKey: ['referrer-jobs', id],
    queryFn: async () => (await supabase.from('jobs').select('id, job_number, title, delivery_status, fee, created_at, client:clients(name)')
      .eq('referrer_id', id).order('created_at', { ascending: false })).data ?? [],
  })
  const r = referrer.data
  if (referrer.isLoading) return <p className="muted">Loading…</p>
  if (!r) return <section><h1>Referrer</h1><p className="empty">Not found, or your role can't see it.</p></section>
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString()
  const recent = (jobs.data ?? []).filter((j) => j.created_at >= yearAgo)
  const stale = r.last_contact_date && (Date.parse(todayAccra()) - Date.parse(r.last_contact_date)) / 86_400_000 > 60

  return (
    <section>
      <p className="small"><Link to="/referrers">Referrers</Link></p>
      <header className="page-header">
        <div><h1>{r.name}</h1><p className="muted">{[r.organisation, label(r.relationship)].filter(Boolean).join(' · ')}</p></div>
        <div className="actions"><EditButton resource={R.referrers} row={r as unknown as Row} onSaved={() => qc.invalidateQueries({ queryKey: ['referrer', id] })} /></div>
      </header>
      <div className="detail-grid">
        <div className="panel">
          <dl className="facts">
            <dt>Phone</dt><dd>{r.phone ?? '—'}</dd>
            <dt>Email</dt><dd>{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : '—'}</dd>
            <dt>Last contact</dt><dd>{formatDate(r.last_contact_date)}{stale && <span className="warn-text small"> over 60 days ago</span>}</dd>
          </dl>
          {r.notes && <p className="small">{r.notes}</p>}
          <p className="muted small">The contact log and business development fees arrive in Phase B. Update "last contact" with Edit for now.</p>
        </div>
        <div className="stats" style={{ margin: 0, alignContent: 'start' }}>
          <div className="stat"><span className="label">Jobs referred, last 12 months</span><strong>{recent.length}</strong>
            {isFinance(role) && <span className="muted small">{formatMoney(recent.reduce((s, j) => s + Number(j.fee ?? 0), 0))} in fees</span>}</div>
          <div className="stat"><span className="label">Jobs referred, all time</span><strong>{(jobs.data ?? []).length}</strong></div>
        </div>
      </div>
      <h2>Work referred</h2>
      {(jobs.data ?? []).length === 0 ? <p className="empty">No jobs linked to this referrer yet. Choose them as "Referred by" on a job.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Job</th><th>Client</th><th>Status</th><th>Since</th><th className="num">Fee</th></tr></thead>
          <tbody>{(jobs.data ?? []).map((j) => (
            <tr key={j.id}><td><Link to={`/jobs/${j.job_number}`}>{j.job_number}</Link> {j.title}</td><td>{j.client?.name}</td>
              <td>{label(j.delivery_status)}</td><td>{formatDate(j.created_at)}</td><td><Money value={j.fee} /></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// /directors and /directors/:id (finance-restricted; D-017 hides other
// directors' accounts from a Director when the Owner chooses)
// ---------------------------------------------------------------------------
export function DirectorsPage() {
  const balances = useQuery({ queryKey: ['director-balances'], queryFn: async () => (await supabase.from('director_balances').select('*').order('full_name')).data ?? [] })
  const today = todayAccra()
  return (
    <section>
      <header className="page-header"><div><h1>Directors' current accounts</h1>
        <p className="muted">Positive: the company owes the director. Negative: the director owes the company (e.g. client money received personally). Neither income nor cost.</p></div></header>
      <div className="stats">
        {(balances.data ?? []).map((d) => {
          const heldDays = d.oldest_client_money_held ? Math.floor((Date.parse(today) - Date.parse(d.oldest_client_money_held)) / 86_400_000) : 0
          return (
            <Link key={d.id} className="stat" to={`/directors/${d.id}`}>
              <span className="label">{d.full_name}</span>
              <strong className={Number(d.balance) < 0 ? 'bad' : undefined}>{formatMoney(Math.abs(Number(d.balance ?? 0)))}</strong>
              <span className="muted small">{Number(d.balance) > 0 ? 'company owes director' : Number(d.balance) < 0 ? 'director owes company' : 'settled'}
                {heldDays > 7 && <span className="bad"> · client money held {heldDays} days</span>}</span>
            </Link>
          )
        })}
      </div>
      <ResourceList resource={R.directorTransactions} />
    </section>
  )
}

const DIRECTOR_SOURCE: Record<string, string> = {
  director_txn: 'Current-account entry', receipt: 'Client money received personally', transfer: 'Paid over to MeLiNS', director_payment: 'Payment to director',
}

export function DirectorDetail() {
  const { id = '' } = useParams()
  const director = useQuery({ queryKey: ['director', id], queryFn: async () => (await supabase.from('director_balances').select('*').eq('id', id).maybeSingle()).data })
  const ledger = useQuery({
    queryKey: ['director-ledger', id],
    queryFn: async () => (await supabase.from('ledger_entries').select('id, entry_date, amount, source_type, description').eq('director_id', id).order('entry_date').order('id')).data ?? [],
  })
  const rows = useMemo(() => {
    let bal = 0
    return (ledger.data ?? []).map((e) => ({ ...e, balance: (bal = Math.round((bal + Number(e.amount)) * 100) / 100) }))
  }, [ledger.data])
  const d = director.data
  if (director.isLoading) return <p className="muted">Loading…</p>
  if (!d) return <section><h1>Director</h1><p className="empty">Not found, or hidden from your role.</p></section>

  return (
    <section>
      <p className="small"><Link to="/directors">Directors' current accounts</Link></p>
      <h1>{d.full_name}</h1>
      <div className="stats">
        <div className="stat"><span className="label">Balance</span><strong className={Number(d.balance) < 0 ? 'bad' : undefined}>{formatMoney(Math.abs(Number(d.balance ?? 0)))}</strong>
          <span className="muted small">{Number(d.balance) > 0 ? 'company owes director' : Number(d.balance) < 0 ? 'director owes company' : 'settled'}</span></div>
      </div>
      <h2>Current account</h2>
      {rows.length === 0 ? <p className="empty">No entries.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>What</th><th className="num">Company owes (+) / is owed (−)</th><th className="num">Balance</th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id}><td>{formatDate(e.entry_date)}</td><td>{DIRECTOR_SOURCE[e.source_type] ?? label(e.source_type)}{e.description && <span className="muted small"> · {e.description}</span>}</td>
              <td><Money value={e.amount} /></td><td><Money value={e.balance} /></td></tr>
          ))}</tbody>
        </table></div>
      )}
      <h2>Payments to {d.full_name?.split(' ')[0]}</h2>
      <DirectorPayments directorId={id} />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Payments to directors (brief §7.5; acceptance 24; D-010): Prepared (Owner or
// Accountant) -> Approved (Owner) -> Paid. Tax on fees and dividends is taken
// at the rate in force (Settings > WHT rates); a payment to the Owner notifies
// both Directors and always goes to the Accountant for review.
// ---------------------------------------------------------------------------
const PAYMENT_TYPES = [['fee_or_allowance', "Director's fee or allowance"], ['sitting_allowance', 'Sitting allowance'],
  ['expense_reimbursement', 'Reimbursement of expenses'], ['loan_repayment', "Repayment of director's loan"], ['dividend', 'Dividend'], ['other', 'Other']] as const

export function DirectorPayments({ directorId }: { directorId?: string }) {
  const { role } = useAuth()
  const qc = useQueryClient()
  const [preparing, setPreparing] = useState(false)
  const list = useQuery({
    queryKey: ['director-payments', directorId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('director_payments').select('*, director:directors(full_name)').order('created_at', { ascending: false }).limit(500)
      if (directorId) q = q.eq('director_id', directorId)
      return (await q).data ?? []
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['director-payments'] })
  const mayPrepare = canWrite(role) && (role === 'owner' || role === 'accountant')
  return (
    <>
      {mayPrepare && <div className="form-actions" style={{ marginTop: 0 }}><button className="primary" onClick={() => setPreparing(true)}>Prepare a payment</button></div>}
      {(list.data ?? []).length === 0 ? <p className="empty">No payments to directors yet.</p> : (
        <div className="stack">{(list.data ?? []).map((p) => (
          <div key={p.id} className="panel">
            <div className="page-header" style={{ marginBottom: '.25rem' }}>
              <div><strong>{!directorId && `${p.director?.full_name}: `}{PAYMENT_TYPES.find(([k]) => k === p.payment_type)?.[1] ?? p.payment_type}</strong>
                {p.is_to_owner && <span className="warn-text small"> · to the Owner: both Directors are told, and the Accountant reviews it (D-010)</span>}
                {p.notes && <div className="muted small">{p.notes}</div>}</div>
              <div className="num small">gross <Money value={p.gross_amount} /> · tax {Math.round(Number(p.tax_rate) * 10000) / 100}% <Money value={p.tax_amount} /> · <strong>net <Money value={p.net_amount} /></strong></div>
            </div>
            {p.payment_type === 'dividend' && !p.board_resolution_path && p.status === 'prepared' &&
              <p className="warn-text small">A dividend needs its board resolution attached before approval.</p>}
            <PayoutActions table="director_payments" row={p} onChanged={refresh} payRoles={['owner', 'accountant']} />
          </div>
        ))}</div>
      )}
      {preparing && <PrepareDirectorPayment directorId={directorId} onClose={() => setPreparing(false)} onSaved={refresh} />}
    </>
  )
}

function PrepareDirectorPayment({ directorId, onClose, onSaved }: { directorId?: string; onClose: () => void; onSaved: () => void }) {
  const directors = useQuery({ queryKey: ['directors-list'], queryFn: async () => (await supabase.from('directors').select('id, full_name').eq('is_active', true).order('full_name')).data ?? [] })
  const [director, setDirector] = useState(directorId ?? '')
  const [type, setType] = useState<string>('fee_or_allowance')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const action = useAction()
  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await action.run(async () => {
      const gross = parseMoney(amount)
      if (!gross || gross <= 0) return 'Enter the gross amount.'
      const { error } = await supabase.from('director_payments').insert({ director_id: director, payment_type: type, gross_amount: gross, notes: notes.trim() || null })
      if (error) return friendlyError(error)
      onSaved()
    })
    if (ok) onClose()
  }
  return (
    <Dialog title="Prepare a payment to a director" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!directorId && <label>Director<select value={director} onChange={(e) => setDirector(e.target.value)} required>
          <option value="">Choose…</option>{(directors.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></label>}
        <label>Type<select value={type} onChange={(e) => setType(e.target.value)}>{PAYMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Gross amount (GHS)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
        <label>Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <p className="muted small">Tax on fees, allowances and dividends is deducted at the rate in Settings when you save. Fees and allowances are booked to
          Staff &amp; welfare › Directors' fees and allowances.</p>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy || !director}>Prepare</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  )
}

/** /directors/payments: every payment to a director (approval notifications link here). */
export function DirectorPaymentsPage() {
  return (
    <section>
      <p className="small"><Link to="/directors">Directors' current accounts</Link></p>
      <header className="page-header"><div><h1>Payments to directors</h1>
        <p className="muted">Fees, allowances, reimbursements, loan repayments and dividends. Prepared, approved by the Owner, then paid.</p></div></header>
      <DirectorPayments />
    </section>
  )
}
