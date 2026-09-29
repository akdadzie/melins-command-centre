import { useEffect, useState, type FormEvent } from 'react'
import type { Factor } from '@supabase/supabase-js'
import { useAuth } from '../auth/AuthProvider'
import { MFA_REQUIRED, ROLE_LABELS } from '../auth/roles'
import { formatDate } from '../lib/format'
import { supabase } from '../lib/supabase'

/** /me: profile, authenticators (with a backup), and password (brief §5 "My profile and 2FA"). */
export function MyProfile() {
  const { profile, role } = useAuth()
  const [factors, setFactors] = useState<Factor[]>([])
  const [adding, setAdding] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('Backup authenticator')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const required = role !== null && MFA_REQUIRED.includes(role)

  async function load() {
    const { data } = await supabase.auth.mfa.listFactors()
    setFactors((data?.all ?? []).filter((f) => f.status === 'verified'))
  }
  useEffect(() => { load() }, [])

  async function startAdd() {
    setMessage(null)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `${name} (${formatDate(new Date().toISOString())})` })
    if (error) { setMessage({ kind: 'error', text: error.message }); return }
    setAdding({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }

  async function finishAdd(e: FormEvent) {
    e.preventDefault()
    if (!adding) return
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: adding.id, code: code.trim() })
    if (error) { setMessage({ kind: 'error', text: 'That code didn\'t work. Try the next one.' }); return }
    setAdding(null); setCode('')
    setMessage({ kind: 'ok', text: 'Backup authenticator added. Keep it on a different device from your main one.' })
    await load()
  }

  async function cancelAdd() {
    if (adding) await supabase.auth.mfa.unenroll({ factorId: adding.id })
    setAdding(null); setCode('')
  }

  async function remove(f: Factor) {
    if (required && factors.length <= 1) {
      setMessage({ kind: 'error', text: 'Your role must keep at least one authenticator. Add a new one before removing this one.' })
      return
    }
    if (!confirm(`Remove "${f.friendly_name ?? 'authenticator'}"?`)) return
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id })
    if (error) setMessage({ kind: 'error', text: error.message })
    else { setMessage({ kind: 'ok', text: 'Authenticator removed.' }); await load() }
  }

  return (
    <section className="narrow">
      <h1>My profile</h1>
      <p>{profile?.full_name} · {profile?.email} · {role ? ROLE_LABELS[role] : ''}</p>

      <h2>Two-factor sign-in</h2>
      <p className="muted">
        {required ? 'Your role needs a code from an authenticator app at every sign-in.' : 'Optional for your role, but recommended.'}
        {' '}Add a <strong>backup authenticator</strong> on a second device (another phone, a tablet or a password manager) so losing your phone doesn't lock you out.
      </p>
      <div className="table-wrap"><table>
        <thead><tr><th>Authenticator</th><th>Added</th><th /></tr></thead>
        <tbody>
          {factors.length === 0 && <tr><td colSpan={3} className="muted">None yet.</td></tr>}
          {factors.map((f) => (
            <tr key={f.id}>
              <td>{f.friendly_name ?? 'Authenticator app'}</td>
              <td>{formatDate(f.created_at)}</td>
              <td className="num"><button className="link" onClick={() => remove(f)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {required && factors.length === 1 && (
        <p className="form-error">You have only one authenticator. If you lose that device, recovery needs the Supabase dashboard. Add a backup now.</p>
      )}

      {!adding ? (
        <div className="form-actions">
          <input aria-label="Name for the new authenticator" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 280 }} />
          <button className="primary" onClick={startAdd}>Add an authenticator</button>
        </div>
      ) : (
        <form onSubmit={finishAdd} className="stack">
          <p>Scan this with the <strong>second</strong> device, then enter the code it shows.</p>
          <img className="qr" src={adding.qr} alt="QR code for the new authenticator" />
          <p className="small muted">Or enter this key: <code>{adding.secret}</code></p>
          <label>6-digit code<input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" value={code} onChange={(e) => setCode(e.target.value)} required /></label>
          <div className="form-actions">
            <button className="primary">Verify and add</button>
            <button type="button" onClick={cancelAdd}>Cancel</button>
          </div>
        </form>
      )}
      {message && <p className={message.kind === 'ok' ? 'form-ok' : 'form-error'}>{message.text}</p>}

      <ChangePassword />
    </section>
  )
}

function ChangePassword() {
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 10) { setMessage({ kind: 'error', text: 'Use at least 10 characters.' }); return }
    if (password !== confirmPw) { setMessage({ kind: 'error', text: 'The passwords don\'t match.' }); return }
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setMessage({ kind: 'error', text: error.message })
    else { setMessage({ kind: 'ok', text: 'Password changed.' }); setPassword(''); setConfirmPw('') }
  }

  return (
    <>
      <h2>Password</h2>
      <form onSubmit={submit} className="stack" style={{ maxWidth: 360 }}>
        <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required /></label>
        {message && <p className={message.kind === 'ok' ? 'form-ok' : 'form-error'}>{message.text}</p>}
        <div><button className="primary">Change password</button></div>
      </form>
    </>
  )
}
