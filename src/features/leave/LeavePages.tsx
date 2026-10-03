// Leave (brief §4 leave flow, §7.3; A-022, A-038):
//   /me/leave         my balance, my requests, request or cancel
//   /leave            requests and approvals (Owner; Project lead for the team; Directors, Accountant view)
//   /leave/calendar   who is away: names and dates only, never the type or reason
//   /leave/balances   entitlements and balances; the Owner sets up each leave year
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Attachment, openDocument } from '../../components/Attachment'
import { Dialog } from '../../components/Dialog'
import { PromptDialog, StatusBadge, Tabs, useAction } from '../../components/ui'
import { formatDate, todayAccra } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import * as R from '../../resources/definitions'
import { ResourceList } from '../../resources/ResourceList'
import { friendlyError } from '../../resources/useLookups'

type LeaveType = { id: string; name: string; is_paid: boolean; uses_annual_balance: boolean; requires_document: boolean; document_after_days: number | null
  entitlement_kind: string; event_entitled_days: number | null }
type Balance = { staff_id: string | null; full_name: string | null; leave_type_id: string | null; leave_type: string | null; leave_year: number | null
  entitled: number | null; carried_over: number | null; taken: number | null; booked: number | null; available: number | null
  entitlement_id: string | null; entitlement_kind: string | null }

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const days = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n)} day${Number(n) === 1 ? '' : 's'}`)
const dateRange = (a: string, b: string) => (a === b ? formatDate(a) : `${formatDate(a)} to ${formatDate(b)}`)

function useLeaveTypes() {
  return useQuery({
    queryKey: ['leave-types'],
    staleTime: 300_000,
    queryFn: async () => ((await supabase.from('leave_types').select('id, name, is_paid, uses_annual_balance, requires_document, document_after_days, entitlement_kind, event_entitled_days')
      .eq('is_active', true).order('sort_order')).data ?? []) as LeaveType[],
  })
}

function useBalances(staffId?: string | null) {
  return useQuery({
    queryKey: ['leave-balances', staffId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('leave_balances').select('*').order('full_name').order('leave_type')
      if (staffId) q = q.eq('staff_id', staffId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Balance[]
    },
  })
}

/** The leave year to show by default: the latest year with entitlements that has started. */
function defaultYear(rows: { leave_year: number | null }[]): number {
  const now = Number(todayAccra().slice(0, 4))
  const years = [...new Set(rows.map((r) => r.leave_year).filter((y): y is number => y !== null && y <= now))]
  return years.length ? Math.max(...years) : now
}

function refreshLeave(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all(['leave-requests', 'leave-balances', 'leave-calendar', 'timesheet'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
}

// ---------------------------------------------------------------------------
// Request form (own leave; the Owner may record leave for anyone)
// ---------------------------------------------------------------------------
function RequestForm({ staffId, staffOptions, onClose }: {
  staffId: string | null
  staffOptions?: { id: string; full_name: string }[]
  onClose: () => void
}) {
  const { role, profile } = useAuth()
  const qc = useQueryClient()
  const types = useLeaveTypes()
  const [person, setPerson] = useState(staffId ?? '')
  const [typeId, setTypeId] = useState('')
  const [start, setStart] = useState(todayAccra())
  const [end, setEnd] = useState(todayAccra())
  const [reason, setReason] = useState('')
  const action = useAction()
  const balances = useBalances(person || null)
  const type = types.data?.find((t) => t.id === typeId)
  useEffect(() => { if (!typeId && types.data?.length) setTypeId(types.data[0].id) }, [types.data, typeId])

  const preview = useQuery({
    queryKey: ['working-days', start, end],
    enabled: !!start && !!end && end >= start,
    queryFn: async () => (await supabase.rpc('working_days', { p_start: start, p_end: end })).data,
  })
  const workingDays = preview.data ?? null
  const bal = balances.data?.find((b) => b.leave_type_id === typeId && b.leave_year === Number(start.slice(0, 4)))
  const overBalance = (type?.entitlement_kind === 'annual' || type?.entitlement_kind === 'capped') && workingDays !== null && (bal?.available ?? 0) - workingDays < 0
  const ownerOwn = role === 'owner' && person === profile?.staff_id

  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await action.run(async () => {
      if (end < start) return 'The end date is before the start date.'
      const { error } = await supabase.from('leave_requests').insert({
        staff_id: person, leave_type_id: typeId, start_date: start, end_date: end, reason: reason.trim() || null,
      })
      if (error) return friendlyError(error)
      await refreshLeave(qc)
    })
    if (ok) onClose()
  }

  return (
    <Dialog title={ownerOwn ? 'Record my leave' : staffOptions ? 'Record leave' : 'Request leave'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {staffOptions && (
          <label>Person<select value={person} onChange={(e) => setPerson(e.target.value)} required>
            <option value="">Choose…</option>
            {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select></label>
        )}
        <label>Type of leave<select value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
          {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_paid ? '' : ' (unpaid)'}</option>)}
        </select></label>
        <div className="form-grid">
          <label>First day<input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }} required /></label>
          <label>Last day<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required /></label>
        </div>
        <p className="small">
          {workingDays === null ? <span className="muted">Choose the dates.</span>
            : workingDays === 0 ? <span className="form-error">These dates have no working days (weekends and public holidays don't count).</span>
            : <><strong>{days(workingDays)}</strong> of leave (weekends and public holidays don't count).</>}
          {type?.entitlement_kind === 'annual' && bal && <> Annual balance: {days(bal.available)} available.</>}
          {type?.entitlement_kind === 'capped' && bal && <> {type.name} this year: used {Number(bal.taken) + Number(bal.booked)} of {Number(bal.entitled)} days.</>}
        </p>
        {overBalance && (
          <p className="warn-text small">{type?.entitlement_kind === 'annual' ? 'This takes the annual balance below zero.' : `This goes over the yearly ${type?.name} leave limit.`} Only the Owner can approve it as {type?.name} leave; otherwise it's approved as Unpaid leave.</p>
        )}
        {type?.entitlement_kind === 'per_event' && (
          <p className={`small ${workingDays && type.event_entitled_days && workingDays > Number(type.event_entitled_days) ? 'form-error' : 'muted'}`}>
            {type.name} leave is up to {Number(type.event_entitled_days)} working days for each event{type.name === 'Maternity' ? ' (12 weeks)' : ''}.
            {type.requires_document && ' Attach the supporting document (e.g. a medical or birth certificate) to the request under My leave: it can only be approved once it\'s attached.'}</p>
        )}
        {type?.requires_document && type.entitlement_kind !== 'per_event' && (
          <p className="muted small">A supporting document is needed{type.document_after_days ? ` for more than ${type.document_after_days} days` : ''} (e.g. a medical certificate). Attach it to the request under My leave.</p>
        )}
        <label>Reason (optional)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          <span className="help">Only you, your approver, the Owner, the Directors and the Accountant see this. Never write medical details.</span></label>
        {ownerOwn && <p className="muted small">Your own leave is recorded without approval.</p>}
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions">
          <button className="primary" disabled={action.busy || !workingDays || !person}>{ownerOwn || staffOptions ? 'Save' : 'Send request'}</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  )
}

function BalanceTiles({ rows }: { rows: Balance[] }) {
  if (rows.length === 0) return <p className="empty">No leave entitlement set for this year yet. The Owner sets these up.</p>
  return (
    <div className="stats">
      {rows.map((b) => (
        <div key={`${b.leave_type_id}-${b.leave_year}`} className="stat">
          <span className="label">{b.leave_type} {b.leave_year}</span>
          {b.entitlement_kind === 'capped' ? <>
            <strong className={Number(b.available) < 0 ? 'bad' : undefined}>used {Number(b.taken) + Number(b.booked)} of {Number(b.entitled)}</strong>
            <span className="muted small">days this year{Number(b.booked) ? ` (${Number(b.booked)} booked ahead)` : ''}</span>
          </> : <>
            <strong className={Number(b.available) < 0 ? 'bad' : undefined}>{days(b.available)}</strong>
            <span className="muted small">available of {Number(b.entitled) + Number(b.carried_over)} ({Number(b.carried_over)} carried over) · {Number(b.taken)} taken · {Number(b.booked)} booked</span>
          </>}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// /me/leave
// ---------------------------------------------------------------------------
export function MyLeavePage() {
  const { profile, role } = useAuth()
  const qc = useQueryClient()
  const staffId = profile?.staff_id ?? null
  const balances = useBalances(staffId)
  const [asking, setAsking] = useState(false)
  const action = useAction()
  const today = todayAccra()
  const requests = useQuery({
    queryKey: ['leave-requests', 'mine', staffId],
    enabled: !!staffId,
    queryFn: async () => (await supabase.from('leave_requests').select('*, type:leave_types(name, requires_document)')
      .eq('staff_id', staffId!).order('start_date', { ascending: false })).data ?? [],
  })
  const year = defaultYear(balances.data ?? [])
  const current = (balances.data ?? []).filter((b) => b.leave_year === year)

  if (!staffId) {
    return <section><h1>My leave</h1><p className="empty">Your log-in isn't linked to a staff record, so there's no leave to show.</p></section>
  }
  const cancel = (id: string) => action.run(async () => {
    const { error } = await supabase.from('leave_requests').update({ status: 'cancelled' }).eq('id', id)
    if (error) return friendlyError(error)
    await refreshLeave(qc)
  })

  return (
    <section>
      <header className="page-header">
        <div><h1>My leave</h1><p className="muted">Approved leave fills your timesheet automatically and stops reminders for those days.</p></div>
        {canWrite(role) && <div className="actions"><button className="primary" onClick={() => setAsking(true)}>{role === 'owner' ? 'Record my leave' : 'Request leave'}</button></div>}
      </header>
      <BalanceTiles rows={current} />
      <h2>My requests</h2>
      {action.error && <p className="form-error">{action.error}</p>}
      {(requests.data ?? []).length === 0 ? <p className="empty">No leave requests yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Dates</th><th>Type</th><th className="num">Days</th><th>Status</th><th /></tr></thead>
          <tbody>{(requests.data ?? []).map((r) => (
            <tr key={r.id}>
              <td>{dateRange(r.start_date, r.end_date)}{r.reason && <div className="muted small">{r.reason}</div>}
                {(r.type?.requires_document || r.document_path) && <Attachment table="leave_requests" column="document_path" recordId={r.id} path={r.document_path}
                  label="Supporting document" editable={canWrite(role) && ['requested', 'approved'].includes(r.status)} />}</td>
              <td>{r.type?.name}</td>
              <td className="num">{r.working_days}</td>
              <td><StatusBadge status={r.status === 'approved' && r.end_date < today ? 'taken' : r.status} />
                {r.decision_note && <div className="muted small">{r.decision_note}</div>}</td>
              <td>{(r.status === 'requested' || (r.status === 'approved' && r.start_date > today)) && canWrite(role) && (
                <button className="link" disabled={action.busy} onClick={() => cancel(r.id)}>Cancel</button>)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {asking && <RequestForm staffId={staffId} onClose={() => setAsking(false)} />}
    </section>
  )
}

// ---------------------------------------------------------------------------
// /leave: requests and approvals
// ---------------------------------------------------------------------------
type Req = {
  id: string; staff_id: string; leave_type_id: string; start_date: string; end_date: string; working_days: number
  reason: string | null; status: string; decision_note: string | null; decided_at: string | null; document_path: string | null
  staff: { full_name: string; approver_staff_id: string | null } | null
  type: { name: string; uses_annual_balance: boolean; requires_document: boolean; document_after_days: number | null; entitlement_kind: string } | null
}
type ReqTab = 'requested' | 'upcoming' | 'past' | 'closed'

export function LeaveRequestsPage() {
  const { profile, role } = useAuth()
  const qc = useQueryClient()
  const today = todayAccra()
  const [tab, setTab] = useState<ReqTab>('requested')
  const [recording, setRecording] = useState(false)
  const [declining, setDeclining] = useState<Req | null>(null)
  const action = useAction()
  const requests = useQuery({
    queryKey: ['leave-requests', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('leave_requests')
        .select('id, staff_id, leave_type_id, start_date, end_date, working_days, reason, status, decision_note, decided_at, document_path, staff:staff(full_name, approver_staff_id), type:leave_types(name, uses_annual_balance, requires_document, document_after_days, entitlement_kind)')
        .order('start_date', { ascending: false }).limit(2000)
      if (error) throw error
      return (data ?? []) as unknown as Req[]
    },
  })
  const balances = useBalances()
  const types = useLeaveTypes()
  const people = useQuery({
    queryKey: ['leave-people'],
    enabled: role === 'owner',
    queryFn: async () => (await supabase.from('staff').select('id, full_name').eq('is_active', true).order('full_name')).data ?? [],
  })
  const unpaid = types.data?.find((t) => t.name === 'Unpaid')

  const mayDecide = (r: Req) => canWrite(role) && r.staff_id !== profile?.staff_id &&
    (role === 'owner' || (role === 'project_lead' && r.staff?.approver_staff_id === profile?.staff_id))
  const balanceFor = (r: Req) => balances.data?.find((b) => b.staff_id === r.staff_id && b.leave_type_id === r.leave_type_id
    && b.leave_year === Number(r.start_date.slice(0, 4)))

  const all = requests.data ?? []
  const groups: Record<ReqTab, Req[]> = {
    requested: all.filter((r) => r.status === 'requested').sort((a, b) => a.start_date.localeCompare(b.start_date)),
    upcoming: all.filter((r) => r.status === 'approved' && r.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    past: all.filter((r) => (r.status === 'approved' || r.status === 'taken') && r.end_date < today),
    closed: all.filter((r) => r.status === 'declined' || r.status === 'cancelled'),
  }
  const rows = groups[tab]

  const update = (id: string, patch: { status: string; leave_type_id?: string; decision_note?: string }) => action.run(async () => {
    const { error } = await supabase.from('leave_requests').update(patch).eq('id', id)
    if (error) return friendlyError(error)
    await refreshLeave(qc)
  })

  return (
    <section>
      <header className="page-header">
        <div><h1>Leave requests</h1>
          <p className="muted">Francis approves his team's leave; the Owner approves Francis's and Admin's, and can approve anyone's. Approving fills the timesheet with Leave days.</p></div>
        {role === 'owner' && <div className="actions"><button onClick={() => setRecording(true)}>Record leave for someone</button></div>}
      </header>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'requested', label: 'Awaiting decision', count: groups.requested.length },
        { key: 'upcoming', label: 'Approved, upcoming' }, { key: 'past', label: 'Taken' }, { key: 'closed', label: 'Declined or cancelled' }]} />
      {action.error && <p className="form-error">{action.error}</p>}
      {requests.isLoading ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="empty">Nothing here.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Person</th><th>Type</th><th>Dates</th><th className="num">Days</th><th>Balance</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((r) => {
            const bal = balanceFor(r)
            const after = bal && (r.type?.entitlement_kind === 'annual' || r.type?.entitlement_kind === 'capped') ? Number(bal.available) - (r.status === 'requested' ? r.working_days : 0) : null
            const below = after !== null && after < 0
            return (
              <tr key={r.id} className={below && r.status === 'requested' ? 'row-bad' : undefined}>
                <td>{r.staff?.full_name}</td>
                <td>{r.type?.name}{r.reason && <div className="muted small">{r.reason}</div>}
                  {r.type?.requires_document && (!r.type.document_after_days || r.working_days > r.type.document_after_days) &&
                    (r.document_path ? <button className="link small" onClick={() => action.run(() => openDocument(r.document_path!))}>Supporting document</button>
                      : <div className="warn-text small">Supporting document needed</div>)}</td>
                <td>{dateRange(r.start_date, r.end_date)}</td>
                <td className="num">{r.working_days}</td>
                <td>{after === null ? <span className="muted">—</span>
                  : <span className={below ? 'warn-text' : undefined}>{r.status === 'requested' ? `${days(after)} after` : `${days(bal!.available)} left`}</span>}</td>
                <td><StatusBadge status={r.status} />{r.decision_note && <div className="muted small">{r.decision_note}</div>}</td>
                <td>{mayDecide(r) && (
                  <div className="row-actions">
                    {r.status === 'requested' && (!below || role === 'owner') && (
                      <button className="primary" disabled={action.busy} onClick={() => update(r.id, { status: 'approved' })}>Approve</button>)}
                    {r.status === 'requested' && below && unpaid && r.leave_type_id !== unpaid.id && (
                      <button disabled={action.busy} onClick={() => update(r.id, {
                        status: 'approved', leave_type_id: unpaid.id,
                        decision_note: `Approved as Unpaid: not enough ${r.type?.name ?? ''} leave left`,
                      })}>Approve as Unpaid</button>)}
                    {r.status === 'requested' && <button disabled={action.busy} onClick={() => setDeclining(r)}>Decline</button>}
                    {r.status === 'approved' && r.start_date > today && (
                      <button className="link" disabled={action.busy} onClick={() => update(r.id, { status: 'cancelled' })}>Cancel</button>)}
                  </div>
                )}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}
      {recording && <RequestForm staffId={null} staffOptions={people.data ?? []} onClose={() => setRecording(false)} />}
      {declining && (
        <PromptDialog title={`Decline ${declining.staff?.full_name}'s leave`} label="Reason, for the requester" confirmLabel="Decline"
          onClose={() => setDeclining(null)}
          onSubmit={async (note) => {
            const { error } = await supabase.from('leave_requests').update({ status: 'declined', decision_note: note }).eq('id', declining.id)
            if (error) return friendlyError(error)
            await refreshLeave(qc); return null
          }} />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// /leave/calendar: names and dates only (brief §7.3)
// ---------------------------------------------------------------------------
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`
const shiftMonth = (first: string, n: number) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }

export function LeaveCalendarPage() {
  const today = todayAccra()
  const [month, setMonth] = useState(monthStart(today))
  const monthEnd = addDays(shiftMonth(month, 1), -1)
  const away = useQuery({
    queryKey: ['leave-calendar'],
    queryFn: async () => (await supabase.from('leave_calendar').select('*').gte('end_date', addDays(today, -400)).order('start_date')).data ?? [],
  })
  const holidays = useQuery({
    queryKey: ['holidays-map'],
    queryFn: async () => new Map(((await supabase.from('public_holidays').select('holiday_date, name')).data ?? []).map((h) => [h.holiday_date, h.name])),
  })
  const rows = (away.data ?? []).filter((r) => r.start_date! <= monthEnd && r.end_date! >= month)

  // Monday-first weeks covering the month.
  const weeks = useMemo(() => {
    const first = new Date(`${month}T00:00:00Z`)
    let d = addDays(month, -((first.getUTCDay() + 6) % 7))
    const out: string[][] = []
    while (d <= monthEnd) { out.push([...Array(7)].map((_, i) => addDays(d, i))); d = addDays(d, 7) }
    return out
  }, [month, monthEnd])
  const who = (d: string) => rows.filter((r) => r.start_date! <= d && r.end_date! >= d).map((r) => r.full_name!.split(' ')[0])

  const thisMon = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
  const inRange = (a: string, b: string) => (away.data ?? []).filter((r) => r.start_date! <= b && r.end_date! >= a)

  return (
    <section>
      <header className="page-header"><div><h1>Leave calendar</h1><p className="muted">Who is away. Names and dates only.</p></div></header>
      <div className="stats">
        {([['This week', thisMon, addDays(thisMon, 6)], ['Next week', addDays(thisMon, 7), addDays(thisMon, 13)]] as const).map(([label, a, b]) => (
          <div className="stat" key={label}><span className="label">Away {label.toLowerCase()}</span>
            {inRange(a, b).length === 0 ? <span className="muted">Nobody</span>
              : inRange(a, b).map((r) => <span key={r.id} className="small"><strong>{r.full_name}</strong> {dateRange(r.start_date!, r.end_date!)}</span>)}
          </div>
        ))}
      </div>
      <div className="month-nav">
        <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
        <h2>{new Date(`${month}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
        <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
        {month !== monthStart(today) && <button className="link" onClick={() => setMonth(monthStart(today))}>Today</button>}
      </div>
      <div className="table-wrap"><table className="calendar">
        <thead><tr>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <th key={d}>{d}</th>)}</tr></thead>
        <tbody>{weeks.map((w) => (
          <tr key={w[0]}>{w.map((d) => {
            const holiday = holidays.data?.get(d)
            const names = who(d)
            const weekend = new Date(`${d}T00:00:00Z`).getUTCDay() % 6 === 0
            return (
              <td key={d} className={[d.slice(0, 7) !== month.slice(0, 7) && 'outside', weekend && 'weekend', d === today && 'today'].filter(Boolean).join(' ')}>
                <span className="day-num">{Number(d.slice(8))}</span>
                {holiday && <span className="holiday">{holiday}</span>}
                {!weekend && !holiday && names.map((n, i) => <span key={i} className="away">{n}</span>)}
              </td>
            )
          })}</tr>
        ))}</tbody>
      </table></div>
      <h2>Away in this month</h2>
      {rows.length === 0 ? <p className="empty">Nobody is on leave this month.</p> : (
        <ul className="plain">{rows.map((r) => <li key={r.id}><strong>{r.full_name}</strong> {dateRange(r.start_date!, r.end_date!)}</li>)}</ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// /leave/balances
// ---------------------------------------------------------------------------
export function LeaveBalancesPage() {
  const { role } = useAuth()
  const qc = useQueryClient()
  const balances = useBalances()
  const years = [...new Set((balances.data ?? []).map((b) => b.leave_year).filter((y): y is number => y !== null))].sort((a, b) => b - a)
  const [year, setYear] = useState<number | null>(null)
  const shown = year ?? defaultYear(balances.data ?? [])
  const [tab, setTab] = useState<'balances' | 'entitlements'>('balances')
  const [setupYear, setSetupYear] = useState(String(Number(todayAccra().slice(0, 4)) + (Number(todayAccra().slice(5, 7)) >= 11 ? 1 : 0)))
  const action = useAction()
  const [done, setDone] = useState<string | null>(null)
  const [nothing, setNothing] = useState<{ text: string; link?: string; linkText?: string } | null>(null)
  const [deleting, setDeleting] = useState<Balance | null>(null)
  const rows = (balances.data ?? []).filter((b) => b.leave_year === shown)

  /** "0 created": say why (D-048). */
  async function whyNothing(y: number): Promise<null> {
    const { data: types } = await supabase.from('leave_types').select('name, entitlement_kind, default_entitled_days').eq('is_active', true)
    const usable = (types ?? []).filter((t) => (t.entitlement_kind === 'annual' || t.entitlement_kind === 'capped') && t.default_entitled_days !== null)
    if (!usable.length) {
      setNothing({ text: 'No leave types have default days set (Annual, Sick, Compassionate and Study/exam need them).',
        link: '/settings?tab=data', linkText: 'Go to Settings › Reference data › Leave types' })
      return null
    }
    const yStart = `${y}-01-01`, yEnd = `${y}-12-31`
    const { data: staff } = await supabase.from('staff').select('id, start_date, end_date').eq('is_active', true)
    const employed = (staff ?? []).filter((s) => s.start_date <= yEnd && (!s.end_date || s.end_date >= yStart))
    if (!employed.length) { setNothing({ text: `No active staff are employed in ${y}.`, link: '/team/staff', linkText: 'Check the staff start and end dates' }); return null }
    setNothing({ text: `Everyone employed in ${y} already has entitlements for ${usable.map((t) => t.name).join(', ')}. Change individual figures on the Entitlements tab; a new joiner gets theirs when you run this again.` })
    return null
  }

  return (
    <section>
      <header className="page-header">
        <div><h1>Leave balances</h1><p className="muted">Entitled + carried over − taken − booked = available.</p></div>
      </header>
      {role === 'owner' && (
        <div className="panel narrow" style={{ marginBottom: '1rem' }}>
          <h3>Set up a leave year</h3>
          <p className="small muted">Gives everyone each leave type's default days (Settings › Reference data › Leave types). Annual leave is pro-rated for anyone
            joining or leaving during the year, and unused annual leave carries over up to the Settings limit. Sick, Compassionate and Study/exam get their full
            yearly cap. Maternity and Paternity have no yearly balance: each request grants the set days for that event. Existing entitlements are left as they
            are; change individual figures (e.g. national service postings) on the Entitlements tab.</p>
          <form className="row-actions" onSubmit={(e) => {
            e.preventDefault(); setDone(null); setNothing(null)
            action.run(async () => {
              const { data, error } = await supabase.rpc('set_up_leave_year', { p_year: Number(setupYear) })
              if (error) return friendlyError(error)
              setDone(data ? `${data} entitlement${data === 1 ? '' : 's'} created for ${setupYear}.` : null)
              if (!data) return await whyNothing(Number(setupYear))
              setYear(Number(setupYear))
              await qc.invalidateQueries({ queryKey: ['leave-balances'] })
              await qc.invalidateQueries({ queryKey: ['resource', 'leave_entitlements'] })
            })
          }}>
            <input type="number" value={setupYear} onChange={(e) => setSetupYear(e.target.value)} min={2026} max={2100} style={{ width: '7rem' }} aria-label="Leave year" />
            <button className="primary" disabled={action.busy}>Set up</button>
          </form>
          {action.error && <p className="form-error">{action.error}</p>}
          {done && <p className="form-ok">{done}</p>}
          {nothing && <p className="warn-text small">Nothing was created for {setupYear}. {nothing.text}{nothing.link && <> <Link to={nothing.link}>{nothing.linkText}</Link>.</>}</p>}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'balances', label: 'Balances' }, { key: 'entitlements', label: 'Entitlements' }]} />
      {tab === 'entitlements' ? <ResourceList resource={R.leaveEntitlements} /> : <>
        {years.length > 1 && (
          <label className="inline">Leave year <select value={shown} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 'auto' }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        )}
        {rows.length === 0 ? <p className="empty">No entitlements for {shown} yet.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Person</th><th>Type</th><th className="num">Entitled</th><th className="num">Carried over</th><th className="num">Taken</th><th className="num">Booked</th><th className="num">Available</th>{role === 'owner' && <th />}</tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={`${b.staff_id}-${b.leave_type_id}`} className={Number(b.available) < 0 ? 'row-bad' : undefined}>
                <td>{b.full_name}</td><td>{b.leave_type}</td>
                <td className="num">{Number(b.entitled)}</td><td className="num">{Number(b.carried_over)}</td>
                <td className="num">{Number(b.taken)}</td><td className="num">{Number(b.booked)}</td>
                <td className="num"><strong>{b.entitlement_kind === 'capped' ? `used ${Number(b.taken) + Number(b.booked)} of ${Number(b.entitled)}` : Number(b.available)}</strong></td>
                {role === 'owner' && <td>{Number(b.taken) + Number(b.booked) === 0 && canWrite(role) &&
                  <button className="link" onClick={() => setDeleting(b)}>Delete</button>}</td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {role === 'owner' && <p className="muted small">An entitlement can be deleted only while no leave is taken or booked against it; the deletion is logged.</p>}
      </>}
      {deleting && (
        <Dialog title="Delete this entitlement?" onClose={() => setDeleting(null)}>
          <p>{deleting.full_name}: {deleting.leave_type} {deleting.leave_year}, {Number(deleting.entitled)} days{Number(deleting.carried_over) ? ` + ${Number(deleting.carried_over)} carried over` : ''}.</p>
          <p className="muted small">Nothing is taken or booked against it. The deletion is recorded in the audit log.</p>
          {action.error && <p className="form-error">{action.error}</p>}
          <div className="form-actions">
            <button className="primary" disabled={action.busy} onClick={() => action.run(async () => {
              const { data, error } = await supabase.from('leave_entitlements').delete().eq('id', deleting.entitlement_id!).select('id')
              if (error) return friendlyError(error)
              if (!data?.length) return 'Nothing was deleted: only the Owner can delete entitlements.'
              setDeleting(null)
              await qc.invalidateQueries({ queryKey: ['leave-balances'] })
              await qc.invalidateQueries({ queryKey: ['resource', 'leave_entitlements'] })
            })}>Delete</button>
            <button onClick={() => setDeleting(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
