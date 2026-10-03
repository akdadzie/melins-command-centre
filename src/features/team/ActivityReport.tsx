// /team/activities (D-044): hours by activity, per job and per person, and
// the custom activities people typed, for the Owner to promote into the list
// (D-042). Leave is left out.
import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { canWrite } from '../../auth/roles'
import { Dialog } from '../../components/Dialog'
import { useAction } from '../../components/ui'
import { formatDate, formatHours, todayAccra } from '../../lib/format'
import { GO_LIVE_MONTH } from '../../lib/golive'
import { supabase } from '../../lib/supabase'
import { friendlyError } from '../../resources/useLookups'

type By = 'activity' | 'job' | 'person'
type Row = { staff_id: string; full_name: string; job_id: string | null; job_number: string | null; job_title: string | null; category: string
  activity_group: string; activity: string; is_custom: boolean; hours: number; entries: number }

const CATEGORY: Record<string, string> = { job: 'Job', internal: 'Internal / admin', business_development: 'Business development', goodwill: 'Goodwill / mentor' }

/** Rows grouped by one dimension, each broken down by another. Pure, for the table. */
export function pivot(rows: Row[], by: By) {
  const keyOf = (r: Row) => by === 'activity' ? `${r.activity_group} › ${r.activity}${r.is_custom ? ' (custom)' : ''}`
    : by === 'job' ? (r.job_number ? `${r.job_number} ${r.job_title ?? ''}` : CATEGORY[r.category] ?? r.category)
    : r.full_name
  const subOf = (r: Row) => by === 'activity' ? r.full_name : `${r.activity_group} › ${r.activity}`
  const map = new Map<string, { hours: number; entries: number; parts: Map<string, number> }>()
  for (const r of rows) {
    const k = keyOf(r)
    const g = map.get(k) ?? { hours: 0, entries: 0, parts: new Map() }
    g.hours += Number(r.hours); g.entries += r.entries
    g.parts.set(subOf(r), (g.parts.get(subOf(r)) ?? 0) + Number(r.hours))
    map.set(k, g)
  }
  return [...map.entries()].map(([key, g]) => ({ key, hours: g.hours, entries: g.entries,
    parts: [...g.parts.entries()].sort((a, b) => b[1] - a[1]) })).sort((a, b) => b.hours - a.hours)
}

const monthFirst = (iso: string) => `${iso.slice(0, 7)}-01`

export function ActivityReportPage() {
  const { role } = useAuth()
  const today = todayAccra()
  const [from, setFrom] = useState(monthFirst(today) < GO_LIVE_MONTH ? GO_LIVE_MONTH : monthFirst(today))
  const [to, setTo] = useState(today)
  const [by, setBy] = useState<By>('activity')
  const [job, setJob] = useState('')
  const [person, setPerson] = useState('')
  const [promoting, setPromoting] = useState<{ activity: string; key: string } | null>(null)
  const data = useQuery({
    queryKey: ['activity-hours', from, to],
    queryFn: async () => ((await supabase.rpc('timesheet_activity_hours', { p_from: from, p_to: to })).data ?? []) as Row[],
  })
  const custom = useQuery({
    queryKey: ['custom-activities'],
    queryFn: async () => (await supabase.from('timesheet_custom_activities').select('*').order('entries', { ascending: false })).data ?? [],
  })
  const rows = (data.data ?? []).filter((r) => (!job || r.job_id === job) && (!person || r.staff_id === person))
  const table = useMemo(() => pivot(rows, by), [rows, by])
  const total = rows.reduce((s, r) => s + Number(r.hours), 0)
  const jobs = [...new Map((data.data ?? []).filter((r) => r.job_id).map((r) => [r.job_id!, `${r.job_number} ${r.job_title}`])).entries()]
  const people = [...new Map((data.data ?? []).map((r) => [r.staff_id, r.full_name])).entries()]

  return (
    <section>
      <header className="page-header"><div><h1>Hours by activity</h1>
        <p className="muted">What time went on, from the activity chosen on each timesheet entry (leave left out).</p></div></header>
      <div className="row-actions" style={{ alignItems: 'end', marginBottom: '1rem' }}>
        <label>From<input type="date" value={from} min={GO_LIVE_MONTH} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>Group by<select value={by} onChange={(e) => setBy(e.target.value as By)}>
          <option value="activity">Activity</option><option value="job">Job</option><option value="person">Person</option></select></label>
        <label>Job<select value={job} onChange={(e) => setJob(e.target.value)}><option value="">All</option>
          {jobs.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        <label>Person<select value={person} onChange={(e) => setPerson(e.target.value)}><option value="">Everyone</option>
          {people.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
      </div>
      {rows.length === 0 ? <p className="empty">No time logged in this period{job || person ? ' for this selection' : ''}.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{by === 'activity' ? 'Activity' : by === 'job' ? 'Job' : 'Person'}</th><th className="num">Hours</th><th className="num">Share</th>
            <th>{by === 'activity' ? 'By person' : 'By activity'}</th></tr></thead>
          <tbody>
            {table.map((g) => (
              <tr key={g.key}><td>{g.key}</td><td className="num">{formatHours(g.hours)}</td><td className="num">{total ? Math.round(100 * g.hours / total) : 0}%</td>
                <td className="small">{g.parts.slice(0, 4).map(([k, h]) => `${k} ${formatHours(h)}`).join(' · ')}{g.parts.length > 4 ? ` · +${g.parts.length - 4} more` : ''}</td></tr>
            ))}
            <tr className="total-row"><td>Total</td><td className="num">{formatHours(total)}</td><td className="num">100%</td><td /></tr>
          </tbody>
        </table></div>
      )}

      <h2>Custom activities</h2>
      <p className="muted small">Activities people typed under "Custom". Common ones can be added to the list{role === 'owner' ? ': "Add to the list" also moves these entries onto it' : ' by the Owner'}.</p>
      {(custom.data ?? []).length === 0 ? <p className="muted small">None yet.</p> : (
        <div className="table-wrap"><table className="compact">
          <thead><tr><th>Activity</th><th className="num">Entries</th><th className="num">Hours</th><th className="num">People</th><th>Last used</th><th /></tr></thead>
          <tbody>{(custom.data ?? []).map((c) => (
            <tr key={c.key!}><td>{c.activity}</td><td className="num">{c.entries}</td><td className="num">{formatHours(Number(c.hours))}</td>
              <td className="num">{c.people}</td><td>{formatDate(c.last_used)}</td>
              <td>{role === 'owner' && canWrite(role) && <button onClick={() => setPromoting({ activity: c.activity!, key: c.key! })}>Add to the list</button>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {role === 'owner' && <p className="small"><Link to="/settings?tab=data">Edit the activity list</Link> (Settings › Reference data › Timesheet activities)</p>}
      {promoting && <PromoteDialog custom={promoting} onClose={() => setPromoting(null)} />}
    </section>
  )
}

function PromoteDialog({ custom, onClose }: { custom: { activity: string; key: string }; onClose: () => void }) {
  const qc = useQueryClient()
  const groups = useQuery({ queryKey: ['activity-groups'], queryFn: async () =>
    [...new Set(((await supabase.from('timesheet_activities').select('group_name').order('sort_order')).data ?? []).map((g) => g.group_name))] })
  const [group, setGroup] = useState('')
  const [name, setName] = useState(custom.activity)
  const action = useAction()
  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await action.run(async () => {
      const { error } = await supabase.rpc('promote_custom_activity', { p_custom: custom.key, p_group: group, p_name: name })
      if (error) return friendlyError(error)
      for (const k of ['custom-activities', 'activity-hours', 'timesheet-activities']) await qc.invalidateQueries({ queryKey: [k] })
    })
    if (ok) onClose()
  }
  return (
    <Dialog title="Add to the activity list" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>Group<input list="activity-groups" value={group} onChange={(e) => setGroup(e.target.value)} required placeholder="e.g. Site" />
          <datalist id="activity-groups">{(groups.data ?? []).map((g) => <option key={g} value={g} />)}</datalist></label>
        <label>Name in the list<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <p className="muted small">Every entry typed as "{custom.activity}" moves onto this list item, so it reports together from now on.</p>
        {action.error && <p className="form-error">{action.error}</p>}
        <div className="form-actions"><button className="primary" disabled={action.busy}>Add</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  )
}
