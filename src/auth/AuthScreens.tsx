import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthProvider'
import { signInErrorMessage } from './authErrors'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="wordmark">MeLiNS</div>
        <div className="tagline">STRUCTURES · CIVILS · DEVELOPMENT CONSULTANTS</div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  )
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="form-error" role="alert">{error}</p> : null
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    setError(signInErrorMessage(error))
  }

  async function forgot() {
    if (!email.trim()) { setError('Enter your email first.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/me' })
    setBusy(false)
    if (error) setError(signInErrorMessage(error))
    else setResetSent(true)
  }

  return (
    <Card title="Sign in">
      <form onSubmit={submit} className="stack">
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <ErrorLine error={error} />
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {resetSent
          ? <p className="muted">If that email has an account, a reset link is on its way from noreply@themelins.com.</p>
          : <button type="button" className="link" onClick={forgot} disabled={busy}>Forgot your password?</button>}
      </form>
      <p className="muted small">Accounts are by invitation from the Managing Director.</p>
    </Card>
  )
}

export function SetPasswordPage() {
  const { passwordSet } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 10) { setError('Use at least 10 characters.'); return }
    if (password !== confirm) { setError('The passwords don\'t match.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message); else passwordSet()
  }

  return (
    <Card title="Choose your password">
      <form onSubmit={submit} className="stack">
        <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
        <ErrorLine error={error} />
        <button className="primary" disabled={busy}>Save password</button>
      </form>
    </Card>
  )
}

export function NoProfilePage() {
  const { signOut } = useAuth()
  return (
    <Card title="No access yet">
      <p>Your sign-in worked, but your account isn't set up in the Command Centre, or it has been deactivated. Ask the Managing Director.</p>
      <button onClick={signOut}>Sign out</button>
    </Card>
  )
}

/** First log-in for Owner, Directors and Accountant: set up an authenticator app (A-005). */
export function MfaEnrolPage() {
  const { refresh, signOut } = useAuth()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      // Clear any half-finished enrolment from an earlier attempt.
      const { data: list } = await supabase.auth.mfa.listFactors()
      for (const f of list?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' })
      if (error) { setError(error.message); return }
      setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret)
    })()
  }, [])

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    if (error) setError('That code didn\'t work. Check the time on your phone and try the next code.')
    else await refresh()
  }

  return (
    <Card title="Set up two-factor sign-in">
      <p>Your role sees the company's finances, so every sign-in needs a code from an authenticator app (Google Authenticator, Microsoft Authenticator or similar).</p>
      <ol className="small">
        <li>Open the app and add an account by scanning this code.</li>
        <li>Enter the 6-digit code it shows.</li>
      </ol>
      {qr && <img className="qr" src={qr} alt="QR code for your authenticator app" />}
      {secret && <p className="small muted">Can't scan? Enter this key: <code>{secret}</code></p>}
      <form onSubmit={verify} className="stack">
        <label>6-digit code<input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" value={code} onChange={(e) => setCode(e.target.value)} required /></label>
        <ErrorLine error={error} />
        <button className="primary" disabled={!factorId}>Verify and continue</button>
      </form>
      <button className="link" onClick={signOut}>Sign out</button>
    </Card>
  )
}

export function MfaVerifyPage() {
  const { refresh, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function verify(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const { data } = await supabase.auth.mfa.listFactors()
    const factors = (data?.totp ?? []).filter((f) => f.status === 'verified')
    if (factors.length === 0) { setError('No authenticator found on your account. Ask the Managing Director to reset it.'); return }
    // The code may come from the main or a backup authenticator: try each.
    for (const factor of factors) {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
      if (!error) { await refresh(); return }
    }
    setError('That code didn\'t work. Try the next one.')
  }

  return (
    <Card title="Enter your code">
      <form onSubmit={verify} className="stack">
        <label>6-digit code from your authenticator app
          <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
        </label>
        <ErrorLine error={error} />
        <button className="primary">Continue</button>
      </form>
      <button className="link" onClick={signOut}>Sign out</button>
    </Card>
  )
}

/** Shows the right screen for the session's state, or the app once ready. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  switch (state) {
    case 'loading': return <div className="auth-page"><p className="muted">Loading…</p></div>
    case 'signed_out': return <LoginPage />
    case 'set_password': return <SetPasswordPage />
    case 'no_profile': return <NoProfilePage />
    case 'mfa_enrol': return <MfaEnrolPage />
    case 'mfa_verify': return <MfaVerifyPage />
    case 'ready': return <>{children}</>
  }
}
