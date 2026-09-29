// Turns a Supabase Auth error into what the person should actually be told.
// Only a genuine credentials failure says "email and password don't match";
// anything else (unreachable server, 404, rate limit, unconfirmed email) is
// shown as it is, with the HTTP status, so a setup problem isn't mistaken for
// a wrong password.

export interface AuthErrorLike {
  message?: string
  status?: number
  code?: string
  name?: string
}

export function signInErrorMessage(err: AuthErrorLike | null | undefined): string | null {
  if (!err) return null
  const code = err.code ?? ''
  const status = err.status
  const message = (err.message ?? '').trim()

  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return 'That email and password don\'t match.'
  }
  if (code === 'email_not_confirmed') {
    return 'This account hasn\'t been confirmed yet. Open the invite email and choose your password first.'
  }
  if (code === 'user_banned') {
    return 'This account has been deactivated. Ask the Managing Director.'
  }
  if (code === 'over_request_rate_limit' || status === 429) {
    return 'Too many attempts. Wait a minute and try again.'
  }
  // supabase-js: no response at all -> AuthRetryableFetchError with status 0.
  if (status === 0 || (!status && /failed to fetch|network|load failed/i.test(message))) {
    return `Couldn't reach the sign-in service. Check your connection${message ? ` (${message})` : ''}.`
  }
  // supabase-js: a reply that isn't JSON (e.g. an HTML 404 page) -> AuthUnknownError, no status.
  if (!status) {
    return `The sign-in service sent an unexpected reply, so the app's Supabase settings may be wrong.${message ? ` Details: ${message}` : ''}`
  }
  if (status === 404) {
    return `The sign-in service wasn't found (HTTP 404). The app's Supabase URL is probably wrong.${message ? ` Details: ${message}` : ''}`
  }
  if (status >= 500) {
    return `The sign-in service had a problem (HTTP ${status}). Try again shortly.${message ? ` Details: ${message}` : ''}`
  }
  return `Sign-in failed (HTTP ${status}${code ? `, ${code}` : ''}): ${message || 'no details'}`
}
