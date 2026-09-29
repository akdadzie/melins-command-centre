// Startup checks for the Supabase settings. Pure, so they're unit-tested.

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string }

/**
 * VITE_SUPABASE_URL must be the project origin, e.g. https://abcd.supabase.co.
 * supabase-js appends /auth/v1, /rest/v1 itself, so a path (such as the
 * /rest/v1/ shown in the dashboard's API docs) breaks every request with a 404.
 * We reject it rather than trim it, so a wrong .env.local or Netlify variable
 * gets fixed instead of hidden.
 */
export function checkSupabaseUrl(raw: string | undefined): UrlCheck {
  const value = raw?.trim()
  if (!value) return { ok: false, error: 'VITE_SUPABASE_URL is not set.' }
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return { ok: false, error: `VITE_SUPABASE_URL "${value}" is not a valid URL. It should look like https://<project-ref>.supabase.co` }
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) {
    return { ok: false, error: `VITE_SUPABASE_URL must start with https:// (got "${value}").` }
  }
  if (u.pathname !== '/' || u.search || u.hash) {
    return {
      ok: false,
      error: `VITE_SUPABASE_URL must be just the project address, without a path. Change "${value}" to "${u.origin}".`,
    }
  }
  return { ok: true, url: u.origin }
}

/** Every problem with the build's Supabase settings, or null if they're usable. */
export function configProblem(url: string | undefined, anonKey: string | undefined): string | null {
  const problems: string[] = []
  const check = checkSupabaseUrl(url)
  if (!check.ok) problems.push(check.error)
  if (!anonKey?.trim()) problems.push('VITE_SUPABASE_ANON_KEY is not set.')
  if (problems.length === 0) return null
  return `${problems.join(' ')} Fix it in .env.local (on this PC) or in the Netlify environment variables (deployed), then restart or redeploy.`
}
