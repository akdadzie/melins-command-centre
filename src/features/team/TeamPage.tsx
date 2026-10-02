// /team (brief §5, §6 Delivery, §4 compliance): who logged what this week,
// missing days, timesheet compliance and utilisation. Owner and Project lead
// (approvers act from here); Directors and the Accountant view.
import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate, todayAccra } from '../../lib/format'
import { supabase } from '../../lib/supabase'

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const mondayOf = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7))
const monthFirst = (iso: string) => `${iso.slice(0, 7)}-01`
const shiftMonth = (first: string, n: number) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }
const monthName = (first: string) => new Date(`${first}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })

export function TeamPage() {
  const { role, profile } = useAuth()
  const today = todayAccra()
  const [weekStart, setWeekStart] = useState(mondayOf(today))
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i))
  const approver = role === 'owner' || role === 'project_lead'

  const staff = useQuery({
    queryKey: ['team-staff'],
    queryFn: async () => (await supabase.from('staff').select('id, full_name, job_title, approver_staff_id, monthly_billable_target, start_date, end_date')
      .eq('is_active', true).order('full_name')).data ?? [],
  })
  const entries = useQuery({
    queryKey: ['team-week', weekStart],
    queryFn: async () => (await supabase.from('timesheet_entries').select('staff_id, work_date, hours, billable, category, status, is_late_entry')
      .gte('work_date', weekStart).lte('work_date', days[6])).data ?? [],
  })
  const holidays = useQuery({
    queryKey: ['holidays-map'],
    queryFn: async () => new Map(((await supabase.from('public_holidays').select('holiday_date, name')).data ?? []).map((h) => [h.holiday_date, h.name])),
  })
  const missing = useQuery({
    queryKey: ['team-missing', today],
    queryFn: async () => (await supabase.rpc('missing_timesheet_days', { p_from: addDays(today, -21), p_to: addDays(today, -1) })).data ?? [],
  })
  const compliance = useQuery({
    queryKey: ['team-compliance', monthFirst(today)],
    queryFn: async () => {
      const [cur, prev] = await Promise.all([
        supabase.rpc('timesheet_compliance', { p_from: monthFirst(today), p_to: today }),
        supabase.rpc('timesheet_compliance', { p_from: shiftMonth(monthFirst(today), -1), p_to: addDays(monthFirst(today), -1) }),
      ])
      return { cur: cur.data ?? [], prev: prev.data ?? [] }
    },
  })
  const util = useQuery({
    queryKey: ['utilisation-6', monthFirst(today)],
    queryFn: async () => (await supabase.rpc('utilisation', { p_from: shiftMonth(monthFirst(today), -5), p_to: today })).data ?? [],
  })

  const people = staff.data ?? []
  const cell = (staffId: string, d: string) => (entries.data ?? []).filter((e) => e.staff_id === staffId && e.work_date === d)
  const months = [...new Set((util.data ?? []).map((u) => u.month))].sort()
  const mine = (staffId: string) => role === 'owner' || people.find((p) => p.id === staffId)?.approver_staff_id === profile?.staff_id

  return (
    <section>
      <header className="page-header"><div><h1>Team workload and utilisation</h1>
        <p className="muted">Hours logged by day, days not logged, on-time logging and billable utilisation against each person's target (reduced for leave and public holidays).</p></div></header>

      <div className="month-nav">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">‹</button>
        <h2>Week of {formatDate(weekStart)}</h2>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week" disabled={addDays(weekStart, 7) > today}>›</button>
        {weekStart !== mondayOf(today) && <button className="link" onClick={() => setWeekStart(mondayOf(today))}>This week</button>}
      </div>
      <div className="table-wrap"><table className="compact">
        <thead><tr><th>Person</th>{days.map((d) => <th key={d} className="num">{dayName(d)}</th>)}<th className="num">Total</th><th className="num">Billable</th></tr></thead>
        <tbody>{people.map((p) => {
          const week = (entries.data ?? []).filter((e) => e.staff_id === p.id)
          return (
            <tr key={p.id}>
              <td>{p.full_name}<div className="muted small">{p.job_title}</div></td>
              {days.map((d) => {
                const c = cell(p.id, d)
                const weekend = new Date(`${d}T00:00:00Z`).getUTCDay() % 6 === 0
                const holiday = holidays.data?.get(d)
                const leave = c.some((e) => e.category === 'leave')
                const hours = c.reduce((s, e) => s + Number(e.hours), 0)
                const gap = !c.length && !weekend && !holiday && d < today && d >= p.start_date && (!p.end_date || d <= p.end_date)
                return (
                  <td key={d} className={`num ${gap ? 'row-bad' : ''}`} title={holiday ?? undefined}>
                    {leave ? <span className="muted">leave</span> : holiday ? <span className="muted">hol.</span>
                      : c.length ? <>{hours}{c.some((e) => e.status === 'submitted') && <span className="warn-text" title="awaiting approval">*</span>}
                        {c.some((e) => e.is_late_entry) && <span className="muted small" title="late entry"> L</span>}</>
                      : gap ? (approver && mine(p.id) ? <Link className="bad" to={`/timesheet?date=${d}&staff=${p.id}`}>none</Link> : <span className="bad">none</span>) : ''}
                  </td>
                )
              })}
              <td className="num"><strong>{week.reduce((s, e) => s + Number(e.hours), 0)}</strong></td>
              <td className="num">{week.filter((e) => e.billable).reduce((s, e) => s + Number(e.hours), 0)}</td>
            </tr>
          )
        })}</tbody>
      </table></div>
      <p className="muted small">* awaiting approval · L late entry · "none" = a working day with nothing logged{approver ? ' (open it to enter the time on their behalf, with a reason)' : ''}.</p>

      <div className="detail-grid">
        <div className="panel">
          <h3>Timesheet compliance <span className="muted small">working days logged on time</span></h3>
          <table className="compact">
            <thead><tr><th>Person</th><th className="num">{monthName(monthFirst(today))}</th><th className="num">{monthName(shiftMonth(monthFirst(today), -1))}</th></tr></thead>
            <tbody>{(compliance.data?.cur ?? []).map((c) => {
              const prev = compliance.data?.prev.find((x) => x.staff_id === c.staff_id)
              const tone = (v: number | null | undefined) => (v === null || v === undefined ? 'muted' : Number(v) < 80 ? 'warn-text' : 'ok-text')
              return (
                <tr key={c.staff_id}><td>{c.full_name}</td>
                  <td className={`num ${tone(c.on_time_pct)}`}>{c.on_time_pct === null ? '—' : `${c.on_time_pct}%`}
                    <div className="muted small">{c.late_days ? `${c.late_days} late ` : ''}{c.missing_days ? `${c.missing_days} missing` : ''}</div></td>
                  <td className={`num ${tone(prev?.on_time_pct)}`}>{prev?.on_time_pct === null || prev?.on_time_pct === undefined ? '—' : `${prev.on_time_pct}%`}</td></tr>
              )
            })}</tbody>
          </table>
          <p className="muted small">The Owner's own time has no window, so isn't scored.</p>
        </div>
        <div className="panel">
          <h3>Days not logged, last 3 weeks</h3>
          {(missing.data ?? []).length === 0 ? <p className="muted small">Everyone is up to date.</p> : (
            <ul className="plain">{[...new Set((missing.data ?? []).map((m) => m.staff_id))].map((sid) => {
              const rows = (missing.data ?? []).filter((m) => m.staff_id === sid)
              return <li key={sid}><strong>{rows[0].full_name}</strong>: {rows.map((r, i) => (
                <span key={r.work_date}>{i > 0 && ', '}{approver && mine(sid) ? <Link to={`/timesheet?date=${r.work_date}&staff=${sid}`}>{formatDate(r.work_date)}</Link> : formatDate(r.work_date)}
                  <span className="muted small"> (day {r.working_days_elapsed})</span></span>))}</li>
            })}</ul>
          )}
        </div>
      </div>

      <h2>Utilisation <span className="muted small">billable hours as % of target</span></h2>
      <div className="table-wrap"><table className="compact">
        <thead><tr><th>Person</th>{months.map((m) => <th key={m} className="num">{monthName(m)}</th>)}</tr></thead>
        <tbody>{[...new Set((util.data ?? []).map((u) => u.full_name))].map((name) => (
          <tr key={name}><td>{name}</td>{months.map((m) => {
            const u = (util.data ?? []).find((x) => x.full_name === name && x.month === m)
            const pct = u?.utilisation_pct
            return <td key={m} className={`num ${pct === null || pct === undefined ? 'muted' : pct >= 80 ? 'ok-text' : pct < 50 ? 'bad' : ''}`}>
              {pct === null || pct === undefined ? '—' : `${pct}%`}{u && <div className="muted small">{Number(u.billable_hours)} / {Number(u.target_hours)} h</div>}</td>
          })}</tr>
        ))}</tbody>
      </table></div>
    </section>
  )
}
