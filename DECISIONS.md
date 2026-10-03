# DECISIONS.md: MeLiNS Command Centre

Every decision, assumption and change made during the build goes here. Read this file together with PROJECT_BRIEF.md at the start of every build session.

- **D-** = decided (by the Owner, or settled by the brief itself)
- **A-** = assumption I build on unless the Owner overrides it
- **F-** = finding from the Owner's files that the Owner or Accountant should note
- **Q-** = open question. Once answered, it's moved to Decisions with the answer and the date.

---

## Status

| Item | State |
|---|---|
| Current phase | **Phase A: screens** (2 Oct 2026). Migrations through 1600 are applied to staging (checked 2 Oct 2026, with all three Edge Functions deployed and both reminder schedules active). **1700 (documents) and 1800 (fixes from the Owner's staging test, D-032 to D-036) are waiting to be pushed.** Built: every Phase A route (no placeholders left), Settings with the setup wizard, document uploads, reminders and email sender, and the weekly backup. **Next:** the NSP import (D-030, waiting for the sheet layout), then the Phase A acceptance run on staging and the production deploy. |
| Brief | PROJECT_BRIEF.md = `MeLiNS_Command_Centre_Build_Prompt_v2.txt`, revision 2.4 (28 Sep 2026), copied unchanged |
| Repository | https://github.com/akdadzie/melins-command-centre (private); local folder `C:\dev\melins-ims` |
| Waiting on Owner | Push migrations 1700 and 1800 (`docs/SETUP_INFRA.md` §9), then enter the VAT credit (GHS 9,482.80) and the arrears notes in Settings › Setup, step 4; set up the weekly backup (`docs/BACKUP_RESTORE.md`); work through the setup wizard on staging; add a backup authenticator (`docs/ACCESS_RECOVERY.md`); SMTP/DNS setup, then the email schedule (§10); the NSP sheet layout (D-030); the December bonus layout before November (D-031); statement samples; user email list; leave defaults (A-038) |

---

## Decisions

**D-001 (28 Sep 2026): Brief source.** PROJECT_BRIEF.md didn't exist. It was created by copying `MeLiNS_Command_Centre_Build_Prompt_v2.txt` (rev 2.4) unchanged. The .txt file is kept as the original.

**D-002 (28 Sep 2026): Stack is fixed by the brief.** Netlify single-page app + Supabase (Postgres, Auth, Storage, pg_cron/Edge Functions), in Supabase projects dedicated to MeLiNS. There are two projects: staging and production. All schema changes go in versioned SQL migrations, applied to staging first.

**D-003 (28 Sep 2026): Where conflicting brief sections disagree, Section 12 (scope) wins over the revision-history notes.** Rev 2.3 put leave in Phase B, but rev 2.4 and Section 12 put it in Phase A. **Leave is in Phase A.**

**D-004 (28 Sep 2026): PAYE band amendment (`updated taxes.png`).** The new annual bands take effect 1 Sep 2026: 7,056 nil / 960 @5% / 1,200 @10% / 34,800 @17.5% / 192,000 @25% / 363,984 @30% / above 600,000 @35%. In version 1, payroll is calculated in the spreadsheet (brief §7.5, §12), so the system doesn't use these bands. They're recorded here for the version 2 "PAYE bands as dated tables" work. See F-001.

### Owner's answers, 28 Sep 2026 (Q-01 to Q-22)

#### Infrastructure
**D-005 (Q-01): Repository.** GitHub private repo `https://github.com/akdadzie/melins-command-centre.git`. The local working folder is `C:\dev\melins-ims`, never inside Google Drive. Initialised 28 Sep 2026, default branch `main`.

**D-006 (Q-02): Environments already exist.** The Owner has created both Supabase projects (staging and production) and the Netlify site. The Owner enters secret values directly into the Supabase/Netlify dashboards or into local, git-ignored files, and **never pastes secret keys into chat**. The values needed and where they go are listed in `docs/SETUP_INFRA.md`.

**D-007 (Q-03): DNS and email.** DNS is at Namecheap and email at cPanel, both managed by the Owner. `noreply@themelins.com` is to be created in cPanel and used as Supabase custom SMTP on both projects. SPF/DKIM/DMARC go in Namecheap. Steps are in `docs/SETUP_INFRA.md`. The existing MX, www and mail records must not be changed.

**D-008 (Q-04): Front end.** React + TypeScript + Vite (confirms A-001). The Owner will say if the Scharke IMS differs.

**D-009 (Q-05): Backups and plans.** The weekly backup goes to a restricted Google Drive folder, accessible to the Owner and Accountant only, **never a Git repo**. Production runs on Supabase **Pro** (no pausing, daily backups); staging runs on the **free** plan (can pause when idle).

#### Contradictions resolved
**D-010 (Q-06): Payments to the Owner.** The Owner approves payments made to the Owner. Each such approval is audit-logged and flagged. **Both Directors are notified**, and the **Accountant must review** the payment (it counts as unreviewed for month close until reviewed). **Directors remain strictly read-only**, with no approve permission of any kind.

**D-011 (Q-07): Minimal suppliers and staff loans in Phase A.**
- Suppliers: name, type, TIN, WHT category (plus active flag and notes). Full supplier fields and the subcontractor features stay in Phase B.
- Staff loans: staff member, amount, date, account, purpose, monthly instalment, repayments (salary deduction or cash), balance, status.
- The payroll import check "loan instalments due appear as deductions" and the loan repayments recorded on payroll approval are in Phase A.

**D-012 (Q-08): Referrers now.** The referrers table is created in Phase A, with a simple add-or-select on the job form, so referral sources are recorded from day one. The referrer screens, contact log and BD fees stay in Phase B.

**D-013 (Q-09): Admin logs time.** NSP3 (Admin) logs time, mostly Internal/admin. The **Owner** approves Admin's timesheets and leave, not the Project lead. The Admin role gets `/timesheet` (own entries only).

**D-014 (Q-10): Budget roles.** Budget roles are Managing Director, Senior Engineer, Graduate Engineer, CAD Technician, National service engineer, and Admin.
- The Owner's time rolls up to "Managing Director".
- NSP3's time rolls up to "Admin", which is non-billable by default.
- Each staff record carries its budget role and a billable default.

**D-015 (Q-11): Francis's team** = technical staff only: Ernest Gbadago, Ibrahim Commedan, Nana Poku, NSP1 and NSP2.
- Admin (NSP3) reports to the Owner.
- The team is stored as an explicit `approver` on each staff record, not inferred:
  - Francis approves the technical team.
  - The Owner approves Francis and NSP3.
  - The Owner's own entries are auto-approved.
- The late-entry tiers follow the approver: for anyone whose approver is the Owner, only the Owner can enter their time from day 4.

**D-016 (Q-12): Statutory payments are money out.** The Accountant prepares, the Owner approves, then it's marked Paid. This is the same Prepared → Approved → Paid flow as other money out.

**D-017 (Q-13): Areas the Owner can hide from Directors**, all visible by default:
1. Individual salaries and payslips (payroll lines, payslips).
2. Staff costs and rates (staff cost history, rate build-ups, cost-rate snapshots).
3. Other directors' current accounts (a Director always sees their own).

These are enforced by RLS. Directors currently see every salary.

#### Tax: editable dated settings, confirmed by the Accountant at setup
**D-018 (Q-14): VAT.** MeLiNS is on the standard VAT scheme. Each tax code component has a **stacking basis** setting (`net`, or `net_plus_prior`, meaning net plus the components before it in order), applied in a defined component order.

**D-019 (Q-15): Client WHT and VAT withholding.** Client WHT defaults to the VAT-exclusive amount (the base is a setting). The VAT withheld by a withholding agent is a configurable **VAT-withholding rate on the tax code** (dated).

**D-020 (Q-16): Retention.** The default is the net (VAT-exclusive) amount (the certified amount for valuations). Each job has a retention basis setting: `net` or `gross`.

**D-021 (Q-17): Imported numbering.** Imported invoices and jobs keep their existing numbers, flagged `is_imported`. For each series and year, new numbers continue after the highest imported number, so the counter is bumped on import. Imported numbers don't need to be gapless among themselves.

#### Payroll
**D-022 (Q-18): Two-sheet import.** The NSPs are on a separate sheet, and a run imports **both sheets into one run**, with a column mapping for each sheet in Settings. Staff can also be **added to a run manually** before approval. A manual line carries `source = manual`, and all import checks still apply to it.

**D-023 (Q-19): PF = Tier 3 provident fund.** Evidence from the May 2026 workbook ("Staff " sheet):
- Row 14 has "PF Employee's Contribution" (col K) and "Employer's PF" (col U).
- Taxable income = Gross − SSF employee − PF employee, so PF is tax-relieved, as Tier 3 is.
- The "PAYE DATA 2026" sheet has a "Third Tier" column.
- The rates in cells K12 and U12 are both 0%, so PF is currently nil for everyone.

It is modelled as Tier 3 (employee and employer), with a dated rate setting defaulting to 0%.

**Net check, matching the sheet exactly:**
- Net Pay (col AB) = Gross − SSF employee − PF employee − PAYE + post-tax allowances (Security, House help, Refreshment, T&T/car maintenance, Utilities).
- Bank Amount (col AD) = Net Pay − Loan deductions − other deductions.
- A run fails the check if any line differs by more than GHS 0.01. The sheet subtracts 0.01 in its totals row to absorb rounding, so run totals are compared with a GHS 0.05 tolerance.

**D-024 (Q-20): SSNIT split.** The employee contributes 5.5% and the employer 13%, both on basic, for a total of 18.5%. Of that, Tier 1 (SSNIT) gets 13.5% and Tier 2 (trustee) gets 5%. These are dated settings. This matches the workbook's "Internal SSNIT" sheet.

#### Files
**D-025 (Q-21, Q-22): Outstanding from the Owner.**
- Anonymised GCB and MTN MoMo statement samples → `private/` (only the statement import waits for these).
- Logo and letterhead: **received 28 Sep 2026** (`MeLiNS Logo rev (2).jpg`, `MeLiNS_Letterhead_1.docx`), committed as brand assets.
- User email list: still outstanding (only user invites wait for it).

**D-026:** Assumptions A-001 to A-014 were agreed by the Owner on 28 Sep 2026, as amended by D-005 to D-025.

### Owner's answers, 2 Oct 2026 (Q-23 to Q-26, go-live)

**D-027 (Q-23): Cost to company = gross pay + employer SSNIT (13%) + employer PF (if any).** This is the figure in the payroll sheet's "Total Cost To Company" column (AE, the last-but-one column), e.g. Francis Austin 7,442.50 = gross 6,955.00 + employer SSF 487.50.
- Post-tax allowances are **not** included. This replaces the recommendation in A-027.
- Staff cost history, rates and the monthly running cost all use this figure. The run's checks warn when the sheet's own column differs from it (see F-002).
- Built in migration 1300.

**D-028 (Q-25): The Owner can confirm client payments as the Accountant's backup.**
- The confirmation is recorded with who and when, and is in the audit log.
- The Accountant is notified, and the payment counts as an unreviewed entry: the month can't close until the Accountant marks it Reviewed, or sends it back to Reported with a reason (which takes it out of cash and tells the Owner).
- A payment the Accountant confirms needs no further review (A-021 still holds for them).
- Built in migration 1300.

**D-029: Go-live.** Opening balances are as at **30 Sep 2026**, so **October 2026 is the first month run in the system** and the first month closed in it.
- GCB operating account: closing balance **GHS 83,115.12** on 30 Sep 2026, per the bank statement.
- An account's opening balance is the balance at the start of its opening date. So each account is entered with opening date **1 Oct 2026** and the 30 Sep closing balance (GCB: 83,115.12). Ledger entries count from 1 Oct, so nothing dated 30 Sep or earlier changes the balance, and no September reconciliation is needed.
- The other accounts (MTN MoMo, petty cash, reserve) are entered the same way, with their own 30 Sep balances, in the setup wizard. Opening receivables are the invoices still unpaid at 30 Sep (A-024), and statutory arrears are those outstanding at 30 Sep.

**D-030 (Q-26): The NSP import is built last in Phase A.** The Owner will send the NSP sheet's layout (figures blanked). Until then the NSP sheet uses the staff sheet's column map.

**D-031 (Q-24): December bonus columns stay open.** The Owner will supply the December bonus layout before November. Nothing waits on it in Phase A.

### Owner's staging test, 3 Oct 2026 (D-032 to D-036)

**D-032: Opening VAT credit.** GRA owes MeLiNS **GHS 9,482.80** of VAT overpaid as at 30 Sep 2026.
- **Recording it.** It's entered as a tax credit, in step 4 of the setup wizard ("Statutory arrears and credits") or on the Tax and statutory page.
- **Where it shows.** The Money panel's tax section shows it as owed to MeLiNS until it's used. It is not counted as cash.
- **Automatic offset.** A credit set to offset VAT returns is applied automatically to each VAT line for a period after its date, oldest credit first. It never covers more than a line still owes after cash paid. If a return's figure changes, the offsets on that line and every later VAT line are worked out again, so freed credit flows on to the next return.
- **Other GRA liabilities.** A credit can also be set against another liability payable to GRA, such as PAYE arrears, by the Owner or the Accountant, once GRA has approved the offset. GRA's reference is required. The offset is audited, and the Owner is told when the Accountant records one; the Owner can undo it.
- **In the ledger.** Credit applied counts towards a statutory line like a payment ("Credit" column), but no cash moves. A line covered by credit isn't chased by reminders.
- Built in migration 1800.

**D-033: Reconciliation from each account's opening month.** An account is only asked for a month's reconciliation if it was open by the end of that month. The Money panel, the Accountant's home and the month-close blockers now all apply this. Accounts opened on 1 Oct 2026 are first reconciled for October.

**D-034: Nothing before go-live counts.** Missing timesheet days, timesheet compliance, utilisation (its first column is the go-live month), and timesheet reminders all start at the go-live date.
- The date is now held in the database (`app.system_config`, 1 Oct 2026) rather than written into the code, and the screens use the same date.
- The automated tests run with an earlier go-live, because they use dates around "today".

**D-035: Weeks of cover with no running cost.** While the monthly running cost is 0 (no payroll run or recurring expenses yet), the tile says "Not yet" with the hint "Add a payroll run or recurring expenses to calculate", and links to Payroll.

**D-036: Notes on opening arrears.** Each opening arrears line has a note (e.g. SSNIT Tier 2 GHS 45,000: "estimate, awaiting trustee statement"). It's shown next to the figure in the setup wizard, on the Tax and statutory page and in the Money panel's arrears.

---

## Assumptions

**A-001: Front-end stack.** React + TypeScript + Vite, React Router (one route per view), TanStack Query, and supabase-js. It's an installable PWA. Timesheet and expense saves are queued in IndexedDB and retried automatically when the connection returns. *(Confirmed by D-008.)*

**A-002: A single `ledger_entries` table is the source of every account balance.** Receipts, expenses, payments out, transfers, payroll net pay, director entries and statutory payments post to it through database triggers. Balances, the Money panel and reconciliations all read from it, so the RLS that protects balances is enforced in one place.

**A-003: Admin never reads base finance tables directly.** Admin reads through column-restricted views or security-definer functions, for example an account picker that returns id and name only, and invoice outstanding per invoice with no totals. RLS on the base tables denies Admin by default.

**A-004: Director read-only is enforced in the database.** Every write policy excludes `role = 'director'`. Hidden areas (D-017) are also enforced by RLS, using a settings table of area toggles.

**A-005: 2FA uses Supabase TOTP** (an authenticator app, no SMS). For Owner, Director and Accountant, RLS also requires `aal2` in the JWT, so their session gets no data until the second factor is verified.

**A-006: Phase B and C routes exist in Phase A as permission-guarded "Coming in Phase B/C" pages.**

**A-007: Version 2 hooks built in now.** Every money record carries `currency` (default GHS), `fx_rate` (default 1) and `company_id` (default MeLiNS).

**A-008: Numbering.** Gapless per-series counters live in a locked `number_sequences` table and are allocated inside the approve/issue transaction. Counters reset each **calendar** year: INV-2026-001, CN-2026-001, MEL-2026-001. Assets: MEL-AST-001 (one series, no reset). Drafts get a temporary reference such as `DRAFT-7f3a`. See D-021 for imported numbers.

**A-009: Invoices are sent outside the system.** Admin downloads the PDF, emails or WhatsApps it to the client, and then marks it Sent.

**A-010: Phase B/C items on Phase A home screens show "—" or zero** until their phase ships. "Reserved provisions" = 0 and the prepayment share of running cost = 0 until Phase C.

**A-011: Review scope.** Every money entry made by anyone other than the Accountant needs Accountant review before month close. The Accountant's own entries are treated as reviewed. (D-010 adds payments to the Owner explicitly.)

**A-012: Payroll net pay posts as money out when the run is marked paid** (date paid + account), not at the moment of approval. Statutory lines are created at approval.

**A-013: Timesheet hours.** Entries are in 0.25-hour steps, with a maximum of 16 hours per day. Weekend entries are allowed (site work). A weekend day's window counts from the next working day. All times are Africa/Accra.

**A-014: Directors' monthly summary page (`/reports/monthly`) is in Phase A.**

**A-015: Weekly backup runner.** A scheduled GitHub Actions workflow (only the runner; nothing is committed) runs `pg_dump` plus one CSV per table against production, and uploads to the restricted Google Drive folder (D-009). *Amended by A-046 (2 Oct 2026):* it uploads with rclone and a Drive sign-in token instead of a Google service account, because a service account can't store files in a personal Drive folder (only in a Workspace Shared Drive).

**A-016: Sensitive files never go in git.** `*.xlsx`, `*.xls`, `*.csv` at the repo root, and everything under `private/` are git-ignored. The payroll workbook stays local. Statement samples go in `private/`.

### Data model assumptions (29 Sep 2026)
These came up while building the schema. Each is easy to change if the Owner or Accountant prefers otherwise.

**A-017: Rates.** Cost rate = monthly cost × (1 + overhead share) ÷ billable hours per month. Charge-out rate = cost rate × (1 + target margin). The cost rate therefore includes the overhead share, so job margins are after overheads. Both are frozen on each timesheet entry when it's approved.

**A-018: Seeded staff.** Start dates are set to 1 Sep 2026 (the cost-history date). The Owner corrects them in the setup wizard, because they drive payroll checks, utilisation and leave pro-rating. Emails are filled in when users are invited.

**A-019: What Admin sees.** Admin sees amounts on individual invoices (net, gross, outstanding) and on individual supplier bills, because it needs them to draft and chase. Admin never gets a balance or total:
- No view or function returns totals to Admin.
- The API's aggregate functions stay off (the Supabase default). **They must not be switched on.**

**A-020: Reported vs confirmed payments.**
- An invoice's Part-paid / Paid status and its outstanding amount count both Reported and Confirmed payments, so Admin doesn't chase money a client has already paid.
- Only Confirmed payments count as cash, in weeks of cover and in "received this month" (brief §7.4).
- A Rejected payment drops out of everything.
- An allocation can't exceed the payment or what the invoice still has due.

**A-021: Confirming a client payment is its review.** Receipts go Reported → Confirmed by the Accountant. They don't also go through Recorded → Reviewed.

**A-022: Holidays and leave in timesheets.**
- Public holidays are non-working days in the calendar, not rows of timesheet entries. They don't count toward the entry window, reminders, compliance or utilisation targets.
- Approved leave creates Leave entries at 0 hours. Cancelling the leave before it starts removes them.
- A weekend day's window counts from the next working day (A-013).

**A-023: Retention.**
- Retention is calculated on fee, milestone and "other" lines only, not on rechargeable expenses or retention releases.
- A retention-release line carries no tax, because the tax was charged on the original invoice.
- A release can't exceed the retention the job still holds.
- Each invoice keeps a snapshot of the job's retention % and basis, so later changes to the job don't alter issued invoices.

**A-024: Imported opening receivables.**
- They keep their number and status (D-021) and may be imported with totals only, without lines.
- They're excluded from the VAT workings and from "fees invoiced this month", because that output VAT was declared before the system existed.

**A-025: Expenses and supplier bills.**
- An expense is entered at the amount paid, VAT included. With a tax code, the net and each tax component are split out.
- Input VAT is claimable only for recoverable components, and only with a valid VAT invoice.
- A supplier bill is an expense with payment source "supplier payable", settled through Payments out.
- A payment can't exceed what's still owed on its bills. WHT is taken at the supplier category's rate in force.

**A-026: How Directors are stopped.**
- A Director's API edit or delete changes zero rows, because RLS hides rows from writes.
- A Director's insert, or any Director write that reaches a table, fails with "Directors have read-only access". A trigger on every table enforces this, even if a policy is written wrongly later.
- Either way nothing changes (acceptance 22), and the UI hides action buttons.

**A-027: Payroll detail.**
- Tier 1 and Tier 2 split the SSNIT actually contributed (employee plus employer) in the ratio 13.5 : 5, so national service persons (no SSNIT) have nil tiers.
- Bonus PAYE is imported as its own column. The net check subtracts it.
- The sheet's 0.01 rounding is absorbed by the line tolerance (0.01) and the total tolerance (0.05), both in Settings.
- Cost updates proposed from a run use the cost to company as defined in D-027 (gross + employer SSNIT + employer PF; this replaced the Q-23 recommendation, which also added post-tax allowances). The Owner confirms them before they're added to the cost history.

**A-028: One approval flow for all money out.** It covers supplier payments, staff reimbursements, staff loans, payments to directors and statutory payments.
- After approval, only the payment details (date, account, method, reference) can change.
- "Send back to Prepared" withdraws the approval.
- Once Paid, a payment is locked apart from its review fields and attachments.
- Cash leaves the ledger only when the payment is marked Paid.

**A-029: Views run with owner rights.** Views don't use `security_invoker`; each checks the role itself. That's how they hide columns (for example `account_picker`, `my_jobs`, `leave_calendar`, `receipt_tasks`). The Supabase linter will flag these as "security definer views". That's expected.

**A-030: What blocks month close.**
- Money entries that are unreviewed or queried.
- Reported payments not yet confirmed.
- Recurring drafts not yet confirmed.
- Unmatched statement lines.
- Accounts not reconciled.
- Payments approved but not yet paid.

The Accountant (or the Owner) closes the month. Only the Owner reopens it, with a logged reason.

### Front end (29 Sep 2026)

**A-031: One definition per table drives the screen.** Each table has a definition in `src/resources/definitions.ts` covering its fields, who can create, edit and import, and any import defaults. That single definition generates:
- the form
- the list
- the CSV template, import and export

Forms and CSV import share one parser (`coerce.ts`), so any row that imports is exactly a row the form would accept. A unit test checks every field against the generated database types and every dropdown value against the migrations. Screens with lines, allocations or approvals (invoices, receipts, payments out, payroll, timesheets) get their own screens next.

**A-032: CSV rules.**
- Dates are day-first: DD/MM/YYYY, YYYY-MM-DD or 28 Sep 2026. US month-first dates are rejected, never guessed.
- Money may carry "GHS" and thousands separators, and "(250.00)" means minus 250.
- Linked records (client, job, account…) are matched by their exact name, ignoring case. A job also matches on its number alone. No match, or more than one, is an error on that line.
- Every row is checked before anything is saved. Valid rows are then saved one at a time, so a row the database rejects is reported with its line number while the rest still import.
- Exports write names rather than ids, so an export can be edited and re-imported.
- Imports use the importing person's own permissions (RLS), exactly like the forms.

**A-033: How users are created.**
- The Owner invites people from Settings > Users. The `invite-user` Edge Function checks that the caller is the Owner at `aal2`, then invites through the Auth admin API with the role and the staff or director link.
- A database trigger creates the profile from that invite. An invite without a role creates no profile ("No access yet").
- The first Owner is created once per environment with `select app.bootstrap_owner('<email>')` in the Supabase SQL editor. It refuses if an Owner already exists.

**A-034: Stack details.** React Router 7 and TanStack Query, with plain CSS in MeLiNS red. Mobile-first: forms and dialogs go full-screen on phones. If a build has no Supabase settings, the app shows a clear "not configured" screen instead of failing silently.

**A-035: How the timesheet works offline.**
- Entries are queued in the browser's local storage (not IndexedDB, as A-001 had planned): it's simpler and holds well over a week of entries.
- Each entry carries an ID made on the phone, so a retry never duplicates it. Retries happen when the connection returns, when the app comes back to the foreground, and every 30 seconds.
- An entry the database refuses (for example, the window has closed) is kept with the reason and not retried. The person can try again or discard it.
- If a retry is refused but the entry is already on the server (the first save's reply was lost), it counts as saved.

**A-036: Printed documents.** Invoices and payslips are printed from the browser ("Print / Save as PDF") on the letterhead, with a draft invoice watermarked "not a tax invoice". PDFs stored by an Edge Function, and the payslip-ready email, come with the reminders step.

**A-037: Two-factor recovery** (docs/ACCESS_RECOVERY.md).
- People add a backup authenticator on My profile.
- The Owner resets anyone else's from Settings > Users. That needs a reason, signs the person out everywhere, and is recorded in the audit log.
- The Owner's own reset is `app.reset_mfa()` in the Supabase SQL editor, also audit-logged. The Supabase dashboard account (with its recovery codes stored offline) is the last line of recovery.

### Screens, 2 Oct 2026

**A-038: Leave screens.**
- **Leave year.** The screens treat the leave year as the calendar year (the Settings default). If the Owner changes the leave year's start month, the database's balances stay right, but the screens' default year needs a small change.
- **Setting up a year** (Owner, `/leave/balances`):
  - Everyone gets each leave type's default days, pro-rated by the days they're employed in the year and rounded to the nearest half day.
  - Unused annual leave carries over up to the Settings limit. If no limit is set, nothing carries over.
  - It never changes an existing entitlement, so it can be re-run for new joiners. Individual figures (e.g. national service postings) are edited on the Entitlements tab.
  - Default days are blank until the Owner sets them (brief §7.3: at or above the statutory minimum, confirmed with the Accountant). For October 2026, set up 2026 and adjust each person's days to what's left of their year.
- **Overdrawn annual leave.** The Owner can approve it. The Project lead can only approve it as Unpaid leave, which changes the type and records why in the decision note.
- **Supporting documents.** A request whose type needs one is flagged to the approver. Uploading it comes with document storage, like other attachments.

**A-039: Statements and reconciliation.**
- **Reading statements.** Until the GCB and MTN MoMo samples arrive (D-025), the Accountant uploads any CSV export whose heading row has a date and either an amount or debit and credit columns. Account details above the headings are skipped, as are opening, closing and total rows. Dates are day-first only. The bank-specific readers replace this once the samples arrive.
- **Checking a statement.** On upload, the screen checks that opening balance + lines = closing balance and warns if not. Lines outside the chosen period are left out.
- **Matching.** A statement line is matched to a movement in the books (a confirmed receipt, an expense, a payment…). The screen suggests movements with the same amount within 7 days that aren't already matched. A line that isn't in the books is either explained, or (for money in) handed to Admin as a "Record this receipt" task, or recorded at once by the Accountant.
- **Reconciling.** The month's reconciliation compares the statement's closing balance with the calculated balance at month end. It can't close while any statement line up to that date is unmatched, or while a difference is unexplained (acceptance 13). Movements in the books but not on the statement are listed for the Accountant to follow up.

**A-040: Month-close screen (`/close/:month`).**
- It lists everything blocking the close, grouped and linked to each record, and both checklists (brief §9). The Accountant (or the Owner) closes once nothing blocks it. Only the Owner reopens, with a reason, which the Accountant is told. The Owner marks the close reviewed.
- **Review queue.** Every money entry waiting for review is listed with what it is, the amount and who entered it, with Mark reviewed / Query buttons for the Accountant. This is how Admin's expenses, transfers, loan repayments and director entries get reviewed; until now those lists had no review buttons.
- **Admin's view** of the blockers is limited to Admin's own part: queried entries, reported payments and recurring drafts. Statement lines and reconciliations are the Accountant's (Admin never handles statements).
- **Go-live.** The screen starts at October 2026 (D-029); earlier months aren't closed in the system.

**A-041: Home screens (brief §6).**
- **Owner:** the Money panel, then Pipeline, then Delivery, with "+ Payment received" at the top (it opens the quick-log directly). Invoices and payments out awaiting approval sit in the Money panel.
- **Directors:** the same panels with no approval tiles, plus a link to the monthly summary.
- **Accountant:** entries to review (opening the month-close review queue), payments to confirm (including Owner-confirmed ones to review, D-028), accounts not reconciled for last month, and the close status, then the Money panel.
- **Admin:** a task list with no balances or totals, built from its open tasks plus invoices due a chase reminder today (7 days before due, due date, 14/30/60 days overdue), items ready to invoice and overdue WHT certificates.
- **Project lead:** expense claims to approve, milestones due within 14 days, the team's timesheet compliance this month, and the Delivery panel limited to the team's approvals.
- **Staff:** hours this week (with a weekly guide of monthly target ÷ 4.33), annual leave left, latest payslip, upcoming leave and open expense claims.
- **Delivery panel (basic, Phase A):** jobs past due or over an hours budget, utilisation for this month and the last 3, who is away this week and next, entries and leave awaiting approval, and days not logged last week.
- Pipeline, trips, tasks, valuations, commitments and overheads show a "Phase B/C" note (A-010).
- `/reports/monthly` shows the month's fees, costs, cash and tax, and whether it's closed. `/notifications` lists the user's notifications; the bell shows the unread count.

**A-042: Reminders and emails (brief §9).**
- **Two routines run in the database** (pg_cron; Accra is UTC+0): every day at 06:00, and at 17:00 on working days. Each reminder is sent once (it has a key), so a routine can be re-run safely. Each one links to its record.
- **Daily at 06:00:**
  - **Statutory:** to the Accountant and the Owner 7 days before, on the due date, and the day after.
  - **Invoices:** chase reminders to Admin 7 days before due, on the due date, and 14, 30 and 60 days overdue, each with a polite reminder ready to send.
  - **Reported payments:** to Admin daily while details are missing; to the Owner if still unconfirmed after 14 days. Client money a director has held over 7 days goes to the Owner.
  - **Milestones:** to the Project lead when one is past target and not marked; to Admin and the Owner when one is reached and not invoiced within 5 working days. Retention is flagged 30 days before release.
  - **Admin's records:** recurring drafts created on their due dates, and drafts unconfirmed after 5 days. WHT certificates not received by their expected date.
  - **Leave:** the approver after 2 working days; in October, staff with unused annual leave above the carry-over limit.
  - **Payroll:** the Accountant on the 15th and 20th if the month's run isn't imported; the Owner when an imported run is waiting; Admin on the 15th to check loan deductions.
  - **Timesheets:** day 3, a final warning to the person; day 4, their approver (the Owner, for Francis and Admin); day 11, the Owner. On Mondays, approvers hear of entries waiting.
- **At 17:00:** anyone with no time logged today. Approved leave fills the day, and public holidays aren't working days, so neither is reminded.
- **Go-live:** nothing dated before 1 Oct 2026 is chased (D-029).
- **Email:** in-app first. Approvals, overdue items, reminders and "payslip ready" are also emailed by the `send-emails` function every 10 minutes, from noreply@themelins.com through cPanel on port 465 (setup: docs/SETUP_INFRA.md §10). It can't be tested until SMTP is set up.
- **Phase B and C reminders** (advances, BD fees, trips, leads and referrers, compliance documents and bonds, assets, commitments, overheads) come with those phases.

### Remaining Phase A screens, 2 Oct 2026

**A-043: Invoice work lists and payments to directors.**
- **Ready to invoice** groups items by job. Ticking items drafts one invoice per job, with milestone and rechargeable lines and a chosen tax code (Standard by default). The Owner then approves it as usual.
- **Retention** lists what each client holds and its release date (highlighted within 30 days). "Draft release invoice" creates a retention-release line for the amount held, with no tax.
- **Adjustments** lists credit notes, disputed invoices and write-offs. Each is still raised from its invoice.
- Admin sees per-item amounts on these lists but never totals (A-019).
- **Payments to directors had no screen.** It's now on each director's page and at `/directors/payments`, where approval notifications already pointed. The Owner or Accountant prepares a payment, the Owner approves it, and then it's paid. Tax on fees and dividends is taken at the Settings rate (acceptance 24). A dividend needs its board resolution attached before approval.

**A-044: Settings and the setup wizard.**
- **Dated settings.** Settings are saved with an effective date. If a version already starts on that date it's updated; otherwise a new version is added, copied from the one in force then. Earlier records keep their values. The wizard saves from go-live (1 Oct 2026); the general form defaults to today.
- **The wizard** follows brief §10's order. Each step shows done or not done, and the Owner's home shows progress until all are done:
  1. Company and tax details.
  2. Accounts and opening balances (D-029).
  3. Tax codes. The Accountant confirms each version.
  4. Opening statutory arrears by type.
  5. WHT rates. Per diem rates come with trips in Phase B.
  6. Bonus rule and leave settings.
  7. Users.
- **Nothing is guessed.** Tax rates start blank: the wizard offers NHIL, GETFund and VAT as names, with empty rates.
- **Statutory calendar.** The Owner or the Accountant edits each obligation's payee and due rule.

**A-045: Documents.**
- **Storage.** One private Storage bucket, `documents`. A file is stored at `<table>/<record id>/<time>-<name>`, and **anyone who can read the record can open the file**. The record's own RLS decides, so:
  - leave documents are seen only by the person, their approver and finance;
  - statements are seen only by finance.
- **Limits.** Directors can't upload. Only the uploader or the Owner can delete. Files are limited to 10 MB (PDF, images, CSV), and are opened through 2-minute signed links.
- **Where attachments appear:** expenses (receipt), receipts (cheque, deposit slip or remittance advice), every money-out payment, director entries and payments (board resolutions for dividends), transfers, WHT certificates, contracts, leave requests, and statement uploads (the original CSV).
- **Not attached here:** payroll source sheets are read in the browser and not kept, and payslips are printed from the app.

**A-046: Weekly backup (replaces the details of A-015).**
- **What it holds.** Every Sunday 02:00, GitHub Actions exports production through the Session pooler and builds one archive, encrypted with a passphrase the Owner keeps offline. Inside:
  - a data-only dump (`data.sql`);
  - the logins (`auth.sql`: users, identities and authenticators, so a restore keeps everyone's access);
  - a full dump for reading (`melins.sql`);
  - a CSV per table;
  - a manifest of row counts.
- **Where it goes.** rclone uploads it to the Drive folder, and copies new Storage documents across (copy, never sync, so nothing is deleted; records are kept 6+ years).
- **Restoring.** `scripts/backup/restore.sh` loads a backup into a project built from the migrations, with triggers off, so balances, numbers and the audit log come back exactly. It then checks every table's count against the manifest.
- **Tested locally on 2 Oct 2026:** backup, decrypt, restore into a fresh database, all 68 tables matched, and balances, receivables and logins were identical. It hasn't yet run on GitHub or Supabase. Set-up and restore steps are in docs/BACKUP_RESTORE.md.

**A-047: No blank screens; changes on a branch while the Owner tests (3 Oct 2026).**
- **The blank screen reported on 3 Oct.** A test now walks the reported steps through the real screens: create a job, enter its fee, open it, change the fee. It passes, so the job screens weren't the cause. The likely cause was an unfinished edit of mine: for about a minute, `VatWorkingsPage.tsx` declared the same name twice. The page's code then couldn't load, and since every screen is loaded with the app, the whole app went blank, whichever screen was open.
- **Error boundaries.** Each screen sits inside an error boundary in the layout. If a screen crashes, the person sees "Something went wrong" with Reload and "Go to your home screen", and short details to pass on; the menu keeps working, and moving to another page clears it. A second boundary wraps the whole app.
- **Fallback when the app can't load.** If the app's code doesn't load at all, React never starts, so no boundary can help. A small script in `index.html` then shows the same message with a Reload button: when a script fails to load, or if the page is still empty after 15 seconds.
- **Working while the Owner tests.** Changes are made on a separate branch in its own worktree (`C:\dev\melins-ims-work`, with its own `node_modules`). Nothing changes under `C:\dev\melins-ims` until the Owner merges.
- **Screen tests.** `src/test/harness.tsx` renders real screens against an in-memory stand-in for Supabase, so whole flows can be tested in `npm test`.

---

## Findings from the payroll workbook (28 Sep 2026)

**F-001: The workbook still uses the old PAYE bands.**
- Row 13 of the "Staff " sheet has monthly bands of 490 nil / 110 @5% / 130 @10% / 3,167 @17.5% / 16,000 @25%. That is the old annual 5,880 / 1,320 / 1,560 / 38,000 / 192,000.
- The formulas stop at 25%, so there are no 30% or 35% bands.
- From the **September 2026** run, the new bands in D-004 apply (monthly: 588 nil / 80 @5% / 100 @10% / 2,900 @17.5% / 16,000 @25% / 30,332 @30% / above 50,000 @35%).
- The system imports PAYE and doesn't recalculate it (version 1), so it can't catch this. **The Accountant must update the sheet.**

**F-002: The sheet's "Total Cost To Company" formula is Gross + Employer SSF** (`=T + I`). The Owner defines cost to company as gross + employer SSNIT + employer PF (D-027), so the system's figure and the sheet's agree while the PF rate is 0%. **If employer PF ever starts, the Accountant should change column AE to `=I + T + U`.** Until then, the payroll checks warn on any line where the two differ.

**F-003: The workbook contains hidden sheets for another organisation's employees** (JAN 16, DEC 15, and five named sheets from a microfinance company's 2015/16 payroll). The import reads only the two mapped sheets. The Owner may want to delete those sheets.

**F-004: Rounding in the CSV export.** PAYE and Net Pay are held in Excel to more than 2 decimal places, and a CSV export writes the displayed 2-decimal values.
- On the May sheet, Kwasi's line is out by exactly GHS 0.01 after rounding. The 0.01 line tolerance (D-023) accepts it, so the run passes.
- If rounding ever makes a line differ by 0.02, the check will block it. Either wrap those formulas in `ROUND(…, 2)` in the sheet (recommended), or raise the line tolerance in Settings.

---

## Open questions

**Q-24 (non-blocking): December bonus columns.** The May workbook has no bonus columns. The Owner will supply the December bonus layout before November (D-031). The schema already has the bonus and bonus PAYE fields.

**Q-26 (blocks the NSP import only): The national service sheet's layout.** The Owner will send it with the figures blanked. The NSP import is built last in Phase A (D-030).

*Answered 2 Oct 2026: Q-23 → D-027, Q-25 → D-028.*
