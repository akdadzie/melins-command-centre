// Invite a user (brief §3: invite only; only the Owner creates users).
// Called from Settings > Users with the Owner's session. Uses the service
// role, which Supabase injects into Edge Functions and never reaches the browser.
import { cors, reply, requireOwner } from '../_shared/owner.ts'

const ROLES = ['owner', 'director', 'accountant', 'admin', 'project_lead', 'staff'] as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'POST only' })
  const check = await requireOwner(req)
  if (!check.ok) return check.response

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

  const { data, error } = await check.admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: body.full_name.trim(), role: body.role, staff_id: body.staff_id ?? null, director_id: body.director_id ?? null },
    redirectTo: body.redirect_to,
  })
  if (error) return reply(400, { error: error.message })
  return reply(200, { user_id: data.user?.id, email })
})
