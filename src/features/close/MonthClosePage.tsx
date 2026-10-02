// /close/:month (brief §9 monthly close, §7.8; acceptance 11, 14, 25; A-040).
// Admin's part by the 3rd working day, the Accountant's by the 10th; the
// Accountant (or Owner) closes; only the Owner reopens, with a reason.
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Money, PromptDialog, StatusBadge, useAction } from '../../components/ui'
import { formatDate, todayAccra } from '../../lib/format'
import { defaultCloseMonth, GO_LIVE_MONTH } from '../../lib/golive'
import type { Json } from '../../lib/database.types'
import { supabase } from '../../lib/supabase'
import { friendlyError } from '../../resources/useLookups'
import { ReviewActions } from '../payouts/PayoutActions'

const ADMIN_CHECKLIST = [
  ['recurring', 'Every recurring-expense draft for the month confirmed'],
  ['entered', 'Every receipt, expense, payment out and reimbursement for the month entered, with its document'],
  ['invoiced', 'Everything on Ready to invoice drafted'],
  ['wht', 'Missing WHT certificates requested'],
  ['queries', 'Every queried entry answered'],
] as const
const ACCOUNTANT_CHECKLIST = [
  ['statements', 'Bank and mobile money statements uploaded'],
  ['reviewed', 'All entries reviewed'],
  ['receipts', 'Reported payments confirmed'],
  ['reconciled', 'Every account reconciled and differences explained'],
  ['statutory', 'Statutory payments and WHT remittances confirmed'],
  ['vat', 'VAT workings prepared'],
] as const

const KINDS: Record<string, { label: string; who: string }> = {
  unreviewed_entry: { label: 'Entries not yet reviewed', who: 'Accountant' },
  queried_entry: { label: 'Queried entries not yet answered', who: 'Admin' },
  unconfirmed_receipt: { label: 'Reported payments not confirmed', who: 'Accountant' },
  recurring_draft: { label: 'Recurring-expense drafts not confirmed', who: 'Admin' },
  statement_line: { label: 'Statement lines not matched', who: 'Accountant' },
  reconciliation: { label: 'Accounts not reconciled', who: 'Accountant' },
  payment_approved_unpaid: { label: 'Approved payments not recorded as paid', who: 'Admin' },
}

const monthLabel = (first: string) => new Date(`${first}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const shift = (first: string, n: number) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }

function recordLink(type: string, id: string, month: string): string {
  switch (type) {
    case 'receipts': return `/receipts?id=${id}`
    case 'payments_out': return `/payments-out?id=${id}`
    case 'staff_payments': return `/staff-payments?id=${id}`
    case 'expenses': return '/expenses'
    case 'transfers': return '/accounts/transfers'
    case 'staff_loans': case 'staff_loan_repayments': return '/staff-loans'
    case 'director_transactions': case 'director_payments': return '/directors'
    case 'statutory_payments': return '/tax/statutory'
    case 'payroll_runs': return `/payroll/${month.slice(0, 7)}`
    case 'accounts': return `/accounts/reconciliations?account=${id}&month=${month}`
    case 'statement_lines': return `/accounts/reconciliations?month=${month}`
    default: return '/'
  }
}

/** /close: last month's close (never before go-live). */
export function CloseRedirect() {
  return <Navigate to={`/close/${defaultCloseMonth(todayAccra()).slice(0, 7)}`} replace />
}

export function MonthClosePage() {
  const { month: key = '' } = useParams()
  const { role } = useAuth()
  const qc = useQueryClient()
  const month = /^\d{4}-\d{2}$/.test(key) ? `${key}-01` : ''
  const finance = role === 'owner' || role === 'director' || role === 'accountant'
  const closer = canWrite(role) && (role === 'accountant' || role === 'owner')
  const thisMonth = `${todayAccra().slice(0, 7)}-01`

  const close = useQuery({
    queryKey: ['month-close', month],
    enabled: !!month,
    queryFn: async () => (await supabase.from('month_closes').select('*').eq('month', month).maybeSingle()).data,
  })
  const blockers = useQuery({
    queryKey: ['month-blockers', month],
    enabled: !!month,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('month_close_blockers', { p_month: month })
      if (error) throw error
      return data ?? []
    },
  })
  const queue = useQuery({
    queryKey: ['review-queue', month],
    enabled: !!month && finance,
    queryFn: async () => (await supabase.rpc('entries_to_review', { p_month: month })).data ?? [],
  })
  const reopenings = useQuery({
    queryKey: ['month-reopenings', month],
    enabled: !!month && finance,
    queryFn: async () => (await supabase.from('month_reopenings').select('reason, reopened_at').eq('month', month).order('reopened_at')).data ?? [],
  })
  const action = useAction()
  const [reopening, setReopening] = useState(false)

  if (!month) return <section><h1>Month close</h1><p className="empty">That isn't a month. Use a link like /close/2026-10.</p></section>
  const refresh = async () => { for (const k of ['month-close', 'month-blockers', 'review-queue', 'month-reopenings']) await qc.invalidateQueries({ queryKey: [k] }) }
  const status = close.data?.status ?? 'open'
  const closed = status === 'closed'
  const items = blockers.data ?? []
  const byKind = new Map<string, typeof items>()
  for (const b of items) byKind.set(b.kind, [...(byKind.get(b.kind) ?? []), b])
  const beforeGoLive = month < GO_LIVE_MONTH

  return (
    <section>
      <header className="page-header">
        <div>
          <h1>Month close: {monthLabel(month)} <StatusBadge status={closed ? 'reviewed' : 'draft'} label={closed ? 'closed' : 'open'} /></h1>
          <p className="muted">Admin's part by the 3rd working day of the next month; the Accountant's by the 10th; the Owner reviews by the 12th. A closed month is locked.</p>
        </div>
        <div className="actions">
          {month > GO_LIVE_MONTH && <Link className="button-link" to={`/close/${shift(month, -1).slice(0, 7)}`}>‹ {monthLabel(shift(month, -1))}</Link>}
          {month < thisMonth && <Link className="button-link" to={`/close/${shift(month, 1).slice(0, 7)}`}>{monthLabel(shift(month, 1))} ›</Link>}
        </div>
      </header>
      {beforeGoLive && <p className="notice muted">The system went live on 1 October 2026 (D-029). Months before that are not closed here.</p>}

      {closed ? (
        <div className="panel">
          <h3>Closed {formatDate(close.data?.closed_at)}</h3>
          <p className="small">{close.data?.owner_reviewed_at ? `Reviewed by the Owner ${formatDate(close.data.owner_reviewed_at)}.` : 'Waiting for the Owner\'s review.'}</p>
          <div className="row-actions">
            {role === 'owner' && !close.data?.owner_reviewed_at && <button className="primary" disabled={action.busy} onClick={() => action.run(async () => {
              const { error } = await supabase.rpc('mark_month_reviewed', { p_month: month })
              if (error) return friendlyError(error)
              await refresh()
            })}>Mark reviewed</button>}
            {role === 'owner' && <button onClick={() => setReopening(true)}>Reopen the month</button>}
            {finance && <Link to={`/reports/monthly?month=${month.slice(0, 7)}`}>Monthly summary</Link>}
          </div>
        </div>
      ) : (
        <div className="panel">
          <h3>{items.length === 0 ? (blockers.isLoading ? 'Checking…' : role === 'admin' ? 'Nothing outstanding in your part' : 'Ready to close') : `${items.length} item${items.length === 1 ? '' : 's'} to clear before closing`}</h3>
          {[...byKind.entries()].map(([kind, rows]) => (
            <details key={kind} open={rows.length <= 5}>
              <summary><strong>{KINDS[kind]?.label ?? kind}</strong> <span className="muted small">({rows.length} · {KINDS[kind]?.who})</span></summary>
              <ul className="checks">{rows.map((b) => (
                <li key={`${b.record_type}-${b.record_id}`}><Link to={recordLink(b.record_type, b.record_id, month)}>{b.description}</Link></li>
              ))}</ul>
            </details>
          ))}
          {closer && !beforeGoLive && (
            <div className="form-actions">
              <button className="primary" disabled={action.busy || items.length > 0 || blockers.isLoading} onClick={() => action.run(async () => {
                const { error } = await supabase.rpc('close_month', { p_month: month })
                if (error) return friendlyError(error)
                await refresh()
              })}>Close {monthLabel(month)}</button>
            </div>
          )}
        </div>
      )}
      {action.error && <p className="form-error">{action.error}</p>}

      {finance && (queue.data ?? []).length > 0 && <>
        <h2>Entries to review ({queue.data!.length})</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Entry</th><th className="num">Amount</th><th>Entered by</th><th>Status</th><th /></tr></thead>
          <tbody>{queue.data!.map((q) => (
            <tr key={`${q.record_type}-${q.record_id}`}>
              <td>{formatDate(q.entry_date)}</td>
              <td><Link to={recordLink(q.record_type, q.record_id, month)}>{q.description}</Link>
                {q.query_note && <div className="form-error small">Queried: {q.query_note}</div>}</td>
              <td><Money value={q.amount} /></td>
              <td>{q.entered_by ?? '—'}</td>
              <td><StatusBadge status={q.review_status} /></td>
              <td>{q.record_type === 'receipts'
                ? role === 'accountant' && <Link to={`/receipts?id=${q.record_id}`}>Review</Link>
                : <ReviewActions table={q.record_type} row={{ id: q.record_id, review_status: q.review_status }} onChanged={refresh} />}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </>}

      <div className="detail-grid">
        <Checklist title="Admin's part" items={ADMIN_CHECKLIST} values={(close.data?.admin_checklist ?? {}) as Record<string, boolean>}
          editable={canWrite(role) && role === 'admin' && !closed} month={month} completeLabel="Mark my part complete"
          completedAt={close.data?.admin_completed_at ?? null} onSaved={refresh} />
        <Checklist title="Accountant's part" items={ACCOUNTANT_CHECKLIST} values={(close.data?.accountant_checklist ?? {}) as Record<string, boolean>}
          editable={closer && !closed} month={month} onSaved={refresh} />
      </div>

      {(reopenings.data ?? []).length > 0 && <>
        <h2>Reopened</h2>
        <ul className="plain">{reopenings.data!.map((r) => <li key={r.reopened_at}>{formatDate(r.reopened_at)}: {r.reason}</li>)}</ul>
      </>}
      {reopening && <PromptDialog title={`Reopen ${monthLabel(month)}`} label="Why? (recorded and sent to the Accountant)" confirmLabel="Reopen"
        onClose={() => setReopening(false)}
        onSubmit={async (reason) => {
          const { error } = await supabase.rpc('reopen_month', { p_month: month, p_reason: reason })
          if (error) return friendlyError(error)
          await refresh(); return null
        }} />}
    </section>
  )
}

function Checklist({ title, items, values, editable, month, completeLabel, completedAt, onSaved }: {
  title: string; items: readonly (readonly [string, string])[]; values: Record<string, boolean>; editable: boolean; month: string
  completeLabel?: string; completedAt?: string | null; onSaved: () => Promise<void>
}) {
  const action = useAction()
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null)
  const current = draft ?? values
  const save = (complete: boolean) => action.run(async () => {
    const { error } = await supabase.rpc('save_close_checklist', { p_month: month, p_checklist: current as Json, p_complete: complete })
    if (error) return friendlyError(error)
    setDraft(null); await onSaved()
  })
  const allDone = items.every(([k]) => current[k])
  return (
    <div className="panel">
      <h3>{title}{completedAt && <span className="muted small"> · completed {formatDate(completedAt)}</span>}</h3>
      <ul className="plain">{items.map(([k, text]) => (
        <li key={k}><label className="inline" style={{ fontWeight: 400 }}>
          <input type="checkbox" checked={!!current[k]} disabled={!editable} onChange={(e) => setDraft({ ...current, [k]: e.target.checked })} /> {text}
        </label></li>
      ))}</ul>
      {editable && (
        <div className="form-actions">
          <button disabled={action.busy || !draft} onClick={() => save(false)}>Save</button>
          {completeLabel && <button className="primary" disabled={action.busy || !allDone} onClick={() => save(true)}>{completeLabel}</button>}
        </div>
      )}
      {action.error && <p className="form-error">{action.error}</p>}
    </div>
  )
}
