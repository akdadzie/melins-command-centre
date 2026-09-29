import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { MFA_REQUIRED, type Role } from './roles'

export interface Profile {
  user_id: string
  full_name: string
  email: string
  role: Role
  staff_id: string | null
  is_active: boolean
}

/**
 * signed_out      -> log-in page (the URL is kept, so the user lands on the link after signing in)
 * set_password    -> arrived from an invite or reset link
 * no_profile      -> signed in but no active profile (not invited properly, or deactivated)
 * mfa_enrol       -> Owner / Director / Accountant with no authenticator yet
 * mfa_verify      -> has an authenticator; this session hasn't passed it
 * ready
 */
export type AuthState = 'loading' | 'signed_out' | 'set_password' | 'no_profile' | 'mfa_enrol' | 'mfa_verify' | 'ready'

interface AuthContextValue {
  state: AuthState
  session: Session | null
  profile: Profile | null
  role: Role | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  passwordSet: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [needsPassword, setNeedsPassword] = useState(
    () => /type=(invite|recovery)/.test(window.location.hash),
  )

  const evaluate = useCallback(async (s: Session | null) => {
    setSession(s)
    if (!s) { setProfile(null); setState('signed_out'); return }
    if (needsPassword) { setState('set_password'); return }

    // Every user can read their own profile row even before 2FA, so we know
    // whether 2FA is required.
    const { data: p } = await supabase
      .from('profiles').select('user_id, full_name, email, role, staff_id, is_active')
      .eq('user_id', s.user.id).maybeSingle()
    if (!p || !p.is_active) { setProfile(null); setState('no_profile'); return }
    setProfile(p as Profile)

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') { setState('mfa_verify'); return }
    if (MFA_REQUIRED.includes(p.role as Role) && aal?.currentLevel !== 'aal2') { setState('mfa_enrol'); return }
    setState('ready')
  }, [needsPassword])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => evaluate(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true)
      // Defer: calling supabase inside the callback can deadlock the auth client.
      setTimeout(() => evaluate(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [evaluate])

  const value: AuthContextValue = {
    state,
    session,
    profile,
    role: state === 'ready' ? profile?.role ?? null : null,
    refresh: async () => { const { data } = await supabase.auth.getSession(); await evaluate(data.session) },
    signOut: async () => { await supabase.auth.signOut(); setState('signed_out') },
    passwordSet: () => {
      setNeedsPassword(false)
      history.replaceState(null, '', window.location.pathname + window.location.search)
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
