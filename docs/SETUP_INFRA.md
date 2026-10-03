# Infrastructure setup: Owner's steps

This guide covers everything you need to do in Supabase, Netlify, cPanel and Namecheap. **For production, follow `docs/GO_LIVE_PRODUCTION.md`**, which takes these steps in order for the 12 Oct soft launch. **Never paste a password, service-role key, database password or SMTP password into chat or into any committed file.**

## 1. Values I need, and where they go

| From | Value | Secret? | Where it goes |
|---|---|---|---|
| Supabase **staging**: Settings → General | Project ref (e.g. `abcd1234efgh`) | No, fine to tell me in chat | `supabase/config` link step (§2) |
| Supabase **staging**: Settings → API / Data API | Project URL `https://<ref>.supabase.co` | No | `.env.local` and Netlify (Branch deploys + Local) |
| Supabase **staging**: Settings → API Keys | `anon` / publishable key | Public by design, but enter it yourself | `.env.local` and Netlify (Branch deploys + Local) |
| Supabase **production** | Project ref, URL, `anon` key | Same as above | Netlify (Production context only) |
| Netlify | Site name (e.g. `melins-cc.netlify.app`) | No | Tell me in chat |
| Both Supabase projects | Database password | **Yes** | Only typed at the CLI prompt in §2, never saved in the repo |
| Both Supabase projects | `service_role` key | **Yes** | **Nowhere in the app.** Edge Functions get it automatically. The backup job will use a GitHub Actions secret (set up later) |
| cPanel | `noreply@themelins.com` password | **Yes** | Only in the Supabase SMTP form (§4) |

### Local file: `.env.local` (git-ignored; staging values only)
Copy `.env.example` to `.env.local` and fill in:
```
VITE_SUPABASE_URL=https://<staging-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<staging anon key>
VITE_APP_ENV=staging
```

### Netlify environment variables
Netlify → your site → **Site configuration → Environment variables → Add a variable → "Different value for each deploy context"**:

| Key | Production | Branch deploys | Local development |
|---|---|---|---|
| `VITE_SUPABASE_URL` | production URL | staging URL | staging URL |
| `VITE_SUPABASE_ANON_KEY` | production anon key | staging anon key | staging anon key |
| `VITE_APP_ENV` | `production` | `staging` | `staging` |

## 2. Linking the Supabase CLI (for applying migrations)
When the first migration is ready, run these in `C:\dev\melins-ims`:
```
npx supabase login                      # opens the browser; no key pasted anywhere
npx supabase link --project-ref <staging-ref>   # asks for the staging DB password: type it at the prompt
npx supabase db push                    # applies migrations to staging
```
Production uses the same steps with the production ref, **only after the staging acceptance tests pass**.

## 3. Supabase Auth settings (do on BOTH projects)
- **Authentication → Sign In / Providers:** Email enabled; **"Allow new users to sign up" OFF** (invite only).
- **Authentication → Multi-Factor:** TOTP (authenticator app) enabled.
- **Authentication → URL Configuration:**
  - Production: Site URL `https://app.themelins.com`. Redirect URLs `https://app.themelins.com/**`
  - Staging: Site URL `https://staging--<site>.netlify.app`. Redirect URLs `https://staging--<site>.netlify.app/**` and `http://localhost:5173/**`
- **Authentication → Rate Limits:** after custom SMTP is on, set "emails per hour" to 100.

## 4. Branded email: create `noreply@themelins.com` in cPanel
1. cPanel → **Email → Email Accounts → + Create**. Domain `themelins.com`, username `noreply`, a long generated password (keep it in your password manager), storage 250 MB. Create.
2. On that account, click **Connect Devices**. Under **"Secure SSL/TLS Settings (Recommended)"**, note the **Outgoing Server** hostname (often `mail.themelins.com` or the server's own hostname, such as `server123.host.com`). **Use the exact hostname shown**, because the SSL certificate must match it.
3. Optional but recommended: set an autoresponder or forwarder so replies to noreply@ go to accounts@themelins.com.

### Supabase SMTP (do on BOTH projects)
Supabase → **Authentication → Emails → SMTP Settings → Enable custom SMTP**:

| Field | Value |
|---|---|
| Sender email | `noreply@themelins.com` |
| Sender name | `MeLiNS Command Centre` (staging: `MeLiNS Command Centre (STAGING)`) |
| Host | the Outgoing Server hostname from step 2 |
| Port | `465` (SSL). If that fails, try `587` (STARTTLS) |
| Username | `noreply@themelins.com` (the full address) |
| Password | the mailbox password, typed directly into this form |
| Minimum interval | 5 seconds |

To test, invite yourself on staging (Authentication → Users → Invite). The email should arrive from noreply@themelins.com and not land in spam.

## 5. SPF, DKIM and DMARC in Namecheap
First, confirm where DNS is actually served. Namecheap → Domain List → themelins.com → **Nameservers**.
- **Namecheap BasicDNS / PremiumDNS**: add the records in Namecheap → **Advanced DNS** (as below).
- **Custom nameservers pointing to your cPanel host**: Namecheap records are ignored. Add the same records in **cPanel → Zone Editor** instead.

Get the exact values from **cPanel → Email → Email Deliverability → themelins.com → Manage**. It shows the suggested SPF and the DKIM key for your server. Use those values, not generic ones.

| Type | Host | Value | Note |
|---|---|---|---|
| TXT | `@` | SPF from cPanel, e.g. `v=spf1 +a +mx +ip4:<server IP> include:<host spf> ~all` | **Only one SPF record is allowed.** If a `v=spf1 …` TXT record already exists, edit it to include the cPanel parts; don't add a second one |
| TXT | `default._domainkey` | `v=DKIM1; k=rsa; p=<long key from cPanel>` | Copy it whole. Namecheap accepts long values in a single field |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:accounts@themelins.com` | Start with `p=none`; tighten to `quarantine` after a month of clean reports |

**Do not change** the existing MX records, `www`, `mail` or `@` A records. That keeps the website and company email unaffected. After about 30–60 minutes, cPanel Email Deliverability should show SPF and DKIM as **Valid**.

## 6. App domain: `app.themelins.com` → Netlify
1. Netlify → **Domain management → Add a domain → `app.themelins.com`**. Netlify will ask for a CNAME.
2. Namecheap → Advanced DNS → **Add New Record → CNAME**, Host `app`, Value `<site>.netlify.app` (TTL Automatic). (If DNS is served by cPanel, add it in Zone Editor instead.)
3. Back in Netlify → Domain management → **HTTPS → Verify DNS configuration → Provision certificate** (Let's Encrypt, free).
4. Staging uses the Netlify branch URL `https://staging--<site>.netlify.app`. No DNS record is needed.

## 7. Netlify ↔ GitHub
Netlify → **Site configuration → Build & deploy → Continuous deployment → Link repository → GitHub → `akdadzie/melins-command-centre`**.
- Production branch: `main`
- Branch deploys: **"Let me add individual branches"** → `staging`
- Build command and publish directory come from `netlify.toml` in the repo (added with the front-end scaffold).

## 8. Weekly backup to Google Drive
Follow **docs/BACKUP_RESTORE.md** (DECISIONS A-046): create the restricted Drive folder, a Drive sign-in token, the backup passphrase (kept offline), and four GitHub secrets, then run the workflow once by hand.

## 9. First sign-in on staging (and later production)
Do these once per environment, in this order:
1. **Apply the latest migrations.** In `C:\dev\melins-ims`, run `npx supabase db push` (while linked to staging).
2. **Deploy the Edge Functions.** Run `npx supabase functions deploy invite-user`, `npx supabase functions deploy reset-mfa` and `npx supabase functions deploy send-emails`. Supabase gives them the service-role key automatically, and nothing is stored in the repo. (`send-emails` needs the email set-up in §10 before it sends anything.)
3. **Invite yourself.** Supabase dashboard → **Authentication → Users → Invite user**, with your email.
4. **Make that log-in the Owner.** Supabase dashboard → **SQL Editor** → run:
   ```sql
   select app.bootstrap_owner('<your email>');
   ```
5. **Accept the invite.** Open the invite email and choose a password. The app then asks you to set up an authenticator app (2FA).
6. **Invite everyone else.** Use **Settings → Users** in the app. Each person is linked to their staff or director record.

To run the app on this PC against staging:
1. Put the staging **anon / publishable key** in `.env.local` next to `VITE_SUPABASE_URL=https://cipklttzbvbsivzrkcvq.supabase.co`.
2. Run `npm run dev` and open http://localhost:5173.

## 10. Reminders and notification emails
**Reminders** run inside the database (migration 1600, DECISIONS A-042): every day at 06:00 and at 17:00 on working days. The migration switches on **pg_cron** and schedules both. To check: Supabase → **Integrations → Cron** should list `melins-daily-reminders` and `melins-timesheet-nudge`. If they're missing, enable **pg_cron** under **Database → Extensions** and run `npx supabase db push` again.

**Emails.** Notifications that need attention (approvals, overdue items, reminders, payslip ready) are also emailed by the `send-emails` function, every 10 minutes. It sends from `noreply@themelins.com` through cPanel, so finish §4 first. Do this once per project (staging, then production):

1. **Give the function its settings.** In `C:\dev\melins-ims`, create a file named `.env.mailer` (git ignores `.env.*`, so it's never committed) containing:
   ```
   SMTP_HOST=<cPanel outgoing server>
   SMTP_PORT=465
   SMTP_USER=noreply@themelins.com
   SMTP_PASS=<mailbox password>
   APP_URL=https://app.themelins.com
   APP_ENV=production
   MAILER_SECRET=<a long random string>
   ```
   On staging, use `APP_URL=https://staging--<site>.netlify.app` and `APP_ENV=staging` (emails then start with "[STAGING]"). Port **465** is required: Supabase functions can't send on 25 or 587. Linked to the project, run `npx supabase secrets set --env-file .env.mailer`, then delete the file. Never paste these values into chat.
2. **Deploy it:** `npx supabase functions deploy send-emails`. (`supabase/config.toml` already turns off JWT checks for this function; it checks `MAILER_SECRET` instead.)
3. **Schedule it.** Supabase → **Database → Extensions**: enable **pg_net**. Then in the **SQL Editor**, run this with the same random string as `MAILER_SECRET` and your project ref:
   ```sql
   select vault.create_secret('<the same long random string>', 'mailer_secret');
   select cron.schedule('melins-send-emails', '*/10 * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/send-emails',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-mailer-secret',
         (select decrypted_secret from vault.decrypted_secrets where name = 'mailer_secret')),
       body := '{}'::jsonb)
   $$);
   ```
4. **Test it.** Do something that sends an email (for example, on staging record leave for someone whose approver has a log-in; the approver is emailed), wait up to 10 minutes, and check the inbox and spam folder. Supabase → **Edge Functions → send-emails → Logs** shows each run and any SMTP error.
