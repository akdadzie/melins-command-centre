# Production go-live checklist

The plan (DECISIONS D-051):
- **Soft launch, 12–14 Oct 2026:** timesheets and leave only, for Kwasi, Francis, Ernest, Ibrahim and Nana Poku.
- **The Owner travels 16 Oct – 6 Nov.** Francis approves his team's timesheets and leave meanwhile.
- **Full go-live, 1 Nov 2026,** when NSP1–3 start. NSP3 back-enters October's money records in the first week of November.
- **First month close:** October and November together, early December.

Tick each step as you go. Each section says roughly how long it takes. **Never paste a password, key or connection string into chat or into any file in the repository.** Type them only where a step says.

**You need to hand:**
- the production Supabase project's database password;
- the five people's **email addresses** and **actual start dates**;
- your Annual leave days per year, the Sick / Compassionate / Study-exam caps, and the most annual leave that may carry over;
- access to cPanel, Namecheap, Netlify and GitHub.

---

## Before 12 Oct (aim to finish by Friday 9 Oct)

### 1. Code (5 min)
- [ ] In `C:\dev\melins-ims`, merge the latest branch: `git merge go-live-plan`. It includes everything up to now, including the leave fixes and migration 2200 (go-live dates).
- [ ] Push it: `git push origin main`.
- [ ] Apply the new migrations to **staging** first: `npx supabase db push`. Your folder is linked to staging. Check the app on staging still works.
- [ ] **From 12 Oct, `main` is production.** Pushing to `main` updates the app everyone uses. Test changes on staging first (D-053). I'll keep working on branches, and you merge them when you've tried them.

### 2. Supabase production project: settings (15 min)
In the Supabase dashboard, open the **production** project:
- [ ] **Plan:** Pro (D-009). Settings → Billing.
- [ ] **Authentication → Sign In / Providers:** Email on; **"Allow new users to sign up" off**.
- [ ] **Authentication → Multi-Factor:** TOTP (authenticator app) on.
- [ ] **Authentication → URL Configuration:** Site URL `https://app.themelins.com`; Redirect URLs `https://app.themelins.com/**`.
- [ ] **Database → Extensions:** enable **pg_cron** and **pg_net**.

### 3. Production database: apply the migrations (15 min)
In `C:\dev\melins-ims`:
```
npx supabase link --project-ref <production-ref>     # type the production database password at the prompt
npx supabase db push                                 # applies every migration, 0100 to 2200
npx supabase migration list                          # every migration should show in both columns
npx supabase functions deploy invite-user
npx supabase functions deploy reset-mfa
npx supabase functions deploy send-emails
npx supabase link --project-ref cipklttzbvbsivzrkcvq # link back to STAGING straight away
```
- [ ] **Link back to staging** (the last line). While the folder is linked to production, every `db push` goes to production.
- [ ] **Check that production holds no test data.** Supabase (production) → **SQL Editor**, run:
  ```sql
  select (select count(*) from public.clients) clients, (select count(*) from public.jobs) jobs,
         (select count(*) from public.invoices) invoices, (select count(*) from public.accounts) accounts,
         (select count(*) from public.timesheet_entries) timesheets, (select count(*) from public.profiles) users,
         (select count(*) from public.staff) staff, (select go_live_date from app.system_config) timesheets_start;
  ```
  You should see 0 for everything except **staff = 8** and **timesheets_start = 2026-10-12**. That's what I got on a fresh database built from the migrations on 3 Oct.
- [ ] **Database → Cron** (Integrations → Cron) should list `melins-daily-reminders` and `melins-timesheet-nudge`.

### 4. Email: noreply@themelins.com (30–60 min, mostly waiting for DNS)
Skip any step already done for staging. The mailbox and DNS records are shared.
- [ ] **cPanel → Email Accounts → Create** `noreply@themelins.com`, with a long password kept in your password manager. Note the **Outgoing Server** hostname from "Connect Devices" (SETUP_INFRA §4).
- [ ] **Namecheap → Advanced DNS** (or cPanel Zone Editor, if DNS is served by cPanel): add SPF, DKIM and DMARC, using the exact values from **cPanel → Email Deliverability** (SETUP_INFRA §5). There must be only **one** SPF record; edit the existing one if there is one. Don't touch the MX, `www`, `mail` or `@` records.
- [ ] Wait until cPanel Email Deliverability shows SPF and DKIM as **Valid**.
- [ ] **Supabase (production) → Authentication → Emails → SMTP Settings:**
  - sender `noreply@themelins.com`, name `MeLiNS Command Centre`;
  - the host from above, port **465**, username `noreply@themelins.com`, the mailbox password;
  - minimum interval 5 s.

  Then **Rate Limits:** emails per hour 100.
- [ ] **Notification emails:** follow SETUP_INFRA §10 against **production**.
  - Settings file: `APP_URL=https://app.themelins.com`, `APP_ENV=production`.
  - Secrets: `npx supabase secrets set --env-file .env.mailer --project-ref <production-ref>`, then delete the file.
  - Then the SQL in §10 step 3, using the production project ref.

### 5. Netlify and app.themelins.com (20 min + DNS)
- [ ] **Netlify → Site configuration → Environment variables:** in the **Production** context, set `VITE_SUPABASE_URL` (production URL), `VITE_SUPABASE_ANON_KEY` (production anon / publishable key) and `VITE_APP_ENV=production`. **Branch deploys** keep the staging values.
- [ ] **Netlify → Build & deploy:** production branch `main`. Branch deploys: `staging` (SETUP_INFRA §7).
- [ ] **Netlify → Domain management → Add a domain:** `app.themelins.com`.
- [ ] **Namecheap → Advanced DNS → Add new record:** CNAME, Host `app`, Value `<your-site>.netlify.app`, TTL Automatic. If DNS is served by cPanel, add it in Zone Editor instead.
- [ ] **Netlify → HTTPS → Verify DNS configuration → Provision certificate.** Then open https://app.themelins.com. There must be **no** orange "STAGING" banner. Also check that www.themelins.com and company email still work.
- [ ] **Trigger a deploy** (Deploys → Trigger deploy), so the production build picks up the production variables.

### 6. Your Owner account on production (10 min)
- [ ] **Supabase (production) → Authentication → Users → Invite user:** your email.
- [ ] **SQL Editor:** `select app.bootstrap_owner('<your email>');`
- [ ] Open the invite email: it should come from noreply@themelins.com. Set a password. At https://app.themelins.com, set up your authenticator app.
- [ ] **My profile:** add a **backup authenticator** (ACCESS_RECOVERY.md). You'll be abroad for three weeks.

### 7. Production setup: staff, settings, opening balances (45 min)
Only real data from here on. In the app (https://app.themelins.com), **Settings**:
- [ ] **Staff** (People › Staff and cost history): set each person's **actual start date**. The seeded 1 Sep 2026 is a placeholder (A-018). If it isn't corrected, their 2026 annual leave is pro-rated as if they'd joined in September. Leave NSP1–3 at 1 Nov.
- [ ] Check the staff costs (seeded from brief §11), job titles and approvers: Francis approves Ernest, Ibrahim, Nana and NSP1–2; you approve Francis and NSP3.
- [ ] **Reference data › Leave types:**
  - Annual: days per year.
  - Sick, Compassionate/bereavement, Study/exam: their yearly caps.
  - Maternity (60) and Paternity (5) per event are already set (D-046).
- [ ] **Company and rules:**
  - **Timesheets and leave:** the carry-over limit.
  - **Company and tax details** and **How clients pay** are already filled in with the details you gave me: the bank, the phone, the MoMo account name and note (D-039, D-041, D-050).
  - Still to fill in: the TIN, VAT number, address and the MoMo number. They're needed for invoices, so by 1 Nov.
- [ ] **Reference data › Public holidays:** add the Ghana public holidays from 12 Oct to the end of 2026, and 2027 if known, from the official list. Check each date, including whether a holiday falling on a weekend is moved to the Monday. They extend the timesheet window and aren't leave days.
- [ ] **Leave › Leave balances › Set up a leave year: 2026.** Then on the Entitlements tab, adjust each person's annual days to what they actually have left for 2026 (A-038).
- [ ] **Opening balances** (Setup steps 2 and 4; by 1 Nov at the latest):
  - the **Prudential Bank operating account**: closing balance **GHS 83,115.12** on 30 Sep, opening date **1 Oct 2026**, last 4 digits 0010 (D-029);
  - MTN MoMo and petty cash, on the same basis;
  - the opening statutory arrears by type, with notes (D-036);
  - the **VAT credit**, GHS 9,482.80, as at 30 Sep (D-032).

### 8. Invite the four users (10 min)
**Settings › Users › Invite**, each linked to their staff record:

| Person | Role | Staff record |
|---|---|---|
| Francis Austin | Project lead | Francis Austin |
| Ernest Gbadago | Staff | Ernest Gbadago |
| Ibrahim Commedan | Staff | Ibrahim Commedan |
| Nana Poku | Staff | Nana Poku |

- [ ] Each person gets an invite email from noreply@themelins.com and sets a password. 2FA is optional for them.
- [ ] Ask each to **add the app to their phone's home screen**: Share › Add to Home Screen on iPhone; ⋮ › Install app or Add to Home screen on Android.

### 9. Backups (15 min, if not done yet)
- [ ] GitHub secrets (BACKUP_RESTORE.md): `BACKUP_DB_URL` must be the **production** Session pooler URI. Run **Actions → Weekly backup → Run workflow** once and check the archive arrives in the Drive folder.

---

## Monday 12 Oct: soft launch
- [ ] Morning: each of the five signs in at https://app.themelins.com on their phone and logs one entry. Check "Today: X h logged" updates and the entry appears on **Team**.
- [ ] Francis approves an entry under **Timesheet approvals**. Someone requests a day of leave, and Francis approves it on **Leave**.
- [ ] At 17:00, anyone who hasn't logged time gets the in-app reminder, and the email if §4 is done.
- [ ] 13–14 Oct: watch **Team** for missing days, and fix anything before you travel.

## While you're away (16 Oct – 6 Nov)
- **Francis approves** Ernest's, Ibrahim's and Nana's timesheets and leave, including late entries up to their 10th working day.
- **Your own approvals stay with you.** These are Francis's own timesheets and leave, anything past day 10, and any leave over a balance or yearly cap. Approve them from your phone, or they wait until you're back. Waiting does no harm: approval only freezes the rates on the entries. Your own time is approved automatically. (D-052)
- Emails for anything waiting on you go to your inbox, as long as §4's email set-up is done.

## Full go-live: 1 Nov 2026
- [ ] Before 1 Nov:
  - NSP1–3's names and emails on their staff records; invite them (NSP3 as Admin, linked to "NSP3 - Admin").
  - Invite the Accountant, and the Directors if you want them on now; they need 2FA.
  - The Accountant enters and confirms the tax codes (Setup step 3) and the WHT rates (step 5).
  - Check the MoMo number, TIN, VAT number and address are in.
- [ ] **First week of November:** NSP3 back-enters October's money records: receipts, expenses, payments out and transfers, dated in October.
- [ ] **November payroll:** the Accountant imports it as usual (the NSP sheet's layout is still awaited, D-030).

## Early December: first month close
- [ ] The Accountant uploads the **October** Prudential Bank and MoMo statements, reconciles, reviews and closes **October** (`/close/2026-10`). Then does the same for **November**. October must close first.
- [ ] You review both closes on the monthly summary.
