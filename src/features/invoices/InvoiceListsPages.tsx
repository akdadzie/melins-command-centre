// Invoice work lists (brief §5, §7.4; A-043):
//   /invoices/ready        milestones reached and rechargeables not billed, drafted in one step per job
//   /invoices/retention    retention held by clients per job, with release dates; draft the release invoice
//   /invoices/adjustments  credit notes, disputes and write-offs
// Admin sees per-item amounts but never totals (A-019).
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Money, StatusBadge, Tabs, useAction } from '../../components/ui'
import { formatDate, formatMoney, todayAccra } from '../../lib/format'
import { db, supabase } from '../../lib/supabase'
import { friendlyError } from '../../resources/useLookups'

const isFinance = (role: string | null) => role === 'owner' || role === 'director' || role === 'accountant'
const mayDraft = (role: string | null) => canWrite(role as never) && ['owner', 'accountant', 'admin'].includes(role ?? '')

async function createDraft(jobId: string, lines: Record<string, unknown>[]): Promise<{ ref?: string; error?: string }> {
  // client_id, retention, WHT and terms are filled in by the database from the job.
  const { data: inv, error } = await db.from('invoices').insert({ job_id: jobId, invoice_date: todayAccra() }).select('id, draft_ref').single()
  if (error) return { error: friendlyError(error) }
  for (const [i, l] of lines.entries()) {
    const { error: e2 } = await db.from('invoice_lines').insert({ ...l, invoice_id: inv.id, seq: i + 1 })
    if (e2) return { ref: inv.draft_ref, error: `The draft ${inv.draft_ref} was created, but a line wasn't added: ${friendlyError(e2)}` }
  }
  return { ref: inv.draft_ref }
}

function useTaxCodes() {
  return useQuery({ queryKey: ['tax-codes'], queryFn: async () => (await supabase.from('tax_codes').select('id, name').eq('is_active', true).order('name')).data ?? [] })
}

// ---------------------------------------------------------------------------
// /invoices/ready
// ---------------------------------------------------------------------------
export function ReadyToInvoicePage() {
  const { role } = useAuth()
  const items = useQuery({
    queryKey: ['ready-to-invoice'],
    queryFn: async () => (await supabase.from('ready_to_invoice').select('*').order('job_number').order('ready_since')).data ?? [],
  })
  const byJob = new Map<string, NonNullable<typeof items.data>>()
  for (const r of items.data ?? []) byJob.set(r.job_id!, [...(byJob.get(r.job_id!) ?? []), r])

  return (
    <section>
      <header className="page-header"><div><h1>Ready to invoice</h1>
        <p className="muted">Milestones marked reached, and rechargeable expenses not yet billed. Tick what goes on the invoice and draft it; the Owner then approves it.
          Certified valuations join this list in Phase B.</p></div></header>
      {items.isLoading ? <p className="muted">Loading…</p> : byJob.size === 0 ? <p className="empty">Nothing is waiting to be invoiced.</p>
        : [...byJob.entries()].map(([jobId, rows]) => <ReadyJob key={jobId} jobId={jobId} rows={rows} canDraft={mayDraft(role)} showTotal={isFinance(role)} />)}
    </section>
  )
}

type ReadyRow = { item_type: string | null; item_id: string | null; job_number: string | null; job_title: string | null; description: string | null; amount: number | null; ready_since: string | null }

function ReadyJob({ jobId, rows, canDraft, showTotal }: { jobId: string; rows: ReadyRow[]; canDraft: boolean; showTotal: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const taxCodes = useTaxCodes()
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.map((r) => r.item_id!)))
  const [tax, setTax] = useState('')
  const action = useAction()
  const defaultTax = tax || taxCodes.data?.find((t) => t.name === 'Standard')?.id || ''
  const chosen = rows.filter((r) => picked.has(r.item_id!))
  const today = todayAccra()

  const draft = () => action.run(async () => {
    if (!chosen.length) return 'Tick at least one item.'
    const res = await createDraft(jobId, chosen.map((r) => r.item_type === 'milestone'
      ? { line_type: 'milestone', billing_milestone_id: r.item_id, description: r.description, net_amount: r.amount, tax_code_id: defaultTax || null }
      : { line_type: 'rechargeable_expense', expense_id: r.item_id, description: `Recharge: ${r.description}`, net_amount: r.amount, tax_code_id: defaultTax || null }))
    await qc.invalidateQueries({ queryKey: ['ready-to-invoice'] })
    await qc.invalidateQueries({ queryKey: ['invoices'] })
    if (res.ref) navigate(`/invoices/${res.ref}`)
    return res.error ?? null
  })

  return (
    <div className="panel" style={{ marginBottom: '1rem' }}>
      <h3><Link to={`/jobs/${rows[0].job_number}?tab=milestones`}>{rows[0].job_number}</Link> {rows[0].job_title}</h3>
      <div className="table-wrap"><table className="compact">
        <thead><tr>{canDraft && <th />}<th>Item</th><th>Ready since</th><th className="num">Amount (net)</th></tr></thead>
        <tbody>{rows.map((r) => {
          const late = r.item_type === 'milestone' && r.ready_since && (Date.parse(today) - Date.parse(r.ready_since)) / 86_400_000 > 7
          return (
            <tr key={r.item_id}>
              {canDraft && <td><input type="checkbox" aria-label="Include" checked={picked.has(r.item_id!)} onChange={(e) => {
                const s = new Set(picked); if (e.target.checked) s.add(r.item_id!); else s.delete(r.item_id!); setPicked(s)
              }} /></td>}
              <td>{r.item_type === 'milestone' ? 'Milestone: ' : 'Rechargeable: '}{r.description}</td>
              <td>{formatDate(r.ready_since)}{late && <span className="warn-text small"> waiting over a week</span>}</td>
              <td><Money value={r.amount} /></td>
            </tr>
          )
        })}
        {showTotal && <tr className="total-row">{canDraft && <td />}<td colSpan={2}>Ticked</td><td><Money value={chosen.reduce((s, r) => s + Number(r.amount ?? 0), 0)} /></td></tr>}
        </tbody>
      </table></div>
      {canDraft && (
        <div className="form-actions" style={{ alignItems: 'center' }}>
          <label className="inline">Tax code<select value={defaultTax} onChange={(e) => setTax(e.target.value)} style={{ width: 'auto' }}>
            {(taxCodes.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <button className="primary" disabled={action.busy || !chosen.length} onClick={draft}>Draft invoice ({chosen.length})</button>
        </div>
      )}
      {action.error && <p className="form-error">{action.error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// /invoices/retention
// ---------------------------------------------------------------------------
export function RetentionPage() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const action = useAction()
  const list = useQuery({
    queryKey: ['retention-by-job'],
    queryFn: async () => (await supabase.from('retention_by_job').select('*').order('retention_release_date', { nullsFirst: false })).data ?? [],
  })
  const today = todayAccra()
  const soon = (d: string | null) => d !== null && (Date.parse(d) - Date.parse(today)) / 86_400_000 <= 30
  const rows = list.data ?? []

  const release = (r: (typeof rows)[number]) => action.run(async () => {
    const res = await createDraft(r.job_id!, [{ line_type: 'retention_release', description: `Release of retention held (${Number(r.retention_pct)}%)`, net_amount: r.retention_held, tax_code_id: null }])
    await qc.invalidateQueries({ queryKey: ['retention-by-job'] })
    if (res.ref) navigate(`/invoices/${res.ref}`)
    return res.error ?? null
  })

  return (
    <section>
      <header className="page-header"><div><h1>Retention held by clients</h1>
        <p className="muted">Retention deducted on issued invoices and not yet released. Release it with a retention-release line on a new invoice (no tax: it was charged on the original invoices).</p></div></header>
      {action.error && <p className="form-error">{action.error}</p>}
      {list.isLoading ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="empty">No retention is held by any client.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Job</th><th>Client</th><th>Terms</th><th>Expected release</th><th className="num">Held</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.job_id} className={soon(r.retention_release_date) ? 'row-bad' : undefined}>
              <td><Link to={`/jobs/${r.job_number}`}>{r.job_number}</Link> {r.title}</td>
              <td>{r.client_id ? <Link to={`/clients/${r.client_id}`}>{r.client_name}</Link> : r.client_name}</td>
              <td className="small">{Number(r.retention_pct)}%{r.retention_release_terms && ` · ${r.retention_release_terms}`}</td>
              <td>{formatDate(r.retention_release_date)}{soon(r.retention_release_date) && <div className="warn-text small">{r.retention_release_date! < today ? 'past due' : 'within 30 days'}</div>}</td>
              <td><Money value={r.retention_held} /></td>
              <td>{mayDraft(role) && <button disabled={action.busy} onClick={() => release(r)}>Draft release invoice</button>}</td>
            </tr>
          ))}
          {isFinance(role) && <tr className="total-row"><td colSpan={4}>Total held</td><td><Money value={rows.reduce((s, r) => s + Number(r.retention_held ?? 0), 0)} /></td><td /></tr>}
          </tbody>
        </table></div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// /invoices/adjustments
// ---------------------------------------------------------------------------
export function AdjustmentsPage() {
  const { role } = useAuth()
  const [tab, setTab] = useState<'credit' | 'disputed' | 'written_off'>('credit')
  const credits = useQuery({
    queryKey: ['credit-notes-all'],
    queryFn: async () => (await supabase.from('credit_notes')
      .select('id, cn_number, draft_ref, cn_date, reason, net_amount, tax_amount, gross_amount, status, invoice:invoices(invoice_number, client:clients(name))')
      .order('cn_date', { ascending: false })).data ?? [],
  })
  const invoices = useQuery({
    queryKey: ['invoices-adjusted'],
    queryFn: async () => (await supabase.from('invoices')
      .select('id, invoice_number, invoice_date, gross_total, outstanding, status, dispute_reason, dispute_date, dispute_next_step, write_off_reason, write_off_amount, written_off_at, client:clients(name)')
      .in('status', ['disputed', 'written_off']).order('invoice_date', { ascending: false })).data ?? [],
  })
  const disputed = (invoices.data ?? []).filter((i) => i.status === 'disputed')
  const writtenOff = (invoices.data ?? []).filter((i) => i.status === 'written_off')
  const fin = isFinance(role)
  const draftCredits = (credits.data ?? []).filter((c) => c.status === 'draft').length

  return (
    <section>
      <header className="page-header"><div><h1>Credit notes, disputes and write-offs</h1>
        <p className="muted">Raise each one from its invoice. Credit notes and write-offs need the Owner's approval; disputed invoices are left out of normal chasing.</p></div></header>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'credit', label: 'Credit notes', count: draftCredits },
        { key: 'disputed', label: 'Disputed', count: disputed.length },
        { key: 'written_off', label: 'Written off' }]} />
      {tab === 'credit' && ((credits.data ?? []).length === 0 ? <p className="empty">No credit notes.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Credit note</th><th>Date</th><th>Invoice</th><th>Reason</th><th className="num">Net</th><th className="num">Tax reversed</th><th className="num">Gross</th><th>Status</th></tr></thead>
          <tbody>{(credits.data ?? []).map((c) => (
            <tr key={c.id}>
              <td>{c.cn_number ?? c.draft_ref}</td><td>{formatDate(c.cn_date)}</td>
              <td><Link to={`/invoices/${c.invoice?.invoice_number}`}>{c.invoice?.invoice_number}</Link> <span className="muted small">{c.invoice?.client?.name}</span></td>
              <td>{c.reason}</td><td><Money value={c.net_amount} /></td><td><Money value={c.tax_amount} /></td><td><Money value={c.gross_amount} /></td>
              <td><StatusBadge status={c.status} label={c.status === 'draft' ? 'awaiting Owner' : 'approved'} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
      {tab === 'disputed' && (disputed.length === 0 ? <p className="empty">No disputed invoices.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Invoice</th><th>Client</th><th>Since</th><th>Reason</th><th>Next step</th><th className="num">Outstanding</th></tr></thead>
          <tbody>{disputed.map((i) => (
            <tr key={i.id}><td><Link to={`/invoices/${i.invoice_number}`}>{i.invoice_number}</Link></td><td>{i.client?.name}</td>
              <td>{formatDate(i.dispute_date)}</td><td>{i.dispute_reason}</td><td>{i.dispute_next_step ?? '—'}</td><td><Money value={i.outstanding} /></td></tr>
          ))}</tbody>
        </table></div>
      ))}
      {tab === 'written_off' && (writtenOff.length === 0 ? <p className="empty">Nothing written off.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Invoice</th><th>Client</th><th>Written off</th><th>Reason</th><th className="num">Bad debt</th></tr></thead>
          <tbody>{writtenOff.map((i) => (
            <tr key={i.id}><td><Link to={`/invoices/${i.invoice_number}`}>{i.invoice_number}</Link></td><td>{i.client?.name}</td>
              <td>{formatDate(i.written_off_at)}</td><td>{i.write_off_reason}</td><td><Money value={i.write_off_amount} /></td></tr>
          ))}
          {fin && <tr className="total-row"><td colSpan={4}>Total bad debt</td><td><Money value={writtenOff.reduce((s, i) => s + Number(i.write_off_amount ?? 0), 0)} /></td></tr>}
          </tbody>
        </table></div>
      ))}
      {fin && tab === 'credit' && (credits.data ?? []).length > 0 && (
        <p className="muted small">Approved credit notes this year: {formatMoney((credits.data ?? []).filter((c) => c.status === 'approved' && c.cn_date.slice(0, 4) === todayAccra().slice(0, 4)).reduce((s, c) => s + Number(c.gross_amount), 0))} gross.</p>
      )}
    </section>
  )
}
