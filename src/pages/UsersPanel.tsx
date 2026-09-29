import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ROLE_LABELS, type Role } from '../auth/roles'
import { Dialog } from '../components/Dialog'
import { formatDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../resources/useLookups'

const INVITABLE: Role[] = ['director', 'accountant', 'admin', 'project_lead', 'staff']

/** Settings > Users (Owner only; brief §3 "Only the Owner can manage users and roles"). */
export function UsersPanel() {
  const qc = useQueryClient()
  const users = useQuery({
    queryKey: ['user_directory'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_directory').select('*').order('full_name')
      if (error) throw error
      return data
    },
  })
  const staff = useQuery({
    queryKey: ['lookup', 'staff-for-invite'],
    queryFn: async () => (await supabase.from('staff').select('id, full_name, email').order('full_name')).data ?? [],
  })
  const directors = useQuery({
    queryKey: ['lookup', 'directors-for-invite'],
    queryFn: async () => (await supabase.from('directors').select('id, full_name, profile_id').order('full_name')).data ?? [],
  })
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function update(userId: string, patch: { role?: Role; is_active?: boolean }) {
    setError(null)
    const { error } = await supabase.from('profiles').update(patch).eq('user_id', userId)
    if (error) setError(friendlyError(error))
    await qc.invalidateQueries({ queryKey: ['user_directory'] })
  }

  const linkedStaff = new Set((users.data ?? []).map((u) => u.staff_id).filter(Boolean))

  return (
    <section>
      <header className="page-header">
        <p className="muted">Invites come from noreply@themelins.com. Owner, Directors and the Accountant set up two-factor sign-in on first log-in.</p>
        <button className="primary" onClick={() => setInviting(true)}>+ Invite user</button>
      </header>
      {error && <p className="form-error">{error}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead>
        <tbody>
          {(users.data ?? []).map((u) => (
            <tr key={u.user_id}>
              <td>{u.full_name}{u.staff_name && u.staff_name !== u.full_name && <div className="muted small">{u.staff_name}</div>}</td>
              <td>{u.email}</td>
              <td>
                {u.role === 'owner' ? ROLE_LABELS.owner : (
                  <select value={u.role ?? ''} onChange={(e) => update(u.user_id!, { role: e.target.value as Role })}>
                    {INVITABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                )}
              </td>
              <td>
                {!u.accepted_invite ? <span className="muted">Invited</span> : u.is_active ? 'Active' : 'Deactivated'}
                {u.role !== 'owner' && (
                  <div><button className="link" onClick={() => update(u.user_id!, { is_active: !u.is_active })}>
                    {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </button></div>
                )}
              </td>
              <td>{u.last_sign_in_at ? formatDate(u.last_sign_in_at) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {inviting && (
        <Dialog title="Invite user" onClose={() => setInviting(false)}>
          <InviteForm
            staff={(staff.data ?? []).filter((s) => !linkedStaff.has(s.id))}
            directors={(directors.data ?? []).filter((d) => !d.profile_id)}
            onDone={async () => { setInviting(false); await qc.invalidateQueries({ queryKey: ['user_directory'] }) }}
          />
        </Dialog>
      )}
    </section>
  )
}

function InviteForm({ staff, directors, onDone }: {
  staff: { id: string; full_name: string; email: string | null }[]
  directors: { id: string; full_name: string }[]
  onDone: () => void
}) {
  const [role, setRole] = useState<Role>('staff')
  const [staffId, setStaffId] = useState('')
  const [directorId, setDirectorId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const needsStaff = role === 'admin' || role === 'project_lead' || role === 'staff'

  function pickStaff(id: string) {
    setStaffId(id)
    const s = staff.find((x) => x.id === id)
    if (s) { setName(s.full_name); if (s.email) setEmail(s.email) }
  }
  function pickDirector(id: string) {
    setDirectorId(id)
    const d = directors.find((x) => x.id === id)
    if (d) setName(d.full_name)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: { email, full_name: name, role, staff_id: needsStaff ? staffId || null : null,
              director_id: role === 'director' ? directorId || null : null, redirect_to: window.location.origin },
    })
    setBusy(false)
    if (error) {
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null)
      setError(detail?.error ?? error.message)
      return
    }
    if (data?.error) { setError(data.error); return }
    onDone()
  }

  return (
    <form onSubmit={submit} className="stack">
      <label>Role
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {INVITABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </label>
      {needsStaff && (
        <label>Staff record
          <select value={staffId} onChange={(e) => pickStaff(e.target.value)} required>
            <option value="">Choose…</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </label>
      )}
      {role === 'director' && (
        <label>Director
          <select value={directorId} onChange={(e) => pickDirector(e.target.value)} required>
            <option value="">Choose…</option>
            {directors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </select>
        </label>
      )}
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button>
      </div>
    </form>
  )
}
