// Emails the notifications flagged send_email: approvals, overdue items and
// reminders (brief §3 "in-app first, with email for anything overdue or
// needing approval"; A-042). pg_cron calls it every 10 minutes
// (docs/SETUP_INFRA.md §10). Each email has the notification's title, any
// text, and a link to the record; payslips are never attached (brief §7.5).
// Secrets (set with `supabase secrets set`, never committed): SMTP_HOST,
// SMTP_PORT (465), SMTP_USER, SMTP_PASS, APP_URL, MAILER_SECRET, APP_ENV.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  const env = (k: string) => Deno.env.get(k)
  const secret = env('MAILER_SECRET')
  if (!secret || req.headers.get('x-mailer-secret') !== secret) return json(401, { error: 'Not allowed' })
  const host = env('SMTP_HOST'), user = env('SMTP_USER'), pass = env('SMTP_PASS'), appUrl = env('APP_URL')?.replace(/\/$/, '')
  if (!host || !user || !pass || !appUrl) return json(500, { error: 'Email is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, APP_URL)' })
  // Supabase Edge Functions can't connect out on ports 25 or 587; cPanel's 465 (SSL) works.
  const port = Number(env('SMTP_PORT') ?? '465')
  const staging = (env('APP_ENV') ?? 'staging') !== 'production'

  const admin = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // Only recent ones: if email was down for days, people have seen them in the app.
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const { data: due, error } = await admin.from('notifications')
    .select('id, title, body, link, recipient:profiles!notifications_recipient_id_fkey(email, full_name, is_active)')
    .eq('send_email', true).is('emailed_at', null).gte('created_at', since)
    .order('created_at').limit(50)
  if (error) return json(500, { error: error.message })
  if (!due?.length) return json(200, { sent: 0 })

  const client = new SMTPClient({ connection: { hostname: host, port, tls: port === 465, auth: { username: user, password: pass } } })
  let sent = 0
  const failed: string[] = []
  try {
    for (const n of due) {
      const to = n.recipient as unknown as { email: string | null; full_name: string; is_active: boolean } | null
      if (to?.email && to.is_active) {
        const link = `${appUrl}${n.link}`
        const subject = `${staging ? '[STAGING] ' : ''}${n.title}`
        const text = [`Hello ${to.full_name.split(' ')[0]},`, '', n.title, n.body ?? '', '', `Open it: ${link}`, '',
          'MeLiNS Command Centre. You get this email because it needs your attention; everything is also in the app.'].join('\n')
        const html = `<p>Hello ${escape(to.full_name.split(' ')[0])},</p><p><strong>${escape(n.title)}</strong></p>`
          + (n.body ? `<p>${escape(n.body)}</p>` : '')
          + `<p><a href="${escape(link)}" style="background:#C8102E;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open in the Command Centre</a></p>`
          + '<p style="color:#6b6b6b;font-size:12px">MeLiNS Associates Limited · STRUCTURES · CIVILS · DEVELOPMENT CONSULTANTS</p>'
        try {
          await client.send({ from: `MeLiNS Command Centre <${user}>`, to: to.email, subject, content: text, html })
          sent++
        } catch (e) {
          failed.push(`${n.id}: ${(e as Error).message}`)
          continue   // left unsent; tried again on the next run
        }
      }
      // Sent, or nobody to send it to (no email, or deactivated): don't try again.
      await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).eq('id', n.id)
    }
  } finally {
    await client.close().catch(() => undefined)
  }
  return json(failed.length ? 207 : 200, { sent, failed })
})
