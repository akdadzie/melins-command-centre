// Shared by the Owner-only Edge Functions: CORS, JSON replies, and the check
// that the caller is the active Owner signed in with two-factor (aal2).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

export type OwnerCheck = { ok: true; ownerId: string; admin: SupabaseClient } | { ok: false; response: Response }

export async function requireOwner(req: Request): Promise<OwnerCheck> {
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // getUser() verifies the token; its aal claim says whether 2FA was passed (A-005).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user } } = await caller.auth.getUser(token)
  if (!user) return { ok: false, response: reply(401, { error: 'Sign in first' }) }
  let aal = 'aal1'
  try { aal = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal ?? 'aal1' } catch { /* stays aal1 */ }
  const { data: me } = await caller.from('profiles').select('role, is_active').eq('user_id', user.id).maybeSingle()
  if (me?.role !== 'owner' || !me.is_active || aal !== 'aal2') {
    return { ok: false, response: reply(403, { error: 'Only the Owner, signed in with two-factor authentication, can do this' }) }
  }
  return { ok: true, ownerId: user.id, admin: createClient(url, service, { auth: { persistSession: false } }) }
}
