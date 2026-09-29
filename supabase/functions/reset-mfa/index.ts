// Reset another user's two-factor sign-in (docs/ACCESS_RECOVERY.md).
// Owner only, signed in with 2FA. The person keeps their password and sets
// up a new authenticator at their next sign-in. Logged in the audit log.
// The Owner's own reset is done from the Supabase SQL editor (app.reset_mfa).
import { cors, reply, requireOwner } from '../_shared/owner.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'POST only' })
  const check = await requireOwner(req)
  if (!check.ok) return check.response

  let body: { user_id?: string; reason?: string }
  try { body = await req.json() } catch { return reply(400, { error: 'Invalid request' }) }
  if (!body.user_id) return reply(400, { error: 'Choose the user' })
  if (!body.reason?.trim()) return reply(400, { error: 'Give the reason for the reset' })
  if (body.user_id === check.ownerId) {
    return reply(400, { error: 'Manage your own authenticators on My profile. If you are locked out, see the recovery guide.' })
  }

  const { data: factors, error: listError } = await check.admin.auth.admin.mfa.listFactors({ userId: body.user_id })
  if (listError) return reply(400, { error: listError.message })
  for (const f of factors?.factors ?? []) {
    const { error } = await check.admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: body.user_id })
    if (error) return reply(400, { error: error.message })
  }
  // Sign them out everywhere so no old session keeps two-factor status.
  await check.admin.auth.admin.signOut(body.user_id, 'global').catch(() => undefined)

  await check.admin.from('audit_log').insert({
    table_name: 'auth.mfa_factors', record_id: body.user_id, action: 'DELETE',
    old_data: { factors_removed: factors?.factors?.length ?? 0 },
    new_data: { reason: body.reason.trim(), via: 'reset-mfa' },
    changed_by: check.ownerId,
  })
  return reply(200, { removed: factors?.factors?.length ?? 0 })
})
