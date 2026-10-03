// Home screens by role (brief §6; A-010, A-041). Every tile opens its list.
//   Owner        Money, Pipeline (Phase B), Delivery, and what awaits approval
//   Director     the Owner's panels, read-only, no approval queue, monthly summary
//   Accountant   Money panel in full, review queue, month-close status
//   Admin        a task list, no balances or totals
//   Project lead approvals, team hours, missing days, Delivery
//   Staff        my hours, leave, payslip, claims
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { ROLE_LABELS } from '../../auth/roles'
import { Money, StatusBadge } from '../../components/ui'
import { formatDate, formatMoney, todayAccra } from '../../lib/format'
import { defaultCloseMonth, GO_LIVE_MONTH } from '../../lib/golive'
import { supabase } from '../../lib/supabase'
import { useSetupStatus } from '../settings/SettingsPages'

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const mondayOf = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7))
const monthFirst = (iso: string) => `${iso.slice(0, 7)}-01`
const shiftMonth = (first: string, n: number) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }
const monthName = (first: string) => new Date(`${first}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
function Tile({ to, label, value, note, tone }: { to: string; label: string; value: ReactNode; note?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <Link className="stat" to={to}>
      <span className="label">{label}</span>
      <strong className={tone}>{value}</strong>
      {note && <span className="muted small">{note}</span>}
    </Link>
  )
}

function Panel({ title, question, children }: { title: string; question?: string; children: ReactNode }) {
  return (
    <section className="home-panel">
      <h2>{title}{question && <span className="muted small"> {question}</span>}</h2>
      {children}
    </section>
  )
}

function TaskList({ items, empty }: { items: { key: string; to: string; text: ReactNode; due?: string | null; tone?: 'warn' | 'bad' }[]; empty: string }) {
  if (items.length === 0) return <p className="empty">{empty}</p>
  return (
    <ul className="task-list">{items.map((t) => (
      <li key={t.key}><Link to={t.to}>{t.text}</Link>
        {t.due && <span className={`small ${t.tone === 'bad' ? 'bad' : t.tone === 'warn' ? 'warn-text' : 'muted'}`}>{formatDate(t.due)}</span>}</li>
    ))}</ul>
  )
}

// ---------------------------------------------------------------------------
// Money panel (Owner, Directors, Accountant)
// ---------------------------------------------------------------------------
interface MoneyPanelData {
  accounts: { id: string; name: string; purpose: string; balance: number; last_reconciled_month: string | null; difference: number | null; opening_date: string }[]
  reserved_for_commitments: number
  committed_cash: number
  available_cash: number
  monthly_running_cost: { calculated: number; override: number | null; payroll: number; recurring: number; prepayments: number }
  weeks_of_cover: number | null
  receivables: { total: number; ageing: Record<string, number>; top_debtors: { name: string; amt: number }[]; reported_unconfirmed: number; retention_held: number }
  statutory: {
    due_next_30_days: { id: string; label: string; due_date: string; outstanding: number }[]
    arrears: { id: string; label: string; outstanding: number; notes: string | null; credit_applied: number }[]
    credits: { id: string; authority: string; description: string; amount: number; applied: number; remaining: number; auto_offset_type: string | null }[]
  }
  vat_this_month: number
  wht_credits_this_year: { total: number; certificates_to_collect: number }
  ready_to_invoice_count: number
  awaiting_owner_approval: { invoices: number; payments_out: number }
  fees_this_month: { invoiced: number; received: number; target: number | null }
}

function useMoneyPanel() {
  return useQuery({
    queryKey: ['money-panel'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('money_panel', {})
      if (error) throw error
      return data as unknown as MoneyPanelData | null
    },
  })
}

function MoneyPanel({ showApprovals }: { showApprovals: boolean }) {
  const { data: m, isLoading } = useMoneyPanel()
  if (isLoading) return <Panel title="Money" question="Am I safe?"><p className="muted">Loading…</p></Panel>
  if (!m) return null
  const cover = m.weeks_of_cover
  const coverTone = cover === null ? undefined : cover > 8 ? 'ok' : cover >= 4 ? 'warn' : 'bad'
  const running = m.monthly_running_cost
  const cash = m.accounts.filter((a) => a.purpose !== 'reserve')
  const reserve = m.accounts.filter((a) => a.purpose === 'reserve')
  const lastMonth = shiftMonth(monthFirst(todayAccra()), -1)
  const lastMonthEnd = addDays(monthFirst(todayAccra()), -1)
  const target = m.fees_this_month.target

  return (
    <Panel title="Money" question="Am I safe?">
      <div className="stats">
        <Tile to="/accounts" label="Available cash" value={formatMoney(m.available_cash)}
          note={<>confirmed operating cash − {formatMoney(m.reserved_for_commitments)} reserved − {formatMoney(m.committed_cash)} committed</>} />
        <Tile to={cover === null ? '/payroll' : '/accounts'} label="Weeks of cover" value={cover === null ? 'Not yet' : `${cover} weeks`} tone={coverTone}
          note={cover === null
            ? 'Add a payroll run or recurring expenses to calculate.'
            : <>running cost {formatMoney(running.override ?? running.calculated)} a month{running.override !== null && <> (override; calculated {formatMoney(running.calculated)})</>}</>} />
        <Tile to="/invoices" label="Owed to MeLiNS" value={formatMoney(m.receivables.total)}
          note={['0-30', '31-60', '61-90', '90+'].map((b) => `${b}: ${formatMoney(m.receivables.ageing[b] ?? 0, false)}`).join(' · ')} />
        <Tile to="/invoices" label={`Fees ${monthName(monthFirst(todayAccra()))}`} value={formatMoney(m.fees_this_month.invoiced)}
          note={<>invoiced · {formatMoney(m.fees_this_month.received)} received{target ? <> · target {formatMoney(target)}</> : null}</>}
          tone={target && m.fees_this_month.invoiced < target ? 'warn' : undefined} />
      </div>

      <div className="detail-grid">
        <div className="panel">
          <h3>Cash by account</h3>
          <table className="compact"><tbody>
            {cash.map((a) => (
              <tr key={a.id}><td><Link to={`/accounts/${a.id}`}>{a.name}</Link>
                {a.opening_date <= lastMonthEnd && (!a.last_reconciled_month || a.last_reconciled_month < lastMonth) && <span className="warn-text small"> not reconciled for {monthName(lastMonth)}</span>}
                {a.difference !== null && Math.abs(a.difference) > 0.005 && <span className="warn-text small"> statement differs by {formatMoney(a.difference)}</span>}</td>
                <td><Money value={a.balance} /></td></tr>
            ))}
            {reserve.length > 0 && <tr><td colSpan={2} className="muted small">Ring-fenced (not in available cash)</td></tr>}
            {reserve.map((a) => <tr key={a.id}><td><Link to={`/accounts/${a.id}`}>{a.name}</Link></td><td><Money value={a.balance} /></td></tr>)}
            {m.accounts.length === 0 && <tr><td className="muted">No accounts yet.</td></tr>}
          </tbody></table>
          <h3 style={{ marginTop: '1rem' }}>Committed and reserved</h3>
          <table className="compact"><tbody>
            <tr><td><Link to="/payments-out">Committed cash</Link> <span className="muted small">owed to staff, suppliers and directors; approved not paid</span></td><td><Money value={m.committed_cash} /></td></tr>
            <tr><td><Link to="/commitments">Reserved for commitments</Link> <span className="muted small">Phase C</span></td><td><Money value={m.reserved_for_commitments} /></td></tr>
          </tbody></table>
        </div>
        <div className="panel">
          <h3>Owed to MeLiNS</h3>
          <table className="compact"><tbody>
            {m.receivables.top_debtors.map((d) => <tr key={d.name}><td>{d.name}</td><td><Money value={d.amt} /></td></tr>)}
            {m.receivables.top_debtors.length === 0 && <tr><td className="muted">Nothing outstanding.</td></tr>}
            <tr><td><Link to="/receipts">Reported, not yet confirmed</Link></td><td><Money value={m.receivables.reported_unconfirmed} /></td></tr>
            <tr><td><Link to="/invoices/retention">Retention held by clients</Link></td><td><Money value={m.receivables.retention_held} /></td></tr>
          </tbody></table>
          <h3 style={{ marginTop: '1rem' }}>Tax and statutory</h3>
          <table className="compact"><tbody>
            {m.statutory.due_next_30_days.map((s) => (
              <tr key={s.id}><td><Link to="/tax/statutory">{s.label}</Link> <span className="muted small">due {formatDate(s.due_date)}</span></td><td><Money value={s.outstanding} /></td></tr>
            ))}
            {m.statutory.due_next_30_days.length === 0 && <tr><td className="muted">Nothing due in the next 30 days.</td></tr>}
            {m.statutory.arrears.map((a) => (
              <tr key={a.id} className="row-bad"><td><Link to="/tax/statutory">{a.label} arrears</Link>
                {a.notes && <span className="muted small"> · {a.notes}</span>}
                {a.credit_applied > 0 && <span className="muted small"> · {formatMoney(a.credit_applied)} offset by credit</span>}</td>
                <td><Money value={a.outstanding} /></td></tr>
            ))}
            {m.statutory.credits.map((c) => (
              <tr key={c.id}><td><Link to="/tax/statutory?tab=credits">{c.authority} owes MeLiNS: {c.description}</Link>
                <span className="muted small"> · {c.auto_offset_type === 'vat' ? 'offset against VAT returns as they fall due' : 'apply with GRA\'s approval'}
                  {c.applied > 0 && `, ${formatMoney(c.applied)} of ${formatMoney(c.amount)} used`}</span></td>
                <td className="ok-text"><Money value={c.remaining} /></td></tr>
            ))}
            <tr><td><Link to={`/tax/vat/${todayAccra().slice(0, 7)}`}>VAT position this month</Link> <span className="muted small">output − claimable input</span></td><td><Money value={m.vat_this_month} /></td></tr>
            <tr><td><Link to="/receipts/wht">WHT credits this year</Link> <span className="muted small">{m.wht_credits_this_year.certificates_to_collect} certificate(s) to collect</span></td><td><Money value={m.wht_credits_this_year.total} /></td></tr>
          </tbody></table>
        </div>
      </div>
      <div className="stats">
        <Tile to="/invoices/ready" label="Ready to invoice" value={m.ready_to_invoice_count} note="milestones reached, rechargeables not billed" />
        {showApprovals && <>
          <Tile to="/invoices" label="Invoices to approve" value={m.awaiting_owner_approval.invoices} tone={m.awaiting_owner_approval.invoices ? 'warn' : undefined} />
          <Tile to="/payments-out" label="Payments out to approve" value={m.awaiting_owner_approval.payments_out} tone={m.awaiting_owner_approval.payments_out ? 'warn' : undefined}
            note="supplier, staff, director and statutory" />
        </>}
        <Tile to="/overheads" label="Overheads vs budget" value="—" note="Phase C" />
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Delivery panel (basic, Phase A): jobs flagged, utilisation, who's away,
// approvals waiting, missing timesheets
// ---------------------------------------------------------------------------
function DeliveryPanel({ teamOnly }: { teamOnly?: boolean }) {
  const { profile } = useAuth()
  const today = todayAccra()
  const mon = mondayOf(today)
  const flagged = useQuery({ queryKey: ['jobs-flagged'], queryFn: async () => (await supabase.from('jobs_flagged').select('*').order('due_date')).data ?? [] })
  const util = useQuery({
    queryKey: ['utilisation', monthFirst(today)],
    queryFn: async () => (await supabase.rpc('utilisation', { p_from: shiftMonth(monthFirst(today), -3), p_to: today })).data ?? [],
  })
  const away = useQuery({
    queryKey: ['leave-calendar', 'home'],
    queryFn: async () => (await supabase.from('leave_calendar').select('*').lte('start_date', addDays(mon, 13)).gte('end_date', mon)).data ?? [],
  })
  const pendingLeave = useQuery({
    queryKey: ['leave-requests', 'pending-count'],
    queryFn: async () => (await supabase.from('leave_requests').select('id, staff:staff(approver_staff_id)').eq('status', 'requested')).data ?? [],
  })
  const pendingTime = useQuery({
    queryKey: ['timesheet-approvals', 'count'],
    queryFn: async () => (await supabase.from('timesheet_entries').select('staff_id, staff:staff(approver_staff_id)').eq('status', 'submitted')).data ?? [],
  })
  const missing = useQuery({
    queryKey: ['missing-days', mon],
    queryFn: async () => (await supabase.rpc('missing_timesheet_days', { p_from: addDays(mon, -7), p_to: addDays(mon, -1) })).data ?? [],
  })
  const mine = <T extends { staff?: { approver_staff_id: string | null } | null }>(rows: T[]) =>
    teamOnly ? rows.filter((r) => r.staff?.approver_staff_id === profile?.staff_id) : rows
  const leaveCount = mine(pendingLeave.data ?? []).length
  const timeCount = mine(pendingTime.data ?? []).length
  const missingBy = new Map<string, number>()
  for (const d of missing.data ?? []) missingBy.set(d.full_name, (missingBy.get(d.full_name) ?? 0) + 1)
  const months = [...new Set((util.data ?? []).map((u) => u.month))].sort()
  const people = [...new Set((util.data ?? []).map((u) => u.full_name))]
  const thisWeek = (away.data ?? []).filter((a) => a.start_date! <= addDays(mon, 6))
  const nextWeek = (away.data ?? []).filter((a) => a.end_date! >= addDays(mon, 7))

  return (
    <Panel title="Delivery" question="Is anything slipping?">
      <div className="stats">
        <Tile to="/timesheet/approvals" label="Timesheet entries to approve" value={timeCount} tone={timeCount ? 'warn' : undefined} />
        <Tile to="/leave" label="Leave requests to decide" value={leaveCount} tone={leaveCount ? 'warn' : undefined} />
        <Tile to="/jobs" label="Jobs flagged" value={(flagged.data ?? []).length} tone={(flagged.data ?? []).length ? 'bad' : 'ok'} note="past due or over hours budget" />
        <Tile to="/team" label="Missing days last week" value={[...missingBy.values()].reduce((a, b) => a + b, 0)}
          note={[...missingBy.entries()].map(([n, c]) => `${n.split(' ')[0]} ${c}`).join(' · ') || 'everyone logged'} />
      </div>
      <div className="detail-grid">
        <div className="panel">
          <h3>Jobs flagged</h3>
          {(flagged.data ?? []).length === 0 ? <p className="muted small">Nothing past due or over its hours budget.</p> : (
            <table className="compact"><tbody>{(flagged.data ?? []).map((j) => (
              <tr key={j.job_id}><td><Link to={`/jobs/${j.job_number}${j.over_hours_budget ? '?tab=budget' : ''}`}>{j.job_number} {j.title}</Link></td>
                <td className="small">{j.past_due && <span className="bad">past due {formatDate(j.due_date)}</span>} {j.over_hours_budget && <span className="warn-text">over hours budget</span>}</td></tr>
            ))}</tbody></table>
          )}
          <h3 style={{ marginTop: '1rem' }}>Who's away</h3>
          <p className="small"><strong>This week:</strong> {thisWeek.length ? thisWeek.map((a) => `${a.full_name} (to ${formatDate(a.end_date)})`).join(', ') : 'nobody'}</p>
          <p className="small"><strong>Next week:</strong> {nextWeek.length ? nextWeek.map((a) => `${a.full_name} (from ${formatDate(a.start_date)})`).join(', ') : 'nobody'}</p>
          <p className="small"><Link to="/leave/calendar">Leave calendar</Link> · <span className="muted">Upcoming trips arrive in Phase B.</span></p>
        </div>
        <div className="panel">
          <h3>Utilisation <span className="muted small">billable hours as % of target (reduced for leave and holidays)</span></h3>
          {people.length === 0 ? <p className="muted small">No staff yet.</p> : (
            <div className="table-wrap"><table className="compact">
              <thead><tr><th>Person</th>{months.map((m) => <th key={m} className="num">{monthName(m)}</th>)}</tr></thead>
              <tbody>{people.map((p) => (
                <tr key={p}><td>{p}</td>{months.map((m) => {
                  const u = (util.data ?? []).find((x) => x.full_name === p && x.month === m)
                  const pct = u?.utilisation_pct
                  return <td key={m} className={`num ${pct === null || pct === undefined ? 'muted' : pct >= 80 ? 'ok-text' : pct < 50 ? 'bad' : ''}`}>{pct === null || pct === undefined ? '—' : `${pct}%`}</td>
                })}</tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </Panel>
  )
}

function PipelinePanel() {
  return (
    <Panel title="Pipeline" question="Where is the next fee coming from?">
      <p className="empty">Leads, quotes, tenders and referral sources arrive in Phase B. Log new work as jobs for now.</p>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Homes
// ---------------------------------------------------------------------------
export function Home() {
  const { role } = useAuth()
  switch (role) {
    case 'owner': return <OwnerHome />
    case 'director': return <DirectorHome />
    case 'accountant': return <AccountantHome />
    case 'admin': return <AdminHome />
    case 'project_lead': return <ProjectLeadHome />
    default: return <StaffHome />
  }
}

function Greeting({ children }: { children?: ReactNode }) {
  const { profile, role } = useAuth()
  return (
    <header className="page-header">
      <div><h1>Welcome, {profile?.full_name.split(' ')[0]}</h1>
        <p className="muted">{role ? ROLE_LABELS[role] : ''} · {formatDate(todayAccra())}{role === 'director' ? '. You can see everything, and change nothing.' : ''}</p></div>
      {children && <div className="actions">{children}</div>}
    </header>
  )
}

function SetupBanner() {
  const { data: s } = useSetupStatus()
  if (!s) return null
  const steps = [s.company, s.accounts, s.taxCodes, s.arrears, s.wht, s.bonus, s.users]
  const done = steps.filter(Boolean).length
  if (done === steps.length) return null
  return <p className="notice form-ok" style={{ maxWidth: 'none' }}><strong>Setup: {done} of {steps.length} steps done.</strong>{' '}
    <Link to="/settings?tab=setup">Finish setting up</Link> (company and tax details, accounts, tax codes, arrears, WHT rates, bonus rule, users).</p>
}

function OwnerHome() {
  return (
    <section>
      <SetupBanner />
      <Greeting>
        <Link className="button-link primary-link" to="/receipts?new=quick">+ Payment received</Link>
        <Link className="button-link" to="/timesheet">Log time</Link>
      </Greeting>
      <MoneyPanel showApprovals />
      <PipelinePanel />
      <DeliveryPanel />
    </section>
  )
}

function DirectorHome() {
  const last = defaultCloseMonth(todayAccra())
  return (
    <section>
      <Greeting><Link className="button-link" to={`/reports/monthly?month=${last.slice(0, 7)}`}>Monthly summary</Link></Greeting>
      <MoneyPanel showApprovals={false} />
      <PipelinePanel />
      <DeliveryPanel />
    </section>
  )
}

function AccountantHome() {
  const q = useQuery({
    queryKey: ['accountant-queue'],
    queryFn: async () => (await supabase.rpc('accountant_queue')).data as unknown as {
      entries_to_review: number; oldest_entry: string | null; owner_confirmed_payments: number; payments_to_confirm: number
      unreconciled_accounts: number; last_closed_month: string | null } | null,
  })
  const closeMonth = defaultCloseMonth(todayAccra())
  const d = q.data
  return (
    <section>
      <Greeting />
      <div className="stats">
        <Tile to={`/close/${closeMonth.slice(0, 7)}`} label="Entries to review" value={d?.entries_to_review ?? '…'}
          note={d?.oldest_entry ? `oldest ${formatDate(d.oldest_entry)}` : 'nothing waiting'} tone={d?.entries_to_review ? 'warn' : 'ok'} />
        <Tile to="/receipts" label="Reported payments to confirm" value={d?.payments_to_confirm ?? '…'} tone={d?.payments_to_confirm ? 'warn' : 'ok'}
          note={d?.owner_confirmed_payments ? `${d.owner_confirmed_payments} confirmed by the Owner to review` : undefined} />
        <Tile to="/accounts/reconciliations" label="Accounts not reconciled for last month" value={d?.unreconciled_accounts ?? '…'} tone={d?.unreconciled_accounts ? 'warn' : 'ok'} />
        <Tile to={`/close/${closeMonth.slice(0, 7)}`} label="Month close" value={d?.last_closed_month ? `${monthName(d.last_closed_month)} closed` : 'None closed yet'}
          note={`next: ${monthName(d?.last_closed_month && d.last_closed_month >= GO_LIVE_MONTH ? shiftMonth(d.last_closed_month, 1) : GO_LIVE_MONTH)}, by the 10th`} />
      </div>
      <MoneyPanel showApprovals={false} />
    </section>
  )
}

function AdminHome() {
  const today = todayAccra()
  const actions = useQuery({
    queryKey: ['my-actions'],
    queryFn: async () => (await supabase.from('action_items').select('id, kind, title, link, due_date, created_at').eq('status', 'open').order('created_at')).data ?? [],
  })
  const chase = useQuery({
    queryKey: ['invoices-to-chase'],
    queryFn: async () => (await supabase.from('invoices_to_chase').select('*').order('due_date')).data ?? [],
  })
  const ready = useQuery({ queryKey: ['ready-to-invoice'], queryFn: async () => (await supabase.from('ready_to_invoice').select('item_id, job_number, description, ready_since')).data ?? [] })
  const certs = useQuery({
    queryKey: ['wht-to-request'],
    queryFn: async () => (await supabase.from('wht_certificates').select('id, amount, expected_by, client:clients(name)').eq('status', 'expected').lte('expected_by', today).order('expected_by')).data ?? [],
  })
  const groups: { title: string; kinds: string[] }[] = [
    { title: 'Payments approved, ready to pay', kinds: ['pay_approved'] },
    { title: 'Invoices approved, ready to send', kinds: ['send_invoice'] },
    { title: 'Reported payments needing details', kinds: ['complete_reported_payment'] },
    { title: '"Record this receipt"', kinds: ['record_receipt'] },
    { title: 'Recurring-expense drafts to confirm', kinds: ['confirm_recurring_draft'] },
    { title: 'Queried entries to fix', kinds: ['fix_queried_entry'] },
  ]
  const all = actions.data ?? []
  const known = new Set(groups.flatMap((g) => g.kinds))
  const chaseToday = (chase.data ?? []).filter((c) => c.chase_step)
  const overdue = (chase.data ?? []).filter((c) => !c.chase_step && (c.days_overdue ?? 0) > 0)
  const STEP: Record<string, string> = { due_in_7: 'due in 7 days', due_today: 'due today', overdue_14: '14 days overdue', overdue_30: '30 days overdue', overdue_60: '60 days overdue' }

  return (
    <section>
      <Greeting>
        <Link className="button-link" to="/expenses">Record an expense</Link>
        <Link className="button-link" to="/receipts">Record a payment</Link>
      </Greeting>
      <div className="task-columns">
        {groups.map((g) => {
          const rows = all.filter((a) => g.kinds.includes(a.kind))
          return (
            <div key={g.title} className="panel">
              <h3>{g.title} <span className="muted small">({rows.length})</span></h3>
              <TaskList items={rows.map((a) => ({ key: a.id, to: a.link, text: a.title, due: a.due_date, tone: a.due_date && a.due_date < today ? 'bad' : undefined }))} empty="Nothing to do." />
            </div>
          )
        })}
        <div className="panel">
          <h3>Invoices to chase today <span className="muted small">({chaseToday.length})</span></h3>
          <TaskList items={chaseToday.map((c) => ({ key: c.id!, to: `/invoices/${c.invoice_number}`, text: <>{c.invoice_number} · {c.client_name} · <strong>{STEP[c.chase_step!]}</strong></> }))} empty="No chase reminders today." />
          {overdue.length > 0 && <p className="small muted">{overdue.length} other overdue invoice(s) on the <Link to="/invoices">invoices list</Link>.</p>}
        </div>
        <div className="panel">
          <h3>Invoices to draft <span className="muted small">({(ready.data ?? []).length})</span></h3>
          <TaskList items={(ready.data ?? []).map((r) => ({ key: r.item_id!, to: '/invoices/ready', text: `${r.job_number} · ${r.description}`, due: r.ready_since }))} empty="Nothing ready to invoice." />
        </div>
        <div className="panel">
          <h3>WHT certificates to request <span className="muted small">({(certs.data ?? []).length})</span></h3>
          <TaskList items={(certs.data ?? []).map((c) => ({ key: c.id, to: '/receipts/wht', text: `${c.client?.name}: certificate expected`, due: c.expected_by, tone: 'warn' }))} empty="None overdue." />
        </div>
        {all.some((a) => !known.has(a.kind)) && (
          <div className="panel">
            <h3>Other tasks</h3>
            <TaskList items={all.filter((a) => !known.has(a.kind)).map((a) => ({ key: a.id, to: a.link, text: a.title, due: a.due_date }))} empty="" />
          </div>
        )}
        <div className="panel"><h3>Documents expiring</h3><p className="muted small">Compliance documents arrive in Phase C.</p></div>
      </div>
      <p className="small"><Link to={`/close/${defaultCloseMonth(today).slice(0, 7)}`}>Your month-close checklist</Link> (by the 3rd working day)</p>
    </section>
  )
}

function ProjectLeadHome() {
  const { profile } = useAuth()
  const today = todayAccra()
  const claims = useQuery({
    queryKey: ['claims-to-approve', 'count'],
    queryFn: async () => (await supabase.from('expenses').select('id, staff:staff(approver_staff_id)').eq('payment_source', 'staff_out_of_pocket').eq('reimbursement_status', 'owed')).data ?? [],
  })
  const milestones = useQuery({
    queryKey: ['milestones-due'],
    queryFn: async () => (await supabase.from('billing_milestones').select('id, name, target_date, job:jobs(job_number, title)')
      .eq('status', 'pending').lte('target_date', addDays(today, 14)).order('target_date')).data ?? [],
  })
  const compliance = useQuery({
    queryKey: ['compliance', monthFirst(today)],
    queryFn: async () => (await supabase.rpc('timesheet_compliance', { p_from: monthFirst(today), p_to: today })).data ?? [],
  })
  const teamClaims = (claims.data ?? []).filter((c) => c.staff?.approver_staff_id === profile?.staff_id).length
  return (
    <section>
      <Greeting><Link className="button-link" to="/timesheet">Log time</Link></Greeting>
      <div className="stats">
        <Tile to="/expenses" label="Expense claims to approve" value={teamClaims} tone={teamClaims ? 'warn' : undefined} />
        <Tile to="/jobs" label="Valuations to prepare" value="—" note="Phase B" />
      </div>
      <div className="detail-grid">
        <div className="panel">
          <h3>Milestones due in the next 14 days</h3>
          <TaskList items={(milestones.data ?? []).map((m) => ({ key: m.id, to: `/jobs/${m.job?.job_number}?tab=milestones`, text: `${m.job?.job_number} · ${m.name}`,
            due: m.target_date, tone: m.target_date && m.target_date < today ? 'bad' : undefined }))} empty="No milestones due." />
        </div>
        <div className="panel">
          <h3>Timesheet compliance this month <span className="muted small">working days logged on time</span></h3>
          <table className="compact"><tbody>{(compliance.data ?? []).map((c) => (
            <tr key={c.staff_id}><td>{c.full_name}</td><td className={`num ${Number(c.on_time_pct) < 80 ? 'warn-text' : ''}`}>{c.on_time_pct === null ? '—' : `${c.on_time_pct}%`}</td>
              <td className="small muted">{c.missing_days ? `${c.missing_days} missing` : ''}{c.late_days ? ` ${c.late_days} late` : ''}</td></tr>
          ))}</tbody></table>
        </div>
      </div>
      <DeliveryPanel teamOnly />
      <PipelinePanel />
    </section>
  )
}

function StaffHome() {
  const { profile } = useAuth()
  const today = todayAccra()
  const mon = mondayOf(today)
  const staffId = profile?.staff_id
  const me = useQuery({
    queryKey: ['me-staff', staffId],
    enabled: !!staffId,
    queryFn: async () => (await supabase.from('staff').select('monthly_billable_target').eq('id', staffId!).maybeSingle()).data,
  })
  const week = useQuery({
    queryKey: ['timesheet', 'home-week', staffId, mon],
    enabled: !!staffId,
    queryFn: async () => (await supabase.from('timesheet_entries').select('hours, billable, status').eq('staff_id', staffId!).gte('work_date', mon).lte('work_date', addDays(mon, 6))).data ?? [],
  })
  const balances = useQuery({
    queryKey: ['leave-balances', staffId],
    enabled: !!staffId,
    queryFn: async () => (await supabase.from('leave_balances').select('*').eq('staff_id', staffId!).eq('leave_type', 'Annual').order('leave_year', { ascending: false }).limit(1)).data ?? [],
  })
  const upcoming = useQuery({
    queryKey: ['leave-requests', 'home', staffId],
    enabled: !!staffId,
    queryFn: async () => (await supabase.from('leave_requests').select('id, start_date, end_date, status').eq('staff_id', staffId!)
      .in('status', ['requested', 'approved']).gte('end_date', today).order('start_date').limit(3)).data ?? [],
  })
  const payslip = useQuery({
    queryKey: ['my-latest-payslip', staffId],
    enabled: !!staffId,
    queryFn: async () => (await supabase.from('payslips').select('id, period_month, is_allowance_statement').eq('staff_id', staffId!).order('period_month', { ascending: false }).limit(1).maybeSingle()).data,
  })
  const claims = useQuery({
    queryKey: ['my-claims', staffId],
    enabled: !!staffId,
    queryFn: async () => (await supabase.from('expenses').select('id, expense_date, description, amount, reimbursement_status').eq('staff_id', staffId!)
      .eq('payment_source', 'staff_out_of_pocket').neq('reimbursement_status', 'reimbursed').order('expense_date', { ascending: false }).limit(5)).data ?? [],
  })
  const logged = (week.data ?? []).reduce((s, e) => s + Number(e.hours), 0)
  const billable = (week.data ?? []).filter((e) => e.billable).reduce((s, e) => s + Number(e.hours), 0)
  const weeklyTarget = me.data ? Math.round(Number(me.data.monthly_billable_target) / 4.33) : null
  const bal = balances.data?.[0]

  if (!staffId) return <section><Greeting /><p className="empty">Your log-in isn't linked to a staff record yet. Ask the Owner.</p></section>
  return (
    <section>
      <Greeting><Link className="button-link primary-link" to="/timesheet">Log time</Link></Greeting>
      <div className="stats">
        <Tile to="/timesheet" label="My hours this week" value={`${logged} h`} note={weeklyTarget ? `${billable} billable · target about ${weeklyTarget} billable a week` : undefined}
          tone={weeklyTarget && billable < weeklyTarget * 0.5 && new Date(`${today}T00:00:00Z`).getUTCDay() >= 4 ? 'warn' : undefined} />
        <Tile to="/me/leave" label="Annual leave left" value={bal ? `${Number(bal.available)} days` : '—'} note={bal ? `${bal.leave_year}` : 'not set up yet'} />
        <Tile to="/me/payslips" label="Latest payslip" value={payslip.data ? monthName(payslip.data.period_month) : '—'}
          note={payslip.data ? (payslip.data.is_allowance_statement ? 'allowance statement' : 'payslip') : 'none issued yet'} />
        <Tile to="/jobs" label="My tasks" value="—" note="Tasks arrive in Phase B; see my jobs" />
      </div>
      <div className="detail-grid">
        <div className="panel">
          <h3>My upcoming leave</h3>
          <TaskList items={(upcoming.data ?? []).map((l) => ({ key: l.id, to: '/me/leave', text: <>{formatDate(l.start_date)} to {formatDate(l.end_date)} <StatusBadge status={l.status} /></> }))} empty="No leave booked." />
        </div>
        <div className="panel">
          <h3>My expense claims</h3>
          <TaskList items={(claims.data ?? []).map((c) => ({ key: c.id, to: '/expenses', text: <>{c.description} · {formatMoney(c.amount)} <StatusBadge status={c.reimbursement_status} /></> }))} empty="No open claims." />
          <p className="muted small">Trips and cash advances arrive in Phase B.</p>
        </div>
      </div>
    </section>
  )
}
