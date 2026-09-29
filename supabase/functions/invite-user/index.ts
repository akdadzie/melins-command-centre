// Invite a user (brief §3: invite only; only the Owner creates users).
// Called from Settings > Users with the Owner's session. Uses the service
// role, which Supabase injects into Edge Functions and never reaches the browser.
import { createClient } from 'npm:@supabase/supabase-js@2'

const ROLES = ['owner', 'director', 'accountant', 'admin', 'project_lead', 'staff'] as const
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'POST only' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Who is calling? getUser() verifies the token; the aal claim says whether
  // this session passed two-factor authentication (A-005).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user } } = await caller.auth.getUser(token)
  if (!user) return reply(401, { error: 'Sign in first' })
  let aal = 'aal1'
  try { aal = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal ?? 'aal1' } catch { /* stays aal1 */ }
  const { data: me } = await caller.from('profiles').select('role, is_active').eq('user_id', user.id).maybeSingle()
  if (me?.role !== 'owner' || !me.is_active || aal !== 'aal2') {
    return reply(403, { error: 'Only the Owner, signed in with two-factor authentication, can invite users' })
  }

  let body: { email?: string; full_name?: string; role?: string; staff_id?: string | null; director_id?: string | null; redirect_to?: string }
  try { body = await req.json() } catch { return reply(400, { error: 'Invalid request' }) }
  const email = body.email?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter a valid email' })
  if (!body.full_name?.trim()) return reply(400, { error: 'Enter the person\'s name' })
  if (!ROLES.includes(body.role as typeof ROLES[number])) return reply(400, { error: 'Choose a role' })
  if (body.role === 'owner') return reply(400, { error: 'There is one Owner; the Owner account is set up once' })
  if (['admin', 'project_lead', 'staff'].includes(body.role!) && !body.staff_id) {
    return reply(400, { error: 'Link this person to their staff record (they log time and get payslips)' })
  }
  if (body.role === 'director' && !body.director_id) return reply(400, { error: 'Link the director record' })

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: body.full_name.trim(), role: body.role, staff_id: body.staff_id ?? null, director_id: body.director_id ?? null },
    redirectTo: body.redirect_to,
  })
  if (error) return reply(400, { error: error.message })
  return reply(200, { user_id: data.user?.id, email })
})
