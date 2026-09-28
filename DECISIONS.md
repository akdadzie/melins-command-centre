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
| Current phase | **Phase A: data model.** Plan confirmed by the Owner, 28 Sep 2026. |
| Brief | PROJECT_BRIEF.md = `MeLiNS_Command_Centre_Build_Prompt_v2.txt`, revision 2.4 (28 Sep 2026), copied unchanged |
| Repository | https://github.com/akdadzie/melins-command-centre (private); local folder `C:\dev\melins-ims` |
| Waiting on Owner | Infrastructure values and SMTP/DNS setup (`docs/SETUP_INFRA.md`); statement samples; user email list |

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
**D-010 (Q-06): Payments to the Owner.** The Owner approves payments to himself. Each such approval is audit-logged and flagged. **Both Directors are notified**, and the **Accountant must review** the payment (it counts as unreviewed for month close until reviewed). **Directors remain strictly read-only**, with no approve permission of any kind.

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
  - Francis approves his team.
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

**A-011: Review scope.** Every money entry made by anyone other than the Accountant needs Accountant review before month close. The Accountant's own entries are treated as reviewed. (D-010 adds the Owner's payments to himself explicitly.)

**A-012: Payroll net pay posts as money out when the run is marked paid** (date paid + account), not at the moment of approval. Statutory lines are created at approval.

**A-013: Timesheet hours.** Entries are in 0.25-hour steps, with a maximum of 16 hours per day. Weekend entries are allowed (site work). A weekend day's window counts from the next working day. All times are Africa/Accra.

**A-014: Directors' monthly summary page (`/reports/monthly`) is in Phase A.**

**A-015: Weekly backup runner.** A scheduled GitHub Actions workflow (only the runner; nothing is committed) runs `pg_dump` plus one CSV per table against production. It uploads to the restricted Google Drive folder (D-009) through a Google service account, which has access to that folder only. The DB connection string and service-account key are stored as GitHub Actions secrets. The details will be confirmed with the Owner when the backup task is built.

**A-016: Sensitive files never go in git.** `*.xlsx`, `*.xls`, `*.csv` at the repo root, and everything under `private/` are git-ignored. The payroll workbook stays local. Statement samples go in `private/`.

---

## Findings from the payroll workbook (28 Sep 2026)

**F-001: The workbook still uses the old PAYE bands.**
- Row 13 of the "Staff " sheet has monthly bands of 490 nil / 110 @5% / 130 @10% / 3,167 @17.5% / 16,000 @25%. That is the old annual 5,880 / 1,320 / 1,560 / 38,000 / 192,000.
- The formulas stop at 25%, so there are no 30% or 35% bands.
- From the **September 2026** run, the new bands in D-004 apply (monthly: 588 nil / 80 @5% / 100 @10% / 2,900 @17.5% / 16,000 @25% / 30,332 @30% / above 50,000 @35%).
- The system imports PAYE and doesn't recalculate it (version 1), so it can't catch this. **The Accountant must update the sheet.**

**F-002: The sheet's "Total Cost To Company" = Gross + Employer SSF only.** It leaves out employer PF (Tier 3) and the post-tax allowances. Both are nil today, so the figures agree for now. See Q-23.

**F-003: The workbook contains hidden sheets for another organisation's employees** (JAN 16, DEC 15, and five named sheets from a microfinance company's 2015/16 payroll). The import reads only the two mapped sheets. The Owner may want to delete those sheets.

---

## Open questions

**Q-23 (non-blocking): Cost to company.** Should staff cost history and job costing use the full figure (Gross + employer SSNIT + employer PF + post-tax allowances), or the sheet's Gross + Employer SSF? Recommended: the full figure, with a warning when it differs from the sheet. Both are identical today, and the schema stores every component either way.
