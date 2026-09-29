import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { ROLE_LABELS, type Role } from '../auth/roles'
import { formatDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import { ResourceList } from '../resources/ResourceList'
import * as R from '../resources/definitions'
import type { ResourceDef } from '../resources/types'
import { UsersPanel } from './UsersPanel'

/** Tabs of resource lists (Settings, Staff). */
export function ResourceTabs({ tabs }: { tabs: ResourceDef[] }) {
  const { role } = useAuth()
  const visible = tabs.filter((t) => role && t.readRoles.includes(role))
  const [active, setActive] = useState(visible[0]?.key)
  const current = visible.find((t) => t.key === active) ?? visible[0]
  return (
    <>
      <div className="tabs" role="tablist">
        {visible.map((t) => (
          <button key={t.key} role="tab" aria-selected={t.key === current?.key} onClick={() => setActive(t.key)}>{t.title}</button>
        ))}
      </div>
      {current && <ResourceList key={current.key} resource={current} />}
    </>
  )
}

export function SettingsPage() {
  const { role } = useAuth()
  const tabs = role === 'accountant'
    ? [R.whtRates, R.publicHolidays, R.statutoryLines, R.accounts, R.expenseCategories]
    : [R.accounts, R.whtRates, R.expenseCategories, R.jobTypes, R.leaveTypes, R.leaveEntitlements, R.publicHolidays]
  const [tab, setTab] = useState<'users' | 'data'>(role === 'owner' ? 'users' : 'data')
  return (
    <section>
      <header className="page-header"><div>
        <h1>Settings</h1>
        <p className="muted">Company details, tax codes, the statutory calendar and the setup wizard arrive with the next build step.</p>
      </div></header>
      {role === 'owner' && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')}>Users</button>
          <button role="tab" aria-selected={tab === 'data'} onClick={() => setTab('data')}>Reference data</button>
        </div>
      )}
      {tab === 'users' && role === 'owner' ? <UsersPanel /> : <ResourceTabs tabs={tabs} />}
    </section>
  )
}

export function StaffPage() {
  return <ResourceTabs tabs={[R.staff, R.staffCostHistory]} />
}

/** Staff see their own jobs without fees (brief §4). */
export function MyJobs() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['my_jobs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('my_jobs').select('*').order('due_date')
      if (error) throw error
      return data
    },
  })
  return (
    <section>
      <h1>My jobs</h1>
      {isLoading ? <p className="muted">Loading…</p> : data.length === 0 ? <p className="empty">You're not on any jobs yet.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Job</th><th>Client</th><th>Status</th><th>Due</th></tr></thead>
          <tbody>{data.map((j) => (
            <tr key={j.id}><td>{j.job_number} {j.title}</td><td>{j.client_name}</td><td>{j.delivery_status?.replace(/_/g, ' ')}</td><td>{formatDate(j.due_date)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  )
}

const QUICK: Partial<Record<Role, { to: string; label: string }[]>> = {
  owner: [{ to: '/import', label: 'Load go-live data' }, { to: '/clients', label: 'Clients' }, { to: '/jobs', label: 'Jobs' }, { to: '/settings', label: 'Settings' }],
  accountant: [{ to: '/import', label: 'Import and export' }, { to: '/tax/statutory', label: 'Statutory ledger' }, { to: '/settings', label: 'Tax settings' }],
  admin: [{ to: '/expenses', label: 'Record an expense' }, { to: '/clients', label: 'Clients' }, { to: '/jobs', label: 'Jobs' }, { to: '/import', label: 'Import data' }],
  project_lead: [{ to: '/jobs', label: 'Jobs' }, { to: '/clients', label: 'Clients' }],
  staff: [{ to: '/jobs', label: 'My jobs' }, { to: '/expenses', label: 'My expense claims' }],
  director: [{ to: '/jobs', label: 'Jobs' }, { to: '/clients', label: 'Clients' }],
}

/** Home screens (brief §6) are built after the list and detail views; this is the interim start page. */
export function Home() {
  const { profile, role } = useAuth()
  return (
    <section>
      <h1>Welcome, {profile?.full_name.split(' ')[0]}</h1>
      <p className="muted">Signed in as {role ? ROLE_LABELS[role] : ''}{role === 'director' ? '. You can see everything, and change nothing.' : '.'}</p>
      <div className="quick-links">
        {(role ? QUICK[role] ?? [] : []).map((q) => <Link key={q.to} className="tile" to={q.to}>{q.label}</Link>)}
      </div>
    </section>
  )
}
