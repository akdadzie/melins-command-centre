# Infrastructure setup: Owner's steps

This guide covers everything you need to do in Supabase, Netlify, cPanel and Namecheap. **Never paste a password, service-role key, database password or SMTP password into chat or into any committed file.**

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

## 8. Google Drive backup folder (needed later, for the backup task)
Create a folder such as **"MeLiNS Command Centre – Backups"**, shared only with you and the Accountant. I'll give the service-account steps when the backup job is built (DECISIONS A-015).

## 9. First sign-in on staging (and later production)
Do these once per environment, in this order:
1. **Apply the latest migrations.** In `C:\dev\melins-ims`, run `npx supabase db push` (while linked to staging).
2. **Deploy the Edge Functions.** Run `npx supabase functions deploy invite-user` and `npx supabase functions deploy reset-mfa`. Supabase gives them the service-role key automatically, and nothing is stored in the repo.
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
