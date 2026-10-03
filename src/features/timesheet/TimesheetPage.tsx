import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { PromptDialog, StatusBadge, useAction, uuid } from '../../components/ui'
import { formatDate, formatHours, todayAccra } from '../../lib/format'
import { db, supabase } from '../../lib/supabase'
import { friendlyError } from '../../resources/useLookups'
import { isNetworkError, selfEntryDeadline, TimesheetQueue, type EntryPayload, type SendResult } from './queue'

const CATEGORIES = [
  ['job', 'Job'], ['internal', 'Internal / admin'], ['business_development', 'Business development'], ['goodwill', 'Goodwill / mentor'],
] as const
const PRESETS = [1, 2, 4, 6, 8]

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })

async function sendEntry(p: EntryPayload): Promise<SendResult> {
  try {
    const { error } = await db.from('timesheet_entries').upsert(p, { onConflict: 'client_ref', ignoreDuplicates: true })
    if (!error) return { ok: true }
    if (isNetworkError(error)) return { ok: false, network: true }
    // The database's checks run before it notices a duplicate, so a retry of an
    // entry that was saved (reply lost) can be refused later, e.g. once the
    // window has closed. If it's already there, the save did happen.
    const { data: existing } = await supabase.from('timesheet_entries').select('id').eq('client_ref', p.client_ref).maybeSingle()
    if (existing) return { ok: true }
    return { ok: false, network: false, message: friendlyError(error) }
  } catch (e) {
    return { ok: false, network: true, ...{ message: (e as Error).message } } as SendResult
  }
}

export function TimesheetPage() {
  const { profile, role } = useAuth()
  const qc = useQueryClient()
  const queue = useMemo(() => new TimesheetQueue(window.localStorage, `melins.timesheet.queue.${profile?.user_id}`), [profile?.user_id])
  const [queued, setQueued] = useState(() => queue.list())
  const [online, setOnline] = useState(navigator.onLine)
  const [params] = useSearchParams()
  // Reminders link to /timesheet?date=YYYY-MM-DD (the missing day).
  const [date, setDate] = useState(() => {
    const d = params.get('date')
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayAccra() ? d : todayAccra()
  })
  // /team links here with &staff= to enter a missing day on someone's behalf.
  const [forStaff, setForStaff] = useState(() => ((role === 'owner' || role === 'project_lead') && params.get('staff')) || profile?.staff_id || '')
  const onBehalf = forStaff !== profile?.staff_id

  const flush = useCallback(async () => {
    const res = await queue.flush(sendEntry)
    setQueued(queue.list())
    setOnline(!res.offline)
    if (res.sent) await qc.invalidateQueries({ queryKey: ['timesheet'] })
  }, [queue, qc])

  // Retry when the connection returns, when the app comes back to the foreground, and every 30 seconds.
  useEffect(() => {
    flush()
    const on = () => { setOnline(true); flush() }
    const off = () => setOnline(false)
    const vis = () => document.visibilityState === 'visible' && flush()
    window.addEventListener('online', on); window.addEventListener('offline', off)
    document.addEventListener('visibilitychange', vis)
    const t = window.setInterval(() => queue.list().some((q) => q.state === 'pending') && flush(), 30_000)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); document.removeEventListener('visibilitychange', vis); clearInterval(t) }
  }, [flush, queue])

  const weekStart = useMemo(() => { const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; return addDays(date, -dow) }, [date])
  const week = [...Array(7)].map((_, i) => addDays(weekStart, i))

  const people = useQuery({
    queryKey: ['timesheet-people'],
    enabled: role === 'owner' || role === 'project_lead',
    queryFn: async () => (await supabase.from('staff').select('id, full_name, approver_staff_id').eq('is_active', true).order('full_name')).data ?? [],
  })
  const canEnterFor = (people.data ?? []).filter((s) => s.id === profile?.staff_id || role === 'owner' || s.approver_staff_id === profile?.staff_id)

  const entries = useQuery({
    queryKey: ['timesheet', forStaff, weekStart],
    enabled: !!forStaff,
    queryFn: async () => (await supabase.from('timesheet_entries').select('*, job:jobs(job_number, title), activity:timesheet_activities(group_name, name)')
      .eq('staff_id', forStaff).gte('work_date', weekStart).lte('work_date', addDays(weekStart, 6)).order('created_at')).data ?? [],
  })
  const holidays = useQuery({ queryKey: ['holidays'], queryFn: async () => new Set(((await supabase.from('public_holidays').select('holiday_date')).data ?? []).map((h) => h.holiday_date)) })

  const target = (people.data ?? []).find((s) => s.id === forStaff)
  const dayEntries = (entries.data ?? []).filter((e) => e.work_date === date)
  const dayQueued = queued.filter((q) => q.payload.work_date === date && q.payload.staff_id === forStaff)
  const hoursOn = (d: string) => (entries.data ?? []).filter((e) => e.work_date === d).reduce((s, e) => s + Number(e.hours), 0)
    + queued.filter((q) => q.payload.work_date === d && q.payload.staff_id === forStaff).reduce((s, q) => s + q.payload.hours, 0)
  const deadline = holidays.data ? selfEntryDeadline(date, holidays.data) : null
  const today = todayAccra()
  const windowClosed = !onBehalf && role !== 'owner' && deadline !== null && today > deadline
  // D-043: entering for someone is only "late" (and needs a reason) once their own window has closed.
  const lateOnBehalf = onBehalf && deadline !== null && today > deadline
  const todayLogged = hoursOn(today)

  if (!profile?.staff_id) return <section className="notice"><h1>Timesheet</h1><p>Your log-in isn't linked to a staff record, so you don't log time.</p></section>

  return (
    <section className="timesheet">
      <header className="page-header">
        <div><h1>Timesheet</h1>
          <p className="today-logged">Today: <strong>{formatHours(todayLogged)}</strong> logged{onBehalf && target ? ` for ${target.full_name}` : ''}</p>
          {!online && <p className="warn-text">Offline: entries are saved on this phone and sent when you're back online.</p>}</div>
        {(role === 'owner' || role === 'project_lead') && canEnterFor.length > 1 && (
          <label className="inline">Logging for
            <select value={forStaff} onChange={(e) => setForStaff(e.target.value)}>
              {canEnterFor.map((s) => <option key={s.id} value={s.id}>{s.id === profile.staff_id ? 'Me' : s.full_name}</option>)}
            </select>
          </label>
        )}
      </header>

      <nav className="week-strip" aria-label="Choose a day">
        <button className="icon" aria-label="Previous week" onClick={() => setDate(addDays(date, -7))}>‹</button>
        {week.map((d) => (
          <button key={d} className={`day${d === date ? ' active' : ''}${d > today ? ' future' : ''}`} disabled={d > today} onClick={() => setDate(d)}>
            <span>{weekday(d)}</span><strong>{Number(d.slice(8))}</strong><small>{hoursOn(d) ? `${hoursOn(d)}h` : '·'}</small>
          </button>
        ))}
        <button className="icon" aria-label="Next week" disabled={addDays(weekStart, 7) > today} onClick={() => setDate(addDays(date, 7) > today ? today : addDays(date, 7))}>›</button>
      </nav>

      <p className="muted small">
        {formatDate(date)}
        {deadline && !onBehalf && role !== 'owner' && (windowClosed
          ? <span className="warn-text">: the window for this day has closed. Ask your Project lead (up to 10 working days) or the Owner to enter it, with a reason.</span>
          : `: you can log or change this day until the end of ${formatDate(deadline)}.`)}
        {onBehalf && (lateOnBehalf
          ? <span className="warn-text">: {target?.full_name ?? 'their'}'s own window for this day has closed, so this is a late entry and needs a reason.</span>
          : `: recorded as entered by you on behalf of ${target?.full_name ?? 'them'}. Inside their window, so not late and no reason needed.`)}
      </p>

      {!windowClosed && (
        <EntryForm date={date} staffId={forStaff} lateOnBehalf={lateOnBehalf} role={role}
          onQueued={async (payload, label) => { queue.add(payload, label); setQueued(queue.list()); await flush() }} />
      )}

      <h2>{onBehalf ? 'Their' : 'Your'} time on {formatDate(date)}: {hoursOn(date)} h</h2>
      <ul className="entry-list">
        {dayQueued.map((q) => (
          <li key={q.payload.client_ref} className={q.state === 'rejected' ? 'rejected' : 'pending'}>
            <div><strong>{formatHours(q.payload.hours)}</strong> {q.label}{q.payload.description && <div className="muted small">{q.payload.description}</div>}</div>
            {q.state === 'pending'
              ? <span className="badge badge-warn">{online ? 'saving…' : 'waiting for signal'}</span>
              : <div><p className="form-error small">Not saved: {q.error}</p>
                  <button className="link" onClick={() => { queue.retry(q.payload.client_ref); setQueued(queue.list()); flush() }}>Try again</button>{' '}
                  <button className="link" onClick={() => { queue.remove(q.payload.client_ref); setQueued(queue.list()) }}>Discard</button></div>}
          </li>
        ))}
        {dayEntries.map((e) => <SavedEntry key={e.id} entry={e} me={profile.user_id} staffProfile={onBehalf ? null : profile.user_id}
          onChanged={() => qc.invalidateQueries({ queryKey: ['timesheet'] })} />)}
        {dayQueued.length === 0 && dayEntries.length === 0 && <li className="muted">Nothing logged.</li>}
      </ul>
    </section>
  )
}

const CUSTOM = '__custom__'

function EntryForm({ date, staffId, lateOnBehalf, role, onQueued }: {
  date: string; staffId: string; lateOnBehalf: boolean; role: string | null
  onQueued: (p: EntryPayload, label: string) => Promise<void>
}) {
  const [category, setCategory] = useState<EntryPayload['category']>('job')
  const [jobId, setJobId] = useState(() => localStorage.getItem('melins.timesheet.lastJob') ?? '')
  const [hours, setHours] = useState(1)
  const [activity, setActivity] = useState('')
  const [custom, setCustom] = useState('')
  const [description, setDescription] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const jobs = useQuery({
    queryKey: ['timesheet-jobs', role],
    queryFn: async () => role === 'staff'
      ? ((await supabase.from('my_jobs').select('id, job_number, title').order('job_number', { ascending: false })).data ?? [])
      : ((await supabase.from('jobs').select('id, job_number, title').not('delivery_status', 'eq', 'closed').order('job_number', { ascending: false })).data ?? []),
  })
  const activities = useQuery({
    queryKey: ['timesheet-activities'],
    staleTime: 300_000,
    queryFn: async () => (await supabase.from('timesheet_activities').select('id, group_name, name, sort_order').eq('is_active', true).order('sort_order')).data ?? [],
  })
  // D-042 item 9: the person's last three jobs as one-tap buttons.
  const recent = useQuery({
    queryKey: ['timesheet-recent-jobs', staffId],
    enabled: !!staffId,
    queryFn: async () => {
      const rows = (await supabase.from('timesheet_entries').select('job_id, work_date, created_at, job:jobs(job_number, title)')
        .eq('staff_id', staffId).eq('category', 'job').order('work_date', { ascending: false }).order('created_at', { ascending: false }).limit(60)).data ?? []
      const seen = new Set<string>()
      return rows.filter((r) => r.job_id && !seen.has(r.job_id) && seen.add(r.job_id)).slice(0, 3)
    },
  })
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string }[]>()
    for (const a of activities.data ?? []) m.set(a.group_name, [...(m.get(a.group_name) ?? []), { id: a.id, name: a.name }])
    return [...m.entries()]
  }, [activities.data])
  const step = (d: number) => setHours((h) => Math.min(16, Math.max(0.25, Math.round((h + d) * 4) / 4)))
  const descLength = description.trim().length

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (category === 'job' && !jobId) { setError('Choose the job'); return }
    if (!activity) { setError('Choose the activity'); return }
    if (activity === CUSTOM && !custom.trim()) { setError('Type the activity'); return }
    if (descLength < 10) { setError('Say what you did, in at least 10 characters'); return }
    if (lateOnBehalf && !reason.trim()) { setError('Give the reason for entering it late'); return }
    const job = jobs.data?.find((j) => j.id === jobId)
    if (category === 'job') localStorage.setItem('melins.timesheet.lastJob', jobId)
    await onQueued({
      client_ref: uuid(), staff_id: staffId, work_date: date, category, job_id: category === 'job' ? jobId : null,
      hours, description: description.trim(), late_reason: lateOnBehalf ? reason.trim() : null,
      activity_id: activity === CUSTOM ? null : activity, activity_custom: activity === CUSTOM ? custom.trim() : null,
    }, category === 'job' ? `${job?.job_number ?? ''} ${job?.title ?? ''}` : CATEGORIES.find(([k]) => k === category)![1])
    setDescription('')
  }

  return (
    <form className="panel entry-form" onSubmit={submit} id="timesheet-entry" noValidate>
      <div className="chip-row" role="radiogroup" aria-label="What was it?">
        {CATEGORIES.map(([k, l]) => (
          <button type="button" key={k} role="radio" aria-checked={category === k} className={`chip${category === k ? ' on' : ''}`} onClick={() => setCategory(k)}>{l}</button>
        ))}
      </div>
      {category === 'job' && <>
        {(recent.data ?? []).length > 0 && (
          <div className="chip-row" aria-label="Recent jobs">
            {(recent.data ?? []).map((r) => (
              <button type="button" key={r.job_id!} className={`chip${jobId === r.job_id ? ' on' : ''}`} onClick={() => setJobId(r.job_id!)}
                title={r.job?.title}>{r.job?.job_number} {r.job?.title && r.job.title.length > 18 ? `${r.job.title.slice(0, 18)}…` : r.job?.title}</button>
            ))}
          </div>
        )}
        <label>Job
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Choose…</option>
            {(jobs.data ?? []).map((j) => <option key={j.id!} value={j.id!}>{j.job_number} {j.title}</option>)}
          </select>
        </label>
      </>}
      <label>Activity
        <select value={activity} onChange={(e) => setActivity(e.target.value)} required>
          <option value="">Choose…</option>
          {groups.map(([g, items]) => (
            <optgroup key={g} label={g}>{items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
          ))}
          <optgroup label="Other"><option value={CUSTOM}>Custom (type your own)</option></optgroup>
        </select>
      </label>
      {activity === CUSTOM && <label>Your activity<input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={60} required autoFocus /></label>}
      <div className="hours">
        <button type="button" className="big" onClick={() => step(-0.25)} aria-label="15 minutes less">−</button>
        <output aria-live="polite"><strong>{formatHours(hours)}</strong></output>
        <button type="button" className="big" onClick={() => step(0.25)} aria-label="15 minutes more">+</button>
      </div>
      <div className="chip-row">{PRESETS.map((p) => <button type="button" key={p} className={`chip${hours === p ? ' on' : ''}`} onClick={() => setHours(p)}>{p} h</button>)}</div>
      <label>What you did<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} required minLength={10}
        placeholder="e.g. Checked slab reinforcement on grid C" />
        <span className={`help${descLength > 0 && descLength < 10 ? ' warn-text' : ''}`}>{descLength < 10 ? `At least 10 characters (${descLength}/10)` : ' '}</span></label>
      {lateOnBehalf && <label>Reason for the late entry<input value={reason} onChange={(e) => setReason(e.target.value)} required /></label>}
      {error && <p className="form-error">{error}</p>}
      <div className="save-bar"><button className="primary wide">Save {formatHours(hours)}</button></div>
    </form>
  )
}

type Entry = {
  id: string; hours: number; category: string; description: string | null; status: string; return_note: string | null
  is_late_entry: boolean; late_reason: string | null; job: { job_number: string | null; title: string } | null
  entered_by: string | null; activity_custom: string | null; activity: { group_name: string; name: string } | null
}

function SavedEntry({ entry, me, staffProfile, onChanged }: { entry: Entry; me: string; staffProfile: string | null; onChanged: () => void }) {
  const action = useAction()
  return (
    <li>
      <div>
        <strong>{formatHours(Number(entry.hours))}</strong> {entry.job ? `${entry.job.job_number} ${entry.job.title}` : entry.category.replace(/_/g, ' ')}
        {(entry.activity || entry.activity_custom) && <div className="small">{entry.activity ? `${entry.activity.group_name}: ${entry.activity.name}` : `${entry.activity_custom} (custom)`}</div>}
        {entry.description && <div className="muted small">{entry.description}</div>}
        {entry.category !== 'leave' && entry.entered_by && (staffProfile
          ? entry.entered_by !== staffProfile && <div className="muted small">Entered on your behalf by your approver</div>
          : entry.entered_by === me && <div className="muted small">Entered by you on their behalf</div>)}
        {entry.is_late_entry && <div className="muted small">Late entry: {entry.late_reason}</div>}
        {entry.status === 'returned' && <div className="form-error small">Returned: {entry.return_note}. Remove it and log it again correctly.</div>}
      </div>
      <div className="row-actions">
        <StatusBadge status={entry.status} />
        {entry.status !== 'approved' && entry.category !== 'leave' && (
          <button className="link" disabled={action.busy} onClick={() => action.run(async () => {
            const { error } = await supabase.from('timesheet_entries').delete().eq('id', entry.id)
            if (error) return friendlyError(error)
            onChanged()
          })}>Remove</button>
        )}
      </div>
      {action.error && <p className="form-error small">{action.error}</p>}
    </li>
  )
}

// ---------------------------------------------------------------------------
// /timesheet/approvals (Project lead for the team; Owner for the Project lead
// and Admin; D-015)
// ---------------------------------------------------------------------------
export function TimesheetApprovalsPage() {
  const { profile, role } = useAuth()
  const qc = useQueryClient()
  const pending = useQuery({
    queryKey: ['timesheet-approvals'],
    queryFn: async () => (await supabase.from('timesheet_entries')
      .select('id, staff_id, work_date, hours, category, description, is_late_entry, late_reason, billable, activity_custom, job:jobs(job_number, title), activity:timesheet_activities(group_name, name), staff:staff(full_name, approver_staff_id)')
      .eq('status', 'submitted').order('work_date')).data ?? [],
  })
  const mine = (pending.data ?? []).filter((e) => e.staff_id !== profile?.staff_id &&
    (role === 'owner' || e.staff?.approver_staff_id === profile?.staff_id))
  const byPerson = new Map<string, typeof mine>()
  for (const e of mine) byPerson.set(e.staff?.full_name ?? '', [...(byPerson.get(e.staff?.full_name ?? '') ?? []), e])
  const action = useAction()
  const [returning, setReturning] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['timesheet-approvals'] })

  const approve = (ids: string[]) => action.run(async () => {
    const { error } = await supabase.from('timesheet_entries').update({ status: 'approved' }).in('id', ids)
    if (error) return friendlyError(error)
    await refresh()
  })

  return (
    <section>
      <header className="page-header"><div><h1>Timesheet approvals</h1>
        <p className="muted">Approving freezes the cost and charge-out rates in force on the day worked (brief §8).</p></div></header>
      {action.error && <p className="form-error">{action.error}</p>}
      {mine.length === 0 ? <p className="empty">Nothing waiting for your approval.</p> : [...byPerson.entries()].map(([name, rows]) => (
        <div key={name} className="panel" style={{ marginBottom: '1rem' }}>
          <header className="page-header"><h2 style={{ margin: 0 }}>{name}: {rows.reduce((s, r) => s + Number(r.hours), 0)} h</h2>
            <button className="primary" disabled={action.busy} onClick={() => approve(rows.map((r) => r.id))}>Approve all</button></header>
          <div className="table-wrap"><table className="compact">
            <thead><tr><th>Day</th><th>Work</th><th className="num">Hours</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(r.work_date)}</td>
                <td>{r.job ? `${r.job.job_number} ${r.job.title}` : r.category.replace(/_/g, ' ')}{!r.billable && r.category === 'job' && <span className="muted small"> (non-billable)</span>}
                  {(r.activity || r.activity_custom) && <div className="small">{r.activity ? `${r.activity.group_name}: ${r.activity.name}` : `${r.activity_custom} (custom)`}</div>}
                  {r.description && <div className="muted small">{r.description}</div>}
                  {r.is_late_entry && <div className="warn-text small">Late entry: {r.late_reason}</div>}</td>
                <td className="num">{r.hours}</td>
                <td className="row-actions"><button disabled={action.busy} onClick={() => approve([r.id])}>Approve</button>
                  <button className="link" onClick={() => setReturning(r.id)}>Return</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
      {returning && <PromptDialog title="Return this entry" label="What needs correcting?" confirmLabel="Return" onClose={() => setReturning(null)}
        onSubmit={async (note) => {
          const { error } = await supabase.from('timesheet_entries').update({ status: 'returned', return_note: note }).eq('id', returning)
          if (error) return friendlyError(error)
          await refresh(); return null
        }} />}
    </section>
  )
}
