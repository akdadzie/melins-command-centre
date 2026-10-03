// Accounts and reconciliation (brief §5, §7.1, §9 Accountant's close; A-039).
//   /accounts                   balances, last reconciled month, differences
//   /accounts/:id               every movement with a running balance
//   /accounts/reconciliations   statement in, lines matched or explained, month reconciled
// Finance roles only; Admin never sees any of this (A-003).
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Dialog } from '../../components/Dialog'
import { documentPath, DOCUMENTS_BUCKET } from '../../components/Attachment'
import { Money, PromptDialog, StatusBadge, useAction } from '../../components/ui'
import { formatDate, formatMoney, parseMoney, todayAccra } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import * as R from '../../resources/definitions'
import { ResourceForm } from '../../resources/ResourceForm'
import type { Row } from '../../resources/types'
import { friendlyError } from '../../resources/useLookups'
import { parseStatementCsv, suggestMatches, type StatementLine } from './statement'

const PURPOSE: Record<string, string> = { operating: 'Operating', collections: 'Collections', payroll: 'Payroll', reserve: 'Reserve / ring-fenced', petty_cash: 'Petty cash' }
const SOURCE: Record<string, string> = {
  receipt: 'Client payment', expense: 'Expense', payment_out: 'Supplier payment', staff_payment: 'Staff payment', transfer: 'Transfer',
  staff_loan: 'Staff loan', loan_repayment: 'Loan repayment', director_txn: "Director's current account", director_payment: 'Payment to director',
  statutory_payment: 'Statutory payment', payroll_run: 'Payroll net pay',
}
const sourceLabel = (t: string) => SOURCE[t] ?? t.replace(/_/g, ' ')

const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`
const monthEnd = (first: string) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10) }
const shiftMonth = (first: string, n: number) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }
const monthLabel = (first: string) => new Date(`${first}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function useAccounts() {
  return useQuery({
    queryKey: ['account-balances'],
    queryFn: async () => {
      const [{ data: bal, error }, { data: acc }] = await Promise.all([
        supabase.from('account_balances').select('*').order('name'),
        supabase.from('accounts').select('id, opening_date, opening_balance'),
      ])
      if (error) throw error
      return (bal ?? []).map((b) => ({ ...b, ...(acc ?? []).find((a) => a.id === b.id) }))
    },
  })
}

// ---------------------------------------------------------------------------
// /accounts
// ---------------------------------------------------------------------------
export function AccountsPage() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const accounts = useAccounts()
  const [editing, setEditing] = useState<'new' | null>(null)
  const navigate = useNavigate()
  const writer = canWrite(role) && R.accounts.createRoles.includes(role!)
  const rows = accounts.data ?? []
  const groups = [
    { title: 'Cash', rows: rows.filter((a) => a.is_active && a.purpose !== 'reserve') },
    { title: 'Ring-fenced (not available cash)', rows: rows.filter((a) => a.is_active && a.purpose === 'reserve') },
    { title: 'Inactive', rows: rows.filter((a) => !a.is_active) },
  ].filter((g) => g.rows.length)
  const lastMonth = shiftMonth(monthOf(todayAccra()), -1)

  return (
    <section>
      <header className="page-header">
        <div><h1>Accounts and balances</h1>
          <p className="muted">Calculated from every confirmed movement since each account's opening balance (D-029). Reconcile each account against its statement every month.</p></div>
        <div className="actions">
          {writer && <button className="primary" onClick={() => setEditing('new')}>+ New account</button>}
          <Link className="button-link" to="/accounts/reconciliations">Reconciliations</Link>
        </div>
      </header>
      {accounts.isLoading ? <p className="muted">Loading…</p> : rows.length === 0 ? (
        <p className="empty">No accounts yet. Add each account with its closing balance on 30 Sep 2026 and the opening date 1 Oct 2026 (D-029).</p>
      ) : groups.map((g) => (
        <div key={g.title}>
          <h2>{g.title}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Account</th><th>Purpose</th><th className="num">Calculated balance</th><th>Last reconciled</th><th className="num">Statement difference</th></tr></thead>
            <tbody>{g.rows.map((a) => {
              const stale = !a.last_reconciled_month || a.last_reconciled_month < lastMonth
              return (
                <tr key={a.id!} className="clickable" onClick={() => navigate(`/accounts/${a.id}`)}>
                  <td><Link to={`/accounts/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.name}</Link>
                    <div className="muted small">{[a.institution, a.last4 && `••${a.last4}`].filter(Boolean).join(' ')}</div></td>
                  <td>{PURPOSE[a.purpose ?? ''] ?? a.purpose}</td>
                  <td><Money value={a.calculated_balance} strong /></td>
                  <td>{a.last_reconciled_month ? monthLabel(a.last_reconciled_month) : <span className="muted">never</span>}
                    {a.is_active && stale && a.opening_date && a.opening_date <= monthEnd(lastMonth) && <div className="warn-text small">{monthLabel(lastMonth)} not reconciled</div>}</td>
                  <td>{a.last_difference && Math.abs(Number(a.last_difference)) > 0.005
                    ? <span className="warn-text">{formatMoney(a.last_difference)} explained</span> : <span className="muted">—</span>}</td>
                </tr>
              )
            })}
            {g.title === 'Cash' && <tr className="total-row"><td colSpan={2}>Total cash</td><td><Money value={g.rows.reduce((s, a) => s + Number(a.calculated_balance ?? 0), 0)} /></td><td colSpan={2} /></tr>}
            </tbody>
          </table></div>
        </div>
      ))}
      {editing && (
        <Dialog title="New account" onClose={() => setEditing(null)}>
          <ResourceForm resource={R.accounts} row={null} preset={{ opening_date: '2026-10-01' }}
            onDone={async () => { setEditing(null); await qc.invalidateQueries({ queryKey: ['account-balances'] }) }} />
        </Dialog>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// /accounts/:id
// ---------------------------------------------------------------------------
type Entry = { id: number; entry_date: string; amount: number; source_type: string; source_id: string; description: string | null }

export function AccountDetail() {
  const { id = '' } = useParams()
  const { role } = useAuth()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const account = useQuery({
    queryKey: ['account', id],
    queryFn: async () => (await supabase.from('accounts').select('*').eq('id', id).maybeSingle()).data,
  })
  const a = account.data
  const [month, setMonth] = useState<string | null>(null)
  const entries = useQuery({
    queryKey: ['account-entries', id],
    enabled: !!a,
    queryFn: async () => ((await supabase.from('ledger_entries').select('id, entry_date, amount, source_type, source_id, description')
      .eq('account_id', id).gte('entry_date', a!.opening_date).order('entry_date').order('id').limit(20000)).data ?? []) as Entry[],
  })
  const recs = useQuery({
    queryKey: ['account-recs', id],
    queryFn: async () => (await supabase.from('reconciliations').select('month, statement_balance, calculated_balance, difference, status, explanation')
      .eq('account_id', id).order('month', { ascending: false })).data ?? [],
  })

  // Running balance from the opening balance (D-029).
  const withBalance = useMemo(() => {
    let bal = Number(a?.opening_balance ?? 0)
    return (entries.data ?? []).map((e) => ({ ...e, balance: (bal = Math.round((bal + Number(e.amount)) * 100) / 100) }))
  }, [entries.data, a?.opening_balance])
  const months = [...new Set(withBalance.map((e) => monthOf(e.entry_date)))].sort().reverse()
  const shown = month ?? months[0] ?? monthOf(todayAccra())
  const inMonth = withBalance.filter((e) => monthOf(e.entry_date) === shown)
  const before = withBalance.filter((e) => e.entry_date < shown)
  const openingForMonth = before.length ? before[before.length - 1].balance : Number(a?.opening_balance ?? 0)

  if (account.isLoading) return <p className="muted">Loading…</p>
  if (!a) return <section><h1>Account</h1><p className="empty">Not found, or your role can't see it.</p></section>
  const current = withBalance.length ? withBalance[withBalance.length - 1].balance : Number(a.opening_balance)

  return (
    <section>
      <p className="small"><Link to="/accounts">Accounts</Link></p>
      <header className="page-header">
        <div><h1>{a.name}</h1>
          <p className="muted">{PURPOSE[a.purpose]} · {[a.institution, a.last4 && `••${a.last4}`].filter(Boolean).join(' ')} · opening balance {formatMoney(a.opening_balance)} at the start of {formatDate(a.opening_date)}
            {a.admin_may_post ? ' · Admin may post to it' : ''}</p></div>
        <div className="actions">
          {canWrite(role) && R.accounts.editRoles.includes(role!) && <button onClick={() => setEditing(true)}>Edit</button>}
          <Link className="button-link" to={`/accounts/reconciliations?account=${a.id}&month=${shown}`}>Reconcile {monthLabel(shown)}</Link>
        </div>
      </header>
      <div className="stats">
        <div className="stat"><span className="label">Calculated balance</span><strong>{formatMoney(current)}</strong>
          <span className="muted small">including entries dated after today</span></div>
        <div className="stat"><span className="label">Last reconciled</span>
          <strong>{recs.data?.find((r) => r.status === 'closed') ? monthLabel(recs.data.find((r) => r.status === 'closed')!.month) : 'Never'}</strong></div>
      </div>
      <div className="month-nav">
        <label className="inline">Month <select value={shown} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }}>
          {(months.length ? months : [shown]).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>What</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th></tr></thead>
        <tbody>
          <tr className="muted"><td>{formatDate(shown)}</td><td>Balance brought forward</td><td /><td /><td><Money value={openingForMonth} /></td></tr>
          {inMonth.map((e) => (
            <tr key={e.id}>
              <td>{formatDate(e.entry_date)}</td>
              <td>{sourceLabel(e.source_type)}{e.description && <span className="muted small"> · {e.description}</span>}</td>
              <td>{e.amount > 0 && <Money value={e.amount} />}</td>
              <td>{e.amount < 0 && <Money value={-e.amount} />}</td>
              <td><Money value={e.balance} /></td>
            </tr>
          ))}
          {inMonth.length === 0 && <tr><td colSpan={5} className="muted">No movements this month.</td></tr>}
        </tbody>
      </table></div>
      {(recs.data ?? []).length > 0 && <>
        <h2>Reconciliations</h2>
        <div className="table-wrap"><table className="compact">
          <thead><tr><th>Month</th><th className="num">Statement</th><th className="num">Calculated</th><th className="num">Difference</th><th>Status</th></tr></thead>
          <tbody>{(recs.data ?? []).map((r) => (
            <tr key={r.month}><td><Link to={`/accounts/reconciliations?account=${a.id}&month=${r.month}`}>{monthLabel(r.month)}</Link></td>
              <td><Money value={r.statement_balance} /></td><td><Money value={r.calculated_balance} /></td><td><Money value={r.difference} /></td>
              <td><StatusBadge status={r.status === 'closed' ? 'reviewed' : 'draft'} label={r.status} />{r.explanation && <div className="muted small">{r.explanation}</div>}</td></tr>
          ))}</tbody>
        </table></div>
      </>}
      {editing && (
        <Dialog title={`Edit ${a.name}`} onClose={() => setEditing(false)}>
          <ResourceForm resource={R.accounts} row={a as unknown as Row} onDone={async () => {
            setEditing(false)
            for (const k of ['account', 'account-balances', 'account-entries']) await qc.invalidateQueries({ queryKey: [k] })
          }} />
        </Dialog>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// /accounts/reconciliations
// ---------------------------------------------------------------------------
type Line = { id: string; import_id: string; line_date: string; description: string | null; reference: string | null; amount: number
  running_balance: number | null; status: string; matched_source_type: string | null; matched_source_id: string | null; explanation: string | null }

export function ReconciliationsPage() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const accounts = useAccounts()
  const active = (accounts.data ?? []).filter((a) => a.is_active)
  const accountId = params.get('account') ?? active[0]?.id ?? ''
  const account = active.find((a) => a.id === accountId) ?? (accounts.data ?? []).find((a) => a.id === accountId)
  const firstMonth = account?.opening_date ? monthOf(account.opening_date) : null
  const defaultMonth = (() => { const m = shiftMonth(monthOf(todayAccra()), -1); return firstMonth && m < firstMonth ? firstMonth : m })()
  const month = params.get('month') ?? defaultMonth
  const end = monthEnd(month)
  const writer = canWrite(role) && (role === 'owner' || role === 'accountant')
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); if (k === 'account') p.delete('month'); setParams(p, { replace: true }) }

  const imports = useQuery({
    queryKey: ['statement-imports', accountId],
    enabled: !!accountId,
    queryFn: async () => (await supabase.from('statement_imports').select('*').eq('account_id', accountId).order('period_end', { ascending: false })).data ?? [],
  })
  const importIds = (imports.data ?? []).map((i) => i.id)
  const lines = useQuery({
    queryKey: ['statement-lines', accountId, importIds.join()],
    enabled: importIds.length > 0,
    queryFn: async () => ((await supabase.from('statement_lines').select('*').in('import_id', importIds).order('line_date').limit(20000)).data ?? []) as Line[],
  })
  const ledger = useQuery({
    queryKey: ['account-entries-range', accountId, month],
    enabled: !!accountId,
    queryFn: async () => ((await supabase.from('ledger_entries').select('id, entry_date, amount, source_type, source_id, description')
      .eq('account_id', accountId).gte('entry_date', shiftMonth(month, -1)).lte('entry_date', monthEnd(shiftMonth(month, 1))).order('entry_date')).data ?? []) as Entry[],
  })
  const calc = useQuery({
    queryKey: ['calc-balance', accountId, end],
    enabled: !!account,
    queryFn: async () => {
      const { data } = await supabase.from('ledger_entries').select('amount').eq('account_id', accountId)
        .gte('entry_date', account!.opening_date!).lte('entry_date', end).limit(50000)
      return Math.round(((data ?? []).reduce((s, e) => s + Number(e.amount), 0) + Number(account!.opening_balance ?? 0)) * 100) / 100
    },
  })
  const rec = useQuery({
    queryKey: ['reconciliation', accountId, month],
    enabled: !!accountId,
    queryFn: async () => (await supabase.from('reconciliations').select('*').eq('account_id', accountId).eq('month', month).maybeSingle()).data,
  })

  const allLines = lines.data ?? []
  const monthLines = allLines.filter((l) => l.line_date >= month && l.line_date <= end)
  const earlierOpen = allLines.filter((l) => l.line_date < month && (l.status === 'unmatched' || l.status === 'record_task'))
  const takenKeys = new Set(allLines.filter((l) => l.status === 'matched').map((l) => `${l.matched_source_type}:${l.matched_source_id}`))
  const entries = (ledger.data ?? []).map((e) => ({ ...e, key: `${e.source_type}:${e.source_id}` }))
  const unmatchedBooks = entries.filter((e) => e.entry_date >= month && e.entry_date <= end && !takenKeys.has(e.key))
  const statementImport = (imports.data ?? []).find((i) => i.period_end === end)
  const open = monthLines.filter((l) => l.status === 'unmatched' || l.status === 'record_task').length

  const refresh = async () => {
    for (const k of ['statement-imports', 'statement-lines', 'reconciliation', 'calc-balance', 'account-balances', 'account-recs']) await qc.invalidateQueries({ queryKey: [k] })
  }
  const [uploading, setUploading] = useState(false)

  if (accounts.isLoading) return <p className="muted">Loading…</p>
  if (active.length === 0) return <section><h1>Reconciliations</h1><p className="empty">Add the accounts first.</p></section>

  return (
    <section>
      <header className="page-header">
        <div><h1>Reconciliations</h1>
          <p className="muted">Upload the statement, match or explain every line, then reconcile the month-end balance. The month can't close until every account is reconciled.</p></div>
        {writer && <div className="actions"><button className="primary" onClick={() => setUploading(true)}>Upload statement</button></div>}
      </header>
      <div className="row-actions" style={{ alignItems: 'end', marginBottom: '1rem' }}>
        <label>Account<select value={accountId} onChange={(e) => set('account', e.target.value)}>
          {active.map((a) => <option key={a.id!} value={a.id!}>{a.name}</option>)}</select></label>
        <label>Month<input type="month" value={month.slice(0, 7)} min={firstMonth?.slice(0, 7)} onChange={(e) => e.target.value && set('month', `${e.target.value}-01`)} /></label>
      </div>

      <RecPanel accountId={accountId} month={month} rec={rec.data ?? null} calculated={calc.data ?? null}
        statementClosing={statementImport ? Number(statementImport.closing_balance) : null} openLines={open + earlierOpen.length}
        writer={writer} onChanged={refresh} />

      {earlierOpen.length > 0 && <p className="warn-text small">{earlierOpen.length} statement line(s) from earlier months are still unmatched; they also block this reconciliation.</p>}

      <h2>Statement lines in {monthLabel(month)}</h2>
      {monthLines.length === 0 ? <p className="empty">No statement lines for this month yet.{writer && ' Upload the statement.'}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Status</th><th>Match</th></tr></thead>
          <tbody>{monthLines.map((l) => (
            <LineRow key={l.id} line={l} entries={entries} taken={takenKeys} writer={writer} onChanged={refresh} />
          ))}</tbody>
        </table></div>
      )}

      <h2>In the books but not on the statement</h2>
      {unmatchedBooks.length === 0 ? <p className="muted small">Every movement this month is matched to a statement line.</p> : (
        <div className="table-wrap"><table className="compact">
          <thead><tr><th>Date</th><th>What</th><th className="num">Amount</th></tr></thead>
          <tbody>{unmatchedBooks.map((e) => (
            <tr key={e.id}><td>{formatDate(e.entry_date)}</td><td>{sourceLabel(e.source_type)}{e.description && <span className="muted small"> · {e.description}</span>}</td><td><Money value={e.amount} /></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {uploading && account && <UploadStatement account={{ id: account.id!, name: account.name! }} month={month} onClose={() => setUploading(false)} onSaved={refresh} />}
    </section>
  )
}

function RecPanel({ accountId, month, rec, calculated, statementClosing, openLines, writer, onChanged }: {
  accountId: string; month: string
  rec: { id: string; statement_balance: number; calculated_balance: number; difference: number; explanation: string | null; status: string; closed_at: string | null } | null
  calculated: number | null; statementClosing: number | null; openLines: number; writer: boolean; onChanged: () => Promise<void>
}) {
  const [balance, setBalance] = useState<string>('')
  const [explanation, setExplanation] = useState<string>('')
  const action = useAction()
  const key = `${accountId}-${month}-${rec?.id ?? ''}-${statementClosing ?? ''}`
  const [seen, setSeen] = useState('')
  if (seen !== key) {   // reset the inputs when the account or month changes
    setSeen(key)
    setBalance(rec ? String(rec.statement_balance) : statementClosing !== null ? String(statementClosing) : '')
    setExplanation(rec?.explanation ?? '')
  }
  const stmt = parseMoney(balance)
  const diff = stmt !== null && calculated !== null ? Math.round((stmt - calculated) * 100) / 100 : null
  const closed = rec?.status === 'closed'

  const save = (close: boolean) => action.run(async () => {
    if (stmt === null) return 'Enter the statement\'s closing balance for the month.'
    const row = { account_id: accountId, month, statement_balance: stmt, explanation: explanation.trim() || null, ...(close ? { status: 'closed' } : {}) }
    const { error } = rec
      ? await supabase.from('reconciliations').update(row).eq('id', rec.id)
      : await supabase.from('reconciliations').insert(row)
    if (error) return friendlyError(error)
    await onChanged()
  })

  return (
    <div className="panel">
      <h3>{monthLabel(month)} {closed ? <StatusBadge status="reviewed" label="reconciled" /> : rec ? <StatusBadge status="draft" label="in progress" /> : null}</h3>
      <form className="form-grid" onSubmit={(e: FormEvent) => { e.preventDefault(); save(false) }}>
        <label>Statement closing balance<input inputMode="decimal" value={balance} disabled={!writer || closed} onChange={(e) => setBalance(e.target.value)} />
          {statementClosing !== null && !rec && <span className="help">From the uploaded statement.</span>}</label>
        <div>
          <dl className="facts">
            <dt>Calculated balance</dt><dd>{calculated === null ? '—' : formatMoney(calculated)}</dd>
            <dt>Difference</dt><dd className={diff !== null && Math.abs(diff) > 0.005 ? 'warn-text' : 'ok-text'}>{diff === null ? '—' : formatMoney(diff)}</dd>
            <dt>Lines to match</dt><dd className={openLines ? 'warn-text' : 'ok-text'}>{openLines}</dd>
          </dl>
        </div>
        {(diff !== null && Math.abs(diff) > 0.005) || rec?.explanation ? (
          <label className="field-textarea">Explain the difference<textarea rows={2} value={explanation} disabled={!writer || closed} onChange={(e) => setExplanation(e.target.value)} />
            <span className="help">e.g. bank charges not yet recorded (better: record them as an expense so the difference disappears).</span></label>
        ) : null}
        {writer && !closed && (
          <div className="form-actions field-textarea">
            <button disabled={action.busy}>Save</button>
            <button type="button" className="primary" disabled={action.busy || openLines > 0 || stmt === null} onClick={() => save(true)}>Reconcile {monthLabel(month)}</button>
          </div>
        )}
      </form>
      {closed && <p className="muted small">Reconciled {formatDate(rec?.closed_at)}: statement {formatMoney(rec?.statement_balance)}, calculated {formatMoney(rec?.calculated_balance)}.</p>}
      {action.error && <p className="form-error">{action.error}</p>}
    </div>
  )
}

function LineRow({ line: l, entries, taken, writer, onChanged }: {
  line: Line; entries: (Entry & { key: string })[]; taken: Set<string>; writer: boolean; onChanged: () => Promise<void>
}) {
  const action = useAction()
  const navigate = useNavigate()
  const [explaining, setExplaining] = useState(false)
  const open = l.status === 'unmatched' || l.status === 'record_task'
  const suggestions = open ? suggestMatches(l, entries, taken) : []
  const matched = l.status === 'matched' ? entries.find((e) => e.source_type === l.matched_source_type && e.source_id === l.matched_source_id) : null
  const update = (patch: { status: string; matched_source_type?: string | null; matched_source_id?: string | null; explanation?: string | null }) =>
    action.run(async () => {
      const { error } = await supabase.from('statement_lines').update(patch).eq('id', l.id)
      if (error) return friendlyError(error)
      await onChanged()
    })

  return (
    <tr className={open ? 'row-bad' : undefined}>
      <td>{formatDate(l.line_date)}</td>
      <td>{l.description ?? '—'}{l.reference && <div className="muted small">{l.reference}</div>}</td>
      <td><Money value={l.amount} /></td>
      <td><StatusBadge status={l.status === 'matched' ? 'reviewed' : l.status === 'explained' ? 'approved' : l.status === 'record_task' ? 'reported' : 'queried'}
        label={l.status === 'record_task' ? 'with Admin' : l.status} />
        {l.explanation && <div className="muted small">{l.explanation}</div>}</td>
      <td>
        {matched && <span className="small">{sourceLabel(matched.source_type)} {formatDate(matched.entry_date)}</span>}
        {l.status === 'matched' && !matched && <span className="muted small">{sourceLabel(l.matched_source_type ?? '')}</span>}
        {writer && open && (
          <div className="row-actions">
            {suggestions.slice(0, 3).map((s) => (
              <button key={s.key} disabled={action.busy} onClick={() => update({ status: 'matched', matched_source_type: s.source_type, matched_source_id: s.source_id })}>
                Match: {sourceLabel(s.source_type)} {formatDate(s.entry_date)}</button>
            ))}
            {l.amount > 0 && l.status === 'unmatched' && (
              <button disabled={action.busy} onClick={() => update({ status: 'record_task' })} title="Gives Admin a 'Record this receipt' task">Ask Admin to record it</button>)}
            {l.amount > 0 && <Link to={`/receipts/new?statement_line=${l.id}`} onClick={async (e) => {
              if (l.status !== 'record_task') { e.preventDefault(); if (await update({ status: 'record_task' })) navigate(`/receipts/new?statement_line=${l.id}`) }
            }}>Record it now</Link>}
            <button className="link" onClick={() => setExplaining(true)}>Explain</button>
          </div>
        )}
        {writer && !open && <button className="link" disabled={action.busy} onClick={() => update({ status: 'unmatched', matched_source_type: null, matched_source_id: null, explanation: null })}>Undo</button>}
        {action.error && <p className="form-error small">{action.error}</p>}
        {explaining && <PromptDialog title="Explain this line" label="Why it isn't in the books (e.g. bank charge recorded in a later month)" confirmLabel="Save"
          onClose={() => setExplaining(false)}
          onSubmit={async (text) => {
            const { error } = await supabase.from('statement_lines').update({ status: 'explained', explanation: text }).eq('id', l.id)
            if (error) return friendlyError(error)
            await onChanged(); return null
          }} />}
      </td>
    </tr>
  )
}

function UploadStatement({ account, month, onClose, onSaved }: { account: { id: string; name: string }; month: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [start, setStart] = useState(month)
  const [end, setEnd] = useState(monthEnd(month))
  const [opening, setOpening] = useState('')
  const [closing, setClosing] = useState('')
  const [parsed, setParsed] = useState<{ lines: StatementLine[]; errors: string[]; columns: Record<string, string> } | null>(null)
  const [fileName, setFileName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const action = useAction()
  const inPeriod = (parsed?.lines ?? []).filter((l) => l.line_date >= start && l.line_date <= end)
  const outside = (parsed?.lines.length ?? 0) - inPeriod.length
  const movement = inPeriod.reduce((s, l) => s + l.amount, 0)
  const op = parseMoney(opening); const cl = parseMoney(closing)
  const adds = op !== null && cl !== null ? Math.abs(op + movement - cl) < 0.005 : null

  async function onFile(f: File | undefined) {
    if (!f) return
    setFileName(f.name)
    setFile(f)
    const r = parseStatementCsv(await f.text())
    setParsed(r as typeof parsed)
    const withBal = r.lines.filter((l) => l.running_balance !== null)
    if (withBal.length && !closing) setClosing(String(withBal[withBal.length - 1].running_balance))
    if (withBal.length && !opening) setOpening(String(Math.round((withBal[0].running_balance! - withBal[0].amount) * 100) / 100))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const ok = await action.run(async () => {
      if (cl === null) return 'Enter the statement\'s closing balance.'
      if (parsed?.errors.length) return 'Fix the lines the statement couldn\'t read first.'
      const { data: imp, error } = await supabase.from('statement_imports').insert({
        account_id: account.id, period_start: start, period_end: end, opening_balance: op, closing_balance: cl,
        source_format: parsed ? 'generic_csv' : 'balance_only',
      }).select('id').single()
      if (error) return friendlyError(error)
      if (inPeriod.length) {
        const { error: e2 } = await supabase.from('statement_lines').insert(inPeriod.map((l) => ({ ...l, import_id: imp.id })))
        if (e2) { await supabase.from('statement_imports').delete().eq('id', imp.id); return friendlyError(e2) }
      }
      if (file) {   // keep the original with the import; a failure here doesn't undo the lines
        const path = documentPath('statement_imports', imp.id, file.name)
        const { error: e3 } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, { contentType: file.type || 'text/csv' })
        if (!e3) await supabase.from('statement_imports').update({ file_path: path }).eq('id', imp.id)
      }
      await onSaved()
    })
    if (ok) onClose()
  }

  return (
    <Dialog title={`Upload statement: ${account.name}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <p className="muted small">Export the statement from internet banking as CSV. The Prudential Bank and MTN MoMo formats get their own readers once samples arrive; until then any CSV with Date, Description and Amount (or Debit and Credit) headings works.</p>
        <label className="file-picker">{fileName || 'Choose the statement CSV'}<input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        {parsed && <>
          {parsed.errors.length > 0 ? <div className="form-error"><ul className="checks">{parsed.errors.slice(0, 10).map((x) => <li key={x}>{x}</li>)}</ul></div>
            : <p className="form-ok small">{inPeriod.length} line(s) read for the period (columns: {Object.entries(parsed.columns).map(([k, v]) => `${k} = "${v}"`).join(', ')}).
              {outside > 0 && ` ${outside} line(s) outside the period are left out.`}</p>}
        </>}
        <div className="form-grid">
          <label>Period from<input type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
          <label>to<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
          <label>Opening balance<input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></label>
          <label>Closing balance<input inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} required /></label>
        </div>
        {adds === false && <p className="warn-text small">Opening {formatMoney(op)} + lines {formatMoney(movement)} = {formatMoney((op ?? 0) + movement)}, not the closing {formatMoney(cl)}. Check that the file has every line.</p>}
        {adds === true && <p className="ok-text small">Opening + lines = closing balance.</p>}
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Save statement</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  )
}
