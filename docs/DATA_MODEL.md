# Data model: Phase A

The schema, RLS, triggers and reference data live in `supabase/migrations`, applied in order: staging first, then production (DECISIONS D-002). Decisions behind the design are in `DECISIONS.md` (A-002..A-005, A-017..A-030).

## Migrations

| File | Contents |
|---|---|
| `0100_foundation` | Roles and profiles; access helpers (`app.my_role()` returns nothing for Owner, Director or Accountant without 2FA); Director hidden areas; audit log; gapless numbering; month locks; notifications; Admin action items |
| `0200_setup` | Dated settings; public holidays and working-day maths; accounts (+ Admin's `account_picker`); tax codes (dated versions, ordered components with a stacking basis); WHT rates; expense categories; job types; budget roles; staff, private IDs and cost history; clients; referrers; suppliers |
| `0300_jobs_time_leave` | Jobs (MEL numbers), team, hour budgets, billing milestones, contracts register; leave types, entitlements, requests; timesheets with the entry window, late-entry tiers and frozen rate snapshots |
| `0400_money_in` | Ledger; shared review and money-out approval machinery; invoices (INV on approval), lines and per-line taxes; credit notes (CN); receipts (Reported → Confirmed) and allocations; WHT certificates; `quick_log_payment()` |
| `0500_money_out` | Expenses (VAT split, out-of-pocket claims, recharges); recurring expenses; supplier payments and bill items; staff reimbursement payments; transfers; staff loans and repayments; directors' transactions and payments |
| `0600_statutory_payroll` | Statutory calendar, lines, payments and ledger view; auto WHT remittance lines; payroll column maps, runs, lines, checks, payslips; VAT workings |
| `0700_reconciliation_close` | Statement imports and lines; reconciliations; month close (`month_close_blockers`, `close_month`, `reopen_month`, checklists); Director write block on every table |
| `0800_views` | Balances, ageing, chase list, ready to invoice, retention, job money status, hours vs budget, utilisation, compliance, missing days, leave balances, running cost, Money panel, monthly summary, Accountant queue |
| `0900_reference_data` | Directors, budget roles, the 8 staff with approvers and first costs, job types, leave types, tax code names, chart of categories |
| `1000_hardening` | Revokes API access to the internal write helpers |
| `1100_user_provisioning` | Profiles created from Owner invites; the user directory |
| `1200_mfa_recovery` | Audited two-factor resets |
| `1300_owner_answers` | Cost to company = gross + employer SSNIT + employer PF (D-027); the Owner confirms payments as the Accountant's backup, reviewed by the Accountant before close (D-028) |
| `1400_leave_screens` | `working_days()` for the request form; `set_up_leave_year()` (A-038) |
| `1500_close_screens` | Admin sees only its own close blockers; `entries_to_review()` queue for the Accountant (A-040) |
| `1600_reminders` | Daily and 17:00 reminder routines scheduled with pg_cron; reminders sent once each (A-042) |
| `1700_documents` | Private `documents` bucket; a file is visible to whoever can read its record (A-045) |

## How it fits together

- **One ledger** (`ledger_entries`) holds every movement of money: it's the only source of account and director balances. Source tables post to it through triggers (`app.post`). Nobody writes it directly, and only finance roles read it.
  - Sign: + in / − out for an account.
  - For a director's current account, + means the company owes the director.
- **When money posts:**
  - Receipts post only when Confirmed.
  - Expenses paid from a company account or petty cash post when confirmed.
  - Money out posts only when Paid.
  - Payroll net pay posts when the run is marked paid.
  - Transfers post immediately.
- **Review** (`app.enable_review`): Admin's entries start as Recorded. Only the Accountant marks them Reviewed or Queried. Editing a reviewed entry sends it back to Recorded.
- **Money-out approval** (`app.enable_payout`): Prepared → Approved (Owner only) → Paid. Amounts are frozen once approved, and Paid records are locked. Payments to the Owner notify both Directors and always need the Accountant's review.
- **Locks:**
  - Closed months reject inserts, edits and deletes dated in them (`app.enable_month_lock`).
  - Issued invoices, approved credit notes, confirmed receipts, approved timesheets, approved payroll lines and issued payslips are immutable.
  - Corrections are new entries: a credit note, a supplementary run, or reopening the month.
- **Numbering:** `app.next_number` locks the counter row inside the approving transaction, so numbers are gapless and a failed approval gives its number back. Imported numbers raise the counter (D-021).
- **System mode:** trusted internal functions set `app.system` for their own transaction to bypass user-facing guards, for example filling leave days or recording loan repayments from payroll.
- **Every table** has RLS, an audit trigger where it holds money, tax, payroll or permissions, and the Director write block.

## Who sees what (enforced in the database)

| Data | Owner | Director | Accountant | Admin | Project lead | Staff |
|---|---|---|---|---|---|---|
| Accounts, balances, ledger, reconciliations, statements | ✓ | ✓ (read) | ✓ | picker only (name) | — | — |
| Invoices | ✓ | ✓ | ✓ | ✓ (per-invoice amounts, no totals) | own-job drafts | — |
| Receipts, credit notes, WHT certificates | ✓ | ✓ | ✓ | ✓ | — | — |
| Expenses | ✓ | ✓ | ✓ | ✓ | own + team claims | own |
| Payroll lines, payslips | ✓ | ✓ unless hidden | ✓ | own payslip | own payslip | own payslip |
| Staff costs, rate snapshots | ✓ | ✓ unless hidden | ✓ | — | charge-out rate only | — |
| Directors' accounts and payments | ✓ | own always, others unless hidden | ✓ | — | — | — |
| Jobs (with fees) | ✓ | ✓ | ✓ | ✓ | ✓ | `my_jobs` (no fees) |
| Timesheets | ✓ | ✓ | ✓ | own | all | own |
| Leave requests (type, reason) | ✓ | ✓ | ✓ | own | own + team | own |
| Leave calendar (names, dates) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Owner, Directors and Accountant see nothing until their session has passed 2FA (`aal2`). Every profile can always read its own row, so the app can prompt for 2FA enrolment.

## Testing

`supabase/tests/run.sh` rebuilds a throwaway local database and applies everything in order:
1. A small Supabase shim (`00_supabase_shim.sql`: `auth.uid()`, `auth.jwt()`, API roles).
2. Every migration.
3. The test helpers.
4. The acceptance tests, run as each role.

It needs a local PostgreSQL 15+ listening on `PGPORT` (default 54329) that trusts `postgres`. To start a throwaway one:

```
initdb -D <dir> -U postgres -A trust
pg_ctl -D <dir> -o "-p 54329" start
```

| File | Brief §13 items |
|---|---|
| `10_test_access.sql` | 3, 4, 5, 22 |
| `20_test_money_in.sql` | 6, 7, 8, 9, 10, 12, 23 |
| `30_test_money_out.sql` | 15, 16, 17, 18, 19, 24, 26, 27, D-010, D-016, D-017 |
| `40_test_close.sql` | 11, 13, 14, 25 |
| `50_test_payroll.sql` | 20, 21, D-022..D-024 |
| `60_test_time_leave.sql` | 29-36 |
| `70_test_provisioning.sql`, `80_test_mfa_recovery.sql` | A-033, A-037 |
| `90_test_owner_answers.sql` | D-027, D-028 |
| `91_test_leave_setup.sql` | 33, A-038 |
| `92_test_close_screens.sql` | A-040 |
| `93_test_reminders.sql` | brief §9, 31, A-042 |
| `94_test_documents.sql` | A-045 (and 4, 22 for files) |

Items 1, 2 and 28 (domain and email, routes, CSV and backups) are tested at the front-end and infrastructure stage. The same acceptance tests are re-run on staging before production.

## Not in the schema yet (by design)

- **Statement parsers for GCB and MTN MoMo:** waiting for the samples (D-025).
- **Payslip PDF Edge Function.**
- **Phase B/C tables** (A-006).
