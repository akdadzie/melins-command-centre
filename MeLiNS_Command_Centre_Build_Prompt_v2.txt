# BUILD PROMPT: MeLiNS COMMAND CENTRE

Revision 2.4, 28 September 2026. A clean consolidation of revisions 1.0-1.8, updated for the board of directors and the final staff list; the revision history is at the end.

## 0. How to use this prompt

- This prompt describes the whole system, but it must be **built and released in three phases (A, B and C, Section 12)**. Build Phase A first and get it live and in use before starting Phase B. Don't build ahead.
- Save this prompt in the repository as **PROJECT_BRIEF.md**. Keep a **DECISIONS.md** file alongside it, recording every decision, assumption and change made during the build. Read both at the start of every build session, so each session starts with full context.
- Before writing any code for a phase, restate the plan for that phase (screens, tables, roles, routes) and list any questions that block it. Build only after the plan is confirmed.
- After each phase, run that phase's acceptance tests (Section 13) on the staging environment, report the results, and list anything that needs a decision.

## 1. Your role

You are building the internal management system for MeLiNS Associates Limited, a structural and civil engineering consultancy in Accra, Ghana, that also takes on some design-and-build contracting. Act as a senior product engineer who cares about correctness of money, tax and permissions above visual polish.

## 2. Background

MeLiNS has eight core staff and a board of three directors: Kwasi Dadzie Ennison (Managing Director), Kofi Anaman and Ransford Addai. The two other directors are not involved day to day but need full visibility. The practice runs on referrals. Over the last year it has earned about GHS 42k a month in fees against costs of GHS 45-50k. The practice has no working records system. Nobody tracks who refers work, fees are set inconsistently, invoices go unchased, and six months of PAYE/SSNIT arrears built up without anything flagging them.

The Command Centre must fix this. It should let the Managing Director see at a glance whether the practice is safe, where the next fee is coming from, and whether any work is slipping. The team should be able to keep it up to date with very little effort, an external accountant should be able to review and close every month, and the directors should be able to see the state of the company at any time.

## 3. Platform and technical requirements

**Stack and environments**
- **Netlify** (front end) + **Supabase** (Postgres database, auth, storage, scheduled functions). MeLiNS already runs another internal system on this stack, so use it and don't propose alternatives.
- **A new, separate Supabase project for MeLiNS.** Don't share a project, database, users or storage with any other company's system.
- **Two environments:** *production* (live data) and *staging* (a second Supabase project with test data, plus a Netlify branch deploy). All acceptance tests run on staging, never on live financial data. Database changes are applied as versioned migration files, staging first, then production.
- A single-page web app deployed on Netlify from a Git repository, with environment variables for the Supabase URL and anon key. The service-role key is never exposed to the browser.

**Domain, links and email**
- The app lives at **https://app.themelins.com** (a CNAME to Netlify, with Netlify's free HTTPS). The public website at www.themelins.com and the company's existing email must not be affected. Staging uses a Netlify URL or staging.themelins.com.
- **Every view and every record has its own URL** (routes in Section 5), e.g. app.themelins.com/invoices/INV-2026-014. Links work after log-in (the user is taken to the link once signed in), the browser back button works, and every notification and reminder links directly to the record it's about.
- **Opening a link never bypasses permissions.** A user who opens a route or record they're not allowed to see gets a "No access" page, and the database returns nothing.
- **Branded email:** invites, password resets and reminder emails are sent from the MeLiNS domain (e.g. noreply@themelins.com) through custom SMTP set up with the company's email provider, not Supabase's default sender.
- A shared mailbox, **accounts@themelins.com**, receives remittance advices and WHT certificates (set up outside the app, printed on every invoice).

**Security**
- **Auth:** Supabase Auth, email and password, invite only (no public sign-up). The Owner creates users. Each user's role is stored in a profiles table: Owner, Director (view-only), Accountant, Admin, Project lead, Staff.
- **Two-factor authentication is mandatory** for the Owner, the Directors and the Accountant, and optional for others.
- **Every permission in Section 4 is enforced with Postgres row-level security** on every table, and with column-restricted views or security-definer functions where a role may see some columns but not others. Hiding things in the interface is not enough.
- **Audit log** on all money, tax, payroll and permission tables: who, what, when, old and new values.
- **Locked records:** approved timesheet rate snapshots, sent invoices, confirmed payments, paid supplier payments, reimbursed expenses and anything in a closed month can't be edited. Corrections are made with a new reversing entry (e.g. a credit note), or by the Owner reopening the month, which is logged.
- **Sensitive data:** store only the last 4 digits of any bank account and never full card numbers, software licence keys or passwords. Ghana Card and TIN numbers of suppliers are finance-restricted.

**Numbering**
- Invoices (INV-2026-001), credit notes (CN-2026-001), jobs (MEL-2026-001), assets (MEL-AST-001) and valuations (per job: VAL-01) use **sequential numbers with no gaps**, allocated by the database when a document is issued (not when a draft is created). Drafts use a temporary reference.

**General**
- Mobile-first: staff use phones on site and laptops in the office. Timesheet and expense entry must work well on a phone over a weak connection. If saving fails, keep the entry on the device and retry automatically.
- GHS throughout, with thousands separators. Dates DD MMM YYYY. Time zone Africa/Accra. Design every money record with a currency and exchange rate (default GHS, rate 1), so foreign currency can be switched on later without restructuring.
- Branding: MeLiNS red (#C8102E), dark grey text, white background, clean and uncluttered. The "MeLiNS" wordmark with the tagline "STRUCTURES · CIVILS · DEVELOPMENT CONSULTANTS".
- **Notifications:** in-app first, with email for anything overdue or needing approval. Each notification links to its record.
- **CSV import and export** for every main table, with downloadable templates.
- **Backups:** a scheduled weekly full export (CSV and SQL) stored outside Supabase, in addition to Supabase's own backups. Keep financial records for at least six years. In the handover, state the free-tier limits (project pausing, backup retention) and recommend when to move to a paid plan.
- **Handover:** migration files (schema, RLS policies, triggers, seed data) in the repository, a README on deployment, a one-page guide for the Owner (creating users, first-log-in setup), and a one-page month-close guide for Admin and the Accountant.

## 4. Users, roles and approvals

Six roles. "Finance-restricted" information means: account balances and cash position, reconciliations, payroll detail and staff costs, cost-rate snapshots and rate build-ups, job margins, bonuses, annual commitments, directors' current accounts and payments to directors, and business development fees. **Only the Owner, the Directors and the Accountant can see finance-restricted information.** The Owner can hide specific areas from the Directors in Settings (for example individual salaries); by default they see everything.

| Role | Who | Can see | Can do |
|---|---|---|---|
| Owner | Kwasi Dadzie Ennison (MD) | Everything | Everything. Only the Owner can manage users and roles, change staff costs, approve invoices for sending, approve outgoing payments, approve credit notes, write-offs and BD fees, and reopen a closed month. Logs own time like everyone else. |
| Director (view-only) | Kofi Anaman, Ransford Addai | Everything the Owner sees (all views, balances, reports and documents), unless the Owner hides an area in Settings | **Nothing.** Read-only everywhere: no creating, editing, approving, deleting or closing, enforced in the database, not just by hiding buttons. They can export reports and download documents they can see, and receive notifications the Owner chooses (e.g. monthly close summary). |
| Accountant | MeLiNS's external accountant (part-time) | Everything financial, including all finance-restricted information | Review Admin's entries (Reviewed or Queried), upload statements, reconcile accounts, confirm reported payments, maintain tax codes and the statutory calendar, record statutory payments, prepare VAT workings, confirm provisions, close the month, export records for Zoho Books and tax filing. Can also approve invoices for sending if the Owner delegates this in Settings. Can't manage users, change staff costs, approve payments out, or approve write-offs, credit notes or BD fees. |
| Admin (data entry) | NSP3 - Admin (national service, accounting or business graduate) | The records they enter; amounts outstanding per invoice and per supplier bill (to chase and prepare payments); pipeline, clients, referrers (no BD fees), suppliers, assets, compliance documents, tender costs. **No finance-restricted information**, and no balances or totals of any kind, through any screen or API. | Draft invoices, record receipts and WHT deducted, record expenses, prepare supplier payments, per diems, advances and reimbursements for approval, record them as paid once approved, post entries to a named account (without seeing its balance), confirm recurring-expense drafts, record staff loan repayments, keep the supplier list, assets, compliance documents, tender costs and bonds up to date, log leads. Every money entry goes to the Accountant for review. |
| Project lead | Francis Austin (Senior Engineer) | All jobs, tasks, timesheets, billing milestones, valuations, subcontract packages, hire, trips; job fees and budgets in hours and cost categories; final charge-out rates. No finance-restricted information. | Update job status and deadlines, mark billing and subcontract milestones "Reached", prepare valuations, assign tasks, plan trips, approve timesheets, leave requests, out-of-pocket expenses and advance retirements for their team, draft quotes, log leads. |
| Staff | Ernest Gbadago, Ibrahim Commedan, Nana Poku, NSP1 - Technical, NSP2 - Technical | Their own jobs (name, deadlines, tasks), tasks, timesheets, expenses, trips and advances | Log time, update own tasks, submit expenses, request and retire advances, request leave, view own payslips and leave balance, log leads (add only). |

**Approval flows**
- **Invoices:** Draft (Admin or Project lead) → Approved (Owner, or Accountant if delegated) → Sent (Admin) → Part-paid / Paid. An invoice gets its final number only when approved.
- **Money out** (supplier and subcontractor payments, per diems, advances, reimbursements, BD fees): Prepared (Admin) → Approved (Owner, the bank signatory) → Paid (Admin records the date, account and reference) → Reviewed (Accountant). Admin is never a bank signatory.
- **Admin's money entries:** Recorded → Reviewed (Accountant), or Queried (returned with a note). A month can't be closed while any entry in it is unreviewed or queried.
- **Leave:** Requested (staff member) → Approved or Declined (Project lead for their team; Owner for the Project lead; the Owner's own leave is recorded without approval). Approved leave can be cancelled before it starts.
- **Payroll:** Imported (Accountant or Owner) → Approved (Owner) → Payslips issued. Issued payslips are locked.
- **Timesheets:** Submitted → Approved (Project lead; Owner for the Project lead's own and the Owner's own time, which are auto-approved) → rates frozen. See the timesheet entry window below.
- **Timesheet entry window** (counted in working days after the day worked; weekends and Ghana public holidays from the business calendar don't count; all limits editable in Settings):
  - **Approved leave and public holidays are exempt:** those days are filled automatically with Leave or Public holiday entries, count as logged, and trigger no reminders.
  - **Days 0-3:** the person logs or edits their own time for that day.
  - **Days 4-10:** the person can no longer log or edit it. Only the **Project lead (Francis Austin)** can enter or correct it on their behalf, with a reason.
  - **After day 10:** only the **Owner** can enter or correct it, with a reason.
  - Entries made on someone's behalf are marked **Late entry**, showing who entered it, when and why. They go through normal approval.
  - The Project lead's own late entries follow the Owner tier from day 4, since he can't enter time on his own behalf. The Owner's own time has no window.
  - Once approved, an entry is locked regardless of the window.
  - Late entries count toward each person's **timesheet compliance** (% of working days logged on time), shown in the team view and on the Project lead's and Owner's home screens.
- **Client payments:** Reported → Confirmed (Accountant, against the statement). See Section 7.4.

## 5. Views and routes

Every view has a route. Roles: **O** Owner, **D** Director (view-only), **Ac** Accountant, **Ad** Admin, **PL** Project lead, **S** Staff. "own" means only the user's own records. Each role sees only the permitted columns of a view. **Directors (D) can open every route the Owner can, read-only**, except Settings, users and roles, and any area the Owner has hidden from them. Every action button (create, edit, approve, close) is absent for Directors, and the database rejects any write from a Director account.

| View | Route | Roles |
|---|---|---|
| Home (role-specific, see Section 6) | / | O, D, Ac, Ad, PL, S |
| Notifications | /notifications | O, D, Ac, Ad, PL, S |
| My profile and 2FA | /me | O, D, Ac, Ad, PL, S |
| Accounts and balances | /accounts | O, Ac |
| Account detail and transactions | /accounts/:id | O, Ac |
| Account transfers | /accounts/transfers | O, Ac; Ad (record only) |
| Reconciliations | /accounts/reconciliations | O, Ac |
| Invoices | /invoices | O, Ac, Ad; PL (drafts for own jobs) |
| Invoice detail and print | /invoices/:number | O, Ac, Ad |
| Ready to invoice | /invoices/ready | O, Ac, Ad |
| Retention held by clients | /invoices/retention | O, Ac, Ad |
| Credit notes, disputes and write-offs | /invoices/adjustments | O, Ac; Ad (view) |
| Payments received | /receipts | O, Ac, Ad |
| WHT certificates | /receipts/wht | O, Ac, Ad |
| Expenses | /expenses | O, Ac, Ad; PL (approve team); S (own) |
| Recurring expenses | /expenses/recurring | O, Ac, Ad |
| Prepayments | /expenses/prepayments | O, Ac |
| Payments out (suppliers, subcontractors) | /payments-out | O, Ac, Ad |
| Staff payments (reimbursements, per diems) | /staff-payments | O, Ac, Ad |
| Cash advances | /advances | O, Ac, Ad, PL (approve); S (own) |
| Staff loans | /staff-loans | O, Ac; Ad (record repayments) |
| Payroll runs (import, approve, issue payslips) | /payroll, /payroll/:month | O, D (view), Ac |
| My payslips | /me/payslips | O, D, Ac (all payslips); PL, S, Ad (own only) |
| My leave (request, balance) | /me/leave | O, Ac (view), Ad, PL, S |
| Leave requests and approvals | /leave | O, PL (team); D, Ac (view) |
| Leave calendar (who is away) | /leave/calendar | O, D, Ac, Ad, PL, S (names and dates only, not leave type) |
| Leave entitlements and balances | /leave/balances | O, Ac; PL (team) |
| Directors' current accounts | /directors, /directors/:id | O, D, Ac |
| Tax and statutory ledger | /tax/statutory | O, Ac |
| VAT workings | /tax/vat/:month | O, Ac |
| Pipeline (leads and tenders) | /pipeline | O, Ac (view), Ad, PL |
| Lead detail and quote builder | /pipeline/:id | O (full build-up), PL (final rates), Ad (no quote) |
| Log a lead | /pipeline/new | O, Ac, Ad, PL, S |
| Tender costs and bonds | /pipeline/tenders | O, Ac, Ad, PL |
| Clients | /clients, /clients/:id | O, Ac, Ad, PL |
| Referrers and contacts | /referrers, /referrers/:id | O, Ac, Ad, PL (no BD fees) |
| Jobs | /jobs | O, Ac, Ad, PL; S (own) |
| Job detail (tabs: overview, budget, milestones, valuations, subcontracts, hire, site costs, trips, contracts, costing) | /jobs/:number | O, Ac (all tabs); PL (no costing); Ad (billing, contracts); S (overview, own tasks) |
| Tasks | /tasks | O, PL, S (own) |
| Timesheet (mobile entry) | /timesheet | O, PL, S |
| Timesheet approvals | /timesheet/approvals | O, PL |
| Team workload and utilisation | /team | O, PL; Ac (view) |
| Staff and cost history | /team/staff | O, Ac (costs); PL (names and roles only) |
| Trips and site visits | /trips | O, Ac, Ad, PL; S (own) |
| Suppliers and subcontractors | /suppliers | O, Ac, Ad, PL |
| Subcontract packages | /subcontracts | O, Ac, Ad, PL |
| Hire records | /hire | O, Ac, Ad, PL |
| Overheads: budget vs. actual | /overheads | O, Ac |
| Annual commitments, provisions and bonus | /commitments | O, Ac |
| Reports (margins by job, job type, referrer; utilisation; cost of winning work) | /reports | O, Ac |
| Asset register | /assets, /assets/:tag | O, Ac, Ad; PL (view) |
| Compliance documents | /compliance | O, Ac, Ad, PL |
| Month close | /close/:month | O, Ac; Ad (own checklist) |
| Settings, users and roles | /settings | O; Ac (tax codes, statutory calendar) |

## 6. Home screens

**Owner: three panels, in this order**

*Panel 1: Money ("Am I safe?")*
- Cash by account (calculated balance, last reconciled date, warning if statement and calculated balances differ). Ring-fenced accounts (e.g. a tax and bonus reserve) shown separately.
- Reserved for commitments: provisions for the 13th-month bonus and other annual commitments, with the next big one and its due month.
- **Available cash** = confirmed cash in operating accounts − reserved provisions − committed cash.
- **Weeks of cover** = available cash / (monthly running cost / 4.33). Green above 8, amber 4-8, red below 4.
- Money owed to MeLiNS: total, ageing (0-30, 31-60, 61-90, 90+ days), top 5 debtors; plus reported-but-unconfirmed payments; plus retention held by clients and when it's due for release.
- Tax and statutory: everything due in the next 30 days (PAYE, SSNIT Tier 1, SSNIT Tier 2, VAT, WHT remittance, provisional corporate tax), plus arrears outstanding by type.
- VAT position this month: output VAT − claimable input VAT.
- WHT credits this year, and certificates still to collect.
- Ready to invoice: milestones reached, valuations certified and rechargeable expenses not yet invoiced.
- **Committed cash:** owed to staff (reimbursements, per diems), owed to subcontractors and suppliers, BD fees now payable, open cash advances, and payments approved but not yet made.
- Awaiting your approval: invoices to approve, payments out to approve.
- Fees invoiced and confirmed received this month vs. the monthly target.
- Overheads this year vs. budget, flagging categories over budget.

*Panel 2: Pipeline ("Where is the next fee coming from?")*
- Open leads, quotes and tenders by stage: total value and weighted value (value × probability).
- Next steps due or overdue.
- Tender costs committed against open tenders, and bonds outstanding.
- Compliance documents expiring in the next 30 days.
- Referral sources ranked by value of work won in the last 12 months (with BD fees paid, net).
- Win rate and top reasons for lost leads (last 12 months).

*Panel 3: Delivery ("Is anything slipping?")*
- Live jobs flagged when past due, when any role's hours exceed budget, or when any cost category exceeds budget.
- **Utilisation:** each person's billable hours as a % of their monthly target (reduced pro-rata for approved leave and public holidays), this month and the last 3 months.
- Who is away this week and next (from the leave calendar), and leave requests awaiting approval.
- Upcoming trips this week.
- Timesheets awaiting approval, and anyone who hasn't submitted last week's timesheet.

**Directors:** the Owner's three panels, read-only, with no approval queue, plus a monthly summary page (/reports/monthly) showing the month's fees invoiced and received, costs, cash position, tax position and closed-month status.

**Accountant:** the Money panel in full, plus entries to review (count and oldest), reported payments to confirm, unreconciled accounts, and month-close status.

**Admin:** a task list, with no balances or totals: invoices to draft (ready to invoice), invoices approved and ready to send, invoices to chase today, payments approved and ready to pay, reported payments needing details, recurring-expense drafts to confirm, queried entries to fix, "Record this receipt" tasks, WHT certificates to request, documents expiring.

**Project lead:** Pipeline and Delivery panels, plus milestones due, timesheets and expenses to approve, and valuations to prepare.

**Staff:** my tasks, my hours this week against my target, my leave balance and upcoming leave, my latest payslip, my trips, my open advance, my expense claims and their status.

**Every tile opens its detailed list view** at its route.

## 7. Data model

### 7.1 Setup

- **Settings** (dated versions, so past records keep the values in force at the time): company details for tax invoices (registered name, TIN, VAT number, address), accounts email, payment details printed on invoices, financial year end, SSNIT Tier 2 trustee, due-day rules for every statutory type, monthly fee target, overhead share, target profit margin, default billable hours per month, invoice payment terms, per diem rates (by role, day trip vs. overnight, separate driver rate), WHT rates by supplier and client category, maximum open advances per person, timesheet entry window (self-entry days, Project-lead days; defaults 3 and 10 working days), business calendar of Ghana public holidays, leave year (default calendar year), leave types and default entitlements, maximum carry-over days, payroll CSV column mapping, 13th-month bonus rule (base: basic or gross; who qualifies; payment month, default December; pro-rated by months worked), whether the Accountant may approve invoices.
- **Monthly running cost** is **calculated**: the latest monthly payroll total + monthly equivalent of recurring expenses + monthly share of prepayments. The Owner may enter an override, which is shown alongside the calculated figure.
- **MeLiNS accounts:** name (e.g. "GCB operating", "MTN MoMo", "Petty cash", "Tax & bonus reserve"), type (Bank, Mobile money, Petty cash, Other), institution, last 4 digits only, purpose (Operating, Collections, Payroll, Reserve / ring-fenced, Petty cash), currency, opening balance and date, whether Admin may post to it, active flag. Admin sees only the name when choosing an account.
- **Tax codes** (dated versions; Owner and Accountant edit): name (Standard, Zero-rated, Exempt, No VAT), each component rate (VAT and each levy listed separately), whether each component is recoverable as input tax, effective-from date. Never hardcode rates; the Owner and Accountant enter current Ghana rates at setup.
- **Chart of expense categories** (one list used everywhere; two levels; categories can be added or renamed but not deleted once used):
  - **Premises:** rent, service charge, utilities (electricity, water), repairs and maintenance, security
  - **Office running:** office supplies and stationery, printer ink and toner, printing and plotting, cleaning supplies, cleaning services, kitchen and refreshments, internet and phones, postage and courier
  - **Software & IT:** software licences and subscriptions, IT support and repairs, website and email hosting
  - **Professional fees:** accounting and bookkeeping, audit, legal, consultants (non-job), bank charges
  - **Travel & transport (non-job):** fuel, road tolls, taxi and ride-hailing, vehicle servicing and repairs, parking
  - **Staff & welfare:** directors' fees and allowances, staff welfare (funerals, weddings, hospital visits), team building and end-of-year events, training and CPD, medical, staff refreshments, uniforms and PPE
  - **Compliance & memberships:** professional memberships (e.g. GhIE), company annual returns, permits and licences, insurance
  - **Business development:** marketing, company profiles, networking events, gifts (job BD fees are tracked separately)
  - **Job direct costs** (a job is required): sublet work, equipment hire, vehicle hire, fuel and road tolls on job trips, travel and accommodation, per diems, testing and lab fees, printing of job drawings and reports, **materials**, **site labour (casual wages)**, **plant**, site consumables, other job costs
  - Fuel and tolls exist under both non-job travel and job direct costs; whether a job is attached decides which applies.
- **Staff:** name, role, email (for log-in), billable-hours target per month, start and end dates, active flag, charge-out rate (calculated, finance-restricted build-up).
- **Staff cost history** (finance-restricted): staff member, monthly cost to company, basic pay (for the bonus rule), effective-from date. Never overwritten; a change adds a new dated row.

### 7.2 Clients, referrers and pipeline

- **Clients:** name, organisation, type (Government / public, Corporate, Private individual, Other), phone, email, TIN, VAT number, **deducts WHT** (yes/no, category), **VAT withholding agent** (yes/no), payment terms override, notes.
- **Referrers and contacts:** name, organisation, relationship (mentor, consultant, contractor, architect, past client, other), phone, email, last contact date, notes. Contact-log entries (date, how, note) update the last contact date.
- **Leads:** title, client or prospect, referrer, job type, estimated value, probability %, stage (Enquiry, Quoting, Tender submitted, Awaiting client, Won, Lost), next step, next-step date, owner, required compliance documents, **lost reason** (Price, Timing, Went to competitor, Client cancelled, Didn't qualify, Other, plus note; required when Lost). A won lead converts to a job in one click, carrying the client, referrer, value, quote lines (as budget lines) and payment schedule (as billing milestones).
- **Tender costs and bonds** (linked to a lead or job): tender document fee, bid security or bond, performance bond, advance payment guarantee, other bid costs. Bonds have issuer, amount, cash collateral held, fee, expiry and status (Active, Returned, Called). They roll up into "cost of winning work" per lead, job type and referrer.

### 7.3 Jobs and delivery

- **Job types** (editable list): Structural design of buildings; Structural assessment of existing structures; Construction supervision; Employer's Representative and tender review; Design and build contracting; Engineering reports and concept input for others' bids.
- **Jobs:** job number, title, client, referrer, job type, **contract mode** (Consultancy or Design and build), **delivery status** (Not started, In progress, On hold, Under review, Completed, Closed), fee (agreed; for design and build, the contract sum), fee basis (lump sum, % of construction cost, monthly, time-based), **construction value** (required when fee basis is % of construction cost; the fee is then calculated), **retention %** and retention release terms (from the contract), start and due dates, % complete, project lead, team, goodwill/unpaid flag (e.g. mentor work, still costed), notes. **Money status is derived**, not set by hand: Not invoiced, Part-invoiced, Fully invoiced, Part-paid, Paid, from milestones, valuations, invoices and payments.
- **Job budget lines:** hours by role (Senior Engineer, Graduate Engineer, CAD Technician, National service engineer), plus amounts by cost category (Sublet work, Equipment hire, Vehicle hire, Travel and per diems, BD fee, Materials, Site labour, Plant, Other direct costs). Created from the quote; editable by the Owner and Project lead. Timesheet hours roll up by the role of the person who logged them.
- **Billing milestones** (consultancy jobs): name, amount or % of fee, trigger, target date, status (Pending → Reached → Invoiced → Paid), date reached, marked by, invoice. Warn if the milestones don't add up to the fee. Supervision jobs can generate monthly milestones automatically.
- **Valuations** (design-and-build jobs, replacing milestones): valuation number, date, gross value of work done to date (optionally from BOQ section % complete), materials on site, less retention at the job's retention %, less previous valuations, amount due this valuation, status (Draft → Submitted → Certified → Invoiced → Paid), certified amount (may differ from submitted), certificate (upload).
- **BOQ summary** (design-and-build, optional): section, description, contract amount, % complete (updated at each valuation). Feeds the gross value of the next valuation.
- **Site labour sheets** (design-and-build): job, week, worker name, trade, days worked, daily rate, total, paid (date, account, method). Totals post to the job's Site labour cost. Worker names are kept on the sheet, not as system users.
- **Materials purchases:** recorded as expenses in the Materials category, with supplier, description, quantity and unit, and delivered-to-site date.
- **Tasks:** job, title, assignee, due date, status, recurring pattern (optional).
- **Leave types** (editable): Annual, Sick, Maternity, Paternity, Compassionate/bereavement, Study/exam, Unpaid, Other. Each has whether it's paid, whether it uses the annual balance, and whether a supporting document is required (e.g. a medical certificate for sick leave beyond a set number of days).
- **Leave entitlements:** per person per leave year: entitled days (defaults by role in Settings; national service persons per their posting terms; the Owner sets figures at or above the statutory minimum, to be confirmed with the Accountant), carried over from last year (capped in Settings), pro-rated for people joining or leaving mid-year.
- **Leave requests:** person, type, start and end dates, working days (calculated, excluding weekends and public holidays), reason (optional), supporting document (optional upload), status (Requested, Approved, Declined, Cancelled, Taken), approver, decision date. Approving leave fills those days with Leave timesheet entries at zero billable hours.
- **Leave balances** (calculated): entitled + carried over − taken − approved future leave = available. A request that would take the annual balance below zero needs Owner approval or becomes Unpaid.
- **Privacy:** the leave calendar shows only names and dates to colleagues. Leave type, reasons and documents are visible only to the person, their approver, the Owner, the Directors and the Accountant. Record the leave type only, never medical details or diagnoses.
- **Timesheets:** person, role at the time, job (or Internal/admin, Business development, Goodwill/mentor, Leave/absence), date, hours, description, status, approver, **cost-rate snapshot** and **charge-out-rate snapshot**, frozen when approved using rates in force on the entry date. **Everyone logs time, including the Owner**, so job costs include the Owner's time.
- **Trips / site visits:** job, purpose, destination, departure and return dates, days and nights (calculated), travellers, driver (staff, hired driver or supplier), vehicle (owned asset or a hire record), status (Planned, Approved, Completed, Cancelled), approved by.
- **Per diems** (generated from an approved trip): person, rate type, days, rate (frozen from Settings on the trip date), amount, status (Prepared → Approved → Paid).
- **Contracts register** (per job): document type (appointment letter, signed agreement, letter of award, variation, subcontract agreement), date, parties, value, key terms (payment terms, retention, liability cap), file.

### 7.4 Money in

- **Invoices:** number (on approval), job, milestones or valuation covered, lines (fee lines, valuation lines, rechargeable-expense lines), tax code per line, net, VAT and levies (per tax codes in force on the invoice date), gross, **retention deducted** (design-and-build, or where the contract holds retention), expected WHT, expected net receipt, date, due date, status (Draft, Approved, Sent, Part-paid, Paid, Disputed, Written off), outstanding, days outstanding. Prints as a VAT-compliant tax invoice on MeLiNS letterhead with MeLiNS's TIN and VAT number, the client's TIN, and **payment instructions** (bank and mobile money details, invoice number as the payment reference, remittance advices and WHT certificates to accounts@themelins.com). Include a field for a GRA e-invoice reference in case MeLiNS must use GRA's e-VAT system.
- **Retention:** each invoice's retention is tracked per job. The total held is shown per client and job, with its release condition and expected date. Releasing retention creates a billing line on a new invoice.
- **Payments received:** invoice(s), cash received, WHT deducted by client, VAT withheld (if the client is a VAT withholding agent), total settled (cash + WHT + VAT withheld), date, account received into, method, reference, **source** (Cheque/cash at office, Remittance advice, Reported by Owner, Found on statement, Received by director), **status** (Reported → Confirmed). An invoice is fully settled when the total settled equals the gross amount, less retention. Only Confirmed payments count in cash, weeks of cover and "received this month".
- **Payment received by a director:** if a client pays a director personally (cash, or into a personal account or wallet), record the payment with source "Received by director" and the director's name. It settles the invoice, but the money is posted to that director's current account (director owes company), not to a MeLiNS account. It stays there until the director transfers it to a MeLiNS account, which is recorded as a transfer and clears the balance. Flag any such balance older than 7 days to the Owner.
- **Client-payment logging rule** (whoever learns first logs it; reconciliation catches the rest):
  1. **Cheque or cash at the office:** Admin logs it, records the deposit and uploads a photo.
  2. **Remittance advice or WHT certificate** at accounts@themelins.com: Admin logs it and attaches the advice.
  3. **Owner hears first** (bank alert, client call): the Owner's **"+ Payment received"** quick-log (client or invoice, amount, date; under 20 seconds on a phone) saves it as Reported and gives Admin a task to complete the details.
  4. **Nobody logged it:** the Accountant finds the credit during reconciliation and creates a "Record this receipt" task for Admin, or records it directly.
  The Accountant confirms every Reported payment against the statement. Anything unconfirmed after 14 days is flagged to the Owner.
- **WHT credit certificates:** client, payments covered, WHT amount, certificate number, date received, status (Expected → Received → Claimed against tax), scan. Created as Expected when a payment with WHT is recorded, and flagged if not received within 30 days.
- **Credit notes:** invoice, amount, reason, VAT reversed, approved by the Owner, date. Reduce the outstanding amount and output VAT.
- **Disputes and write-offs:** Disputed (reason, date, next step; excluded from normal chasing) or Written off (Owner only, with reason; reported as bad debt).
- **Directors' current accounts** (finance-restricted; one per director: Kwasi Dadzie Ennison, Kofi Anaman, Ransford Addai): money in (director's loan, capital introduced, company money a director received personally from a client) and money out (repayments, personal items paid by the company), with account and running balance (company owes director / director owes company). Neither income nor cost.

### 7.5 Money out

- **Every money movement carries an account.** Each account's calculated balance = opening balance + confirmed money in − money out ± transfers.
- **Expenses:** date, category, job (required for Job direct costs), supplier, amount, description, receipt (upload), payment source (Company account, Petty cash, Staff out of pocket), account, supplier TIN and whether a valid VAT invoice was received, tax code, input VAT (claimable only with a valid VAT invoice), **rechargeable to client** (yes/no, markup % default 0, invoice once recharged), review status. **Out of pocket:** staff member, reimbursement status (Owed → Approved → Reimbursed), approver, date, reference. An expense can't be reimbursed or recharged twice.
- **Recurring expenses:** name, category, supplier, expected amount, frequency, next due date, usual account, fixed or variable. Each due date creates a draft expense for Admin to confirm.
- **Prepayments** (e.g. rent paid one or two years ahead, annual insurance or software): amount, period covered, account, category. Cash leaves on the payment date. The cost is spread evenly across the months covered for budgets and reports, and the renewal becomes an annual commitment.
- **Suppliers and subcontractors:** name, type (Freelance CAD technician, Freelance engineer, Equipment hire company, Vehicle hire / driver, Materials supplier, Other), services, phone, email, TIN or Ghana Card number (finance-restricted), payment details reference (not full account numbers), WHT category, rating (1-5), notes, active flag.
- **Subcontract packages** (per job): subcontractor, scope, agreed amount, payment schedule (milestones: Pending → Reached → Approved for payment → Paid), paid and balance (calculated), dates, status, agreement (upload).
- **Payments out:** supplier, job, what it settles (subcontract milestone, hire record, expense or bill), gross, WHT deducted (from the supplier's category and the rate in force), net paid, account, date, method, reference, status (Prepared → Approved → Paid). Can't exceed the approved balance.
- **Hire records:** job, supplier, item, start and end dates, rate and basis (per day, per trip, lump sum), amount, fuel included, linked trip, status (Booked, In use, Returned, Paid).
- **Cash advances:** person, job, trip, purpose, amount, status (Requested → Approved → Issued → Retired → Closed). Retirement links expense lines with receipts; the balance is refunded or topped up. Can't be closed until fully retired. One open advance per person (default).
- **Business development fees** (finance-restricted, per job): payee (a referrer or contact), basis (% of fee received, or fixed), rate or amount, timing (default **After client pays**: due pro-rata as confirmed client payments arrive; or **Upfront / on award**, which needs Owner approval after a cash-impact warning), due to date, paid, status.
- **Staff advances and loans:** staff member, amount, date, account, purpose, repayment plan, repayments (salary deduction or cash), balance, status. Remind Admin at each payroll, and warn if a staff member's end date comes before the loan is cleared.
- **Payments to directors:** directors are payees in the system. A payment to a director has a director, type (director's fee or allowance, reimbursement of expenses, sitting allowance, repayment of director's loan, dividend, other), amount, tax deducted where applicable, account, date, reference and status (Prepared → Approved → Paid). Approval by the Owner; a payment to the Owner himself needs approval by a second director or is flagged to the Directors. Loan repayments post to the director's current account. **Dividends** are recorded separately with the board resolution (upload) and any tax withheld on dividends, as a statutory line (rate to be confirmed with the Accountant); they're a distribution of profit, not a cost. Directors' fees and allowances are an overhead category (Staff & welfare → Directors' fees and allowances) unless a director is on payroll.
- **Payroll runs** (finance-restricted): month, source file (the payroll spreadsheet exported as CSV, uploaded by the Accountant or Owner), status (Imported → Approved → Payslips issued), account paid from, approved by, date paid. **The payroll calculation stays in the spreadsheet**; the system imports and checks the results. The column mapping is set once in Settings to match the existing sheet.
- **Payroll lines** (one per person per run; finance-restricted): staff member, basic, each allowance, gross, SSNIT employee 5.5%, taxable income, PAYE, other deductions (staff loan instalment, advance recovery, other), net pay, employer SSNIT 13%, total cost to company, with Tier 1 and Tier 2 split.
- **Import checks** before approval: every active staff member is present (and nobody who has left); gross − deductions = net for every line; totals match the sheet; staff loan instalments due that month appear as deductions; a person whose gross changed from last month is highlighted; national service persons are shown as allowances.
- **On approval:** the run creates the month's statutory lines (PAYE, SSNIT Tier 1, SSNIT Tier 2, and Bonus PAYE in December), records staff loan repayments from the deduction column, posts the net pay as money out from the chosen account, and updates the staff cost history if anyone's cost changed (with the Owner's confirmation).
- **Payslips:** one branded PDF per person per run (MeLiNS letterhead, employee name, role, month, pay items, deductions, net pay, employer contributions, year-to-date totals, SSNIT number and TIN if held), generated when the run is issued. National service persons get an allowance statement in the same format. Each person sees only their own at /me/payslips; the Owner, Directors and Accountant see all. Payslips are not sent as email attachments; an email tells each person their payslip is ready, with a link. Issued payslips are locked; a correction is a new supplementary run.
- **Account transfers:** from, to, amount, date, reference, reason. Neither income nor cost.

### 7.6 Tax and statutory

- **Statutory ledger:** one line per obligation per period. Types: PAYE, Bonus PAYE, WHT on directors' fees and dividends, SSNIT Tier 1 (to SSNIT), SSNIT Tier 2 (to the Tier 2 trustee), VAT return, WHT remittance (WHT MeLiNS deducted from suppliers), provisional corporate tax (quarterly), annual corporate tax return, Other. Each has period, payee, amount due, due date, amount paid, date paid, account, reference, receipt (upload), status. Arrears are tracked per type. **Opening arrears** are entered per type at setup.
- **VAT workings** (monthly): output VAT from invoices less credit notes, claimable input VAT from expenses with valid VAT invoices, VAT withheld by clients, net payable or refundable. A summary for the accountant; filing stays outside the system.
- **Compliance documents:** type (GRA tax clearance, SSNIT clearance, company registration and annual returns, VAT certificate, GhIE and other professional licences, PPA registration, business operating permit, insurance certificates, other), reference, issue and expiry dates, file, owner. A lead lists the documents it needs, and the system warns if any expires before the submission date.

### 7.7 Overheads and commitments

- **Annual overhead budgets:** year, category, amount. Actuals come from tagged expenses and prepayment spreads.
- **Annual commitments** (finance-restricted): name, category, expected amount, due month, recurring yearly, reserve account, status (Provisioning, Due, Paid).
- **Provisions:** monthly amount to set aside = remaining amount / months left until due. Shows what should have been reserved by now vs. what has actually been moved to the reserve account, and flags any shortfall.
- **13th-month bonus:** per person, base × (months worked in the calendar year ÷ 12), using the bonus rule in Settings and the staff cost history. The "13th-month bonus" commitment is created and updated automatically as staff join, leave or change pay. Paid in December (default); bonus PAYE is a separate statutory line.

### 7.8 Records

- **Asset register:** tag, item, category (Computer/laptop, Phone/tablet, Printer/plotter, Furniture, Survey and site equipment, Vehicle, Software licence, Other), make/model, serial number, purchase date and cost, supplier, assigned to, location, condition, status (In use, In store, Under repair, Disposed, Lost), warranty expiry. For software licences: seats, renewal date, annual cost, and a reference to where the key is kept (never the key itself).
- **Asset movements:** asset, date, from, to, action (Issued, Returned, Transferred, Repaired, Disposed), condition, recorded by.
- **Month close:** month, Admin checklist status, Accountant checklist status, closed by, closed at, reopened (by, when, why).

## 8. Pricing and job costing

- **Charge-out rate per person** = (monthly cost to company × (1 + overhead share)) ÷ billable hours per month × (1 + target margin). Defaults: overhead share 25%, margin 20%, billable hours 100 a month. The build-up is finance-restricted; the Project lead sees the final rate only.
- **Historical rates are locked.** Rates come from the staff cost history and the Settings version in force on each date. Approved timesheet snapshots never change, so a pay rise or Settings change never alters past margins.
- **Quote builder** (on a lead): job type, staff lines (role × hours), cost lines (sublet, equipment hire, vehicle hire, trips priced at current per diems plus vehicle, BD fee, materials, site labour, plant, other). It shows total cost, fee at target margin, and the effective margin if the Owner overrides the fee. It prints as a PDF fee proposal on MeLiNS letterhead with a proposed payment schedule.
- **Job costing** (finance-restricted): **fee − (staff time at frozen cost rates + sublet + hire + travel and per diems + BD fees + materials + site labour + plant + other direct costs) = job margin**, in GHS and %. Committed and incurred costs are shown separately, with used vs. budget by role and by cost category. Goodwill jobs are costed too, so their true cost is visible.
- **Reports** (finance-restricted): margin by job, by job type and by referrer (net of BD fees and tender costs); utilisation by person and month; win rate and lost reasons; cost of winning work.

## 9. Reminders and routines

All defaults are editable in Settings. Every reminder links to its record.
- **Tax and statutory calendar** (defaults to be confirmed with the Accountant): PAYE and WHT remittance by the 15th of the following month; SSNIT Tier 1 by the 14th; SSNIT Tier 2 per the trustee's deadline; VAT return by the last working day of the following month; provisional corporate tax quarterly; annual return within four months of the year end. Remind 7 days before and on the due date. Show red when overdue.
- **Invoices:** approval requests to the Owner; chase at 7 days before due, on the due date, and at 14, 30 and 60 days overdue, with a pre-written polite reminder (email or WhatsApp text) for Admin to send.
- **Reported payments:** daily to Admin until the details are complete; to the Owner if unconfirmed after 14 days.
- **Milestones and valuations:** notify Admin when one is reached or certified. Flag any past its target date and not marked, and any reached or certified but not invoiced within 5 working days.
- **Retention:** remind 30 days before the expected release date.
- **Payments out:** approval requests to the Owner; remind Admin to pay approved items.
- **Recurring expenses:** create drafts on due dates; remind about drafts unconfirmed after 5 days.
- **Trips:** generate per diems on approval.
- **Advances:** remind the holder to retire within 7 days of the trip or purpose ending; flag to the Owner after 14 days.
- **BD fees:** notify the Owner when a confirmed client payment makes a portion due.
- **Leave:** notify the approver of new requests, remind them after 2 working days, and notify the requester of the decision. Remind staff in October of unused annual leave above the carry-over limit.
- **Payroll:** remind the Accountant to import the run by the 20th of each month (default), and the Owner to approve it.
- **Timesheets:** at 5 pm each working day, remind anyone with no hours logged that day (unless they're on approved leave or it's a public holiday). On day 3 after an unlogged day, send a final warning that the window closes tonight. From day 4, notify the Project lead of each person's missing days. From day 11, notify the Owner. The Project lead is reminded of pending approvals every Monday.
- **Pipeline:** flag leads with overdue next steps, and referrers with no contact in 60 days.
- **Compliance documents and bonds:** remind at 60 and 30 days before expiry.
- **Assets:** licence renewals and warranties 30 days ahead; assets to collect when a staff member's end date approaches; annual check in January.
- **Commitments:** remind the Owner 60 and 30 days before due; flag provision shortfalls monthly; show the final pro-rated bonus schedule for approval in November.
- **Overheads:** alert the Owner at 80% and 100% of any category's annual budget.
- **Monthly close: Admin's part** (by the 3rd working day): confirm recurring drafts; ensure every receipt, expense, payment out, per diem, advance and reimbursement for the month is entered with its document; invoice everything on "Ready to invoice"; chase unretired advances; request missing WHT certificates; answer every Queried entry.
- **Monthly close: Accountant's part** (by the 10th): upload bank and mobile money statements (Admin never handles statements, since they show balances); review all entries; confirm reported payments; reconcile every account and explain differences; confirm statutory payments and WHT remittances; prepare VAT workings; confirm provisions were moved to the reserve; close the month. The Owner is notified and reviews by the 12th. Closed months are locked.

## 10. Data entry and loading

- Start with empty tables apart from the seed data in Section 11. The Owner loads the rest via mobile forms or CSV import: open jobs, clients, referrers, unpaid invoices (as opening receivables), suppliers, open subcontract balances, agreed BD fees, accounts with opening balances, assets, compliance documents, this year's overhead budgets and annual commitments.
- A **first-log-in setup wizard** for the Owner collects everything left blank in Section 11, in order: company and tax details, accounts, tax codes, statutory arrears by type, per diem and WHT rates, bonus rule, users.
- A floating **"+ Quick add"** on every screen: lead, time entry, expense, trip, advance request, and (for permitted roles) payment received and transfer. The Owner's phone home screen shows **"+ Payment received"** prominently.

## 11. Seed data

**Staff** (each cost is the first row of the cost history, effective 1 September 2026):
- Kwasi Dadzie Ennison, Managing Director (Owner), monthly cost GHS 20,340
- Francis Austin, Senior Engineer (Project lead), GHS 7,443
- Ibrahim Commedan, CAD Technician, GHS 4,065
- Ernest Gbadago, Graduate Engineer, GHS 4,065
- Nana Poku, Civil Engineer (national service, extended), GHS 1,200
- NSP1 - Technical (national service engineer), GHS 1,200, to be named
- NSP2 - Technical (national service engineer), GHS 1,200, to be named
- NSP3 - Admin (national service, Admin role), GHS 1,200, to be named
- That makes **8 core staff**.

**Other users** (no staff cost record, no timesheets):
- Kofi Anaman, Director (view-only)
- Ransford Addai, Director (view-only)
- The external Accountant

**Settings:**
- Monthly fee target: GHS 62,500 to start. Also show a calculated target = (12 × monthly running cost + this year's annual commitments + statutory arrears to clear + desired cash buffer) ÷ 12, and let the Owner choose.
- Invoice terms 30 days. BD fee timing: After client pays. Bonus: December, pro-rated by months worked.
- Statutory arrears opening balance: about GHS 52,500 (six months), to be split by type and confirmed in the setup wizard.
- **Leave blank for the setup wizard (never guess):** tax codes and rates, MeLiNS TIN and VAT number, Tier 2 trustee, per diem and driver rates, WHT rates, bonus base and eligibility, accounts and opening balances.
- Chart of expense categories and job types as listed in Section 7. Commitment "13th-month bonus" created automatically.

## 12. Build phases and scope

**Phase A: Money and time foundations (target: live within 3-4 weeks)**
Environments, domain, branded email, auth with 2FA, roles and RLS, audit log, routes and the "No access" page; setup wizard, Settings, accounts, tax codes, categories, staff and cost history; clients; jobs (basic fields, contract mode, fee basis, construction value, retention, billing milestones, contracts register); invoices with VAT, WHT, retention, approval and gapless numbering; payments received with the logging rule and Reported → Confirmed; WHT certificates; credit notes, disputes, write-offs; expenses with review, reimbursement and rechargeables; recurring expenses; payments out with approval; transfers; reconciliation; statutory ledger with opening arrears; VAT workings; directors' current accounts and payments to directors; payments received by a director; Director (view-only) role; payroll import with checks, payroll runs and payslips (including national service allowance statements); month close; Owner Money panel, Accountant home and Admin task home; CSV import and export; backups; **timesheets**: mobile entry with retry on weak connections, approvals, the entry window with late-entry tiers (working days, public holiday calendar), frozen rate snapshots, timesheet compliance, missing-timesheet reminders; **leave**: types, entitlements, requests, approvals, balances and the who's-away calendar, with approved leave exempt from the timesheet window; **job hour budgets by role** (entered by hand in Phase A; created from quotes once the quote builder arrives in Phase B); **utilisation**; a basic Delivery panel (jobs over hours budget or past due, missing timesheets, timesheets awaiting approval, who's away); Project lead home (approvals, team hours, missing days) and Staff home (my hours, my tasks placeholder, my leave, my payslips).

**Phase B: Pipeline, time and job costing**
Referrers and contact log; leads with lost reasons, quote builder and lead-to-job conversion (quote lines then create the job's hour and cost budgets); tasks; job cost-category budgets; full Delivery panel (cost-category overruns, upcoming trips) and the Pipeline panel; suppliers and subcontract packages; hire records; trips and per diems; cash advances; BD fees; design-and-build valuations, BOQ summary, site labour sheets and materials; staff loans; job costing and reports.

**Phase C: Records, overheads and commitments**
Tender costs and bonds; compliance documents; asset register and movements; overhead budgets; prepayments; annual commitments, provisions and the 13th-month bonus (live before November); remaining reminders.

**Planned for version 2** (design the data model now so these can be added without restructuring): recharges between MeLiNS, Scharke Construction Solutions and ORBCO (a company field on relevant records); foreign currency (currency and rate already on every money record); company vehicle log; **full payroll calculation** (pay structures, PAYE bands as dated tables, automatic loan and advance deductions, run in parallel with the spreadsheet for two months before switching); e-levy and mobile money charges as a separate line.

**Out of scope:** single sign-on, Power BI, client portal, critical-path scheduling, automated bank feeds, payroll calculation in version 1 (payroll is calculated in the existing spreadsheet and imported), and tax filing. Zoho Books remains the formal ledger; the Command Centre exports invoices, receipts, expenses and tax workings in a form the Accountant can import or use.

## 13. Acceptance criteria (run on staging)

**Phase A**
1. app.themelins.com loads over HTTPS; www.themelins.com and company email are unaffected; invite and password-reset emails arrive from the MeLiNS domain.
2. Every view in Section 5 has its route. A reminder email link opens the exact record after log-in. A user opening a route they're not permitted to see gets "No access", and the API returns nothing.
3. The Owner, Directors and Accountant can't log in without 2FA.
4. Logged in as Admin, no screen and no direct API query returns any account balance, total, reconciliation, cash figure, salary, cost rate, margin, bonus, commitment, director's account entry or BD fee. Admin can still post an expense to a named account and see what's outstanding per invoice.
5. Logged in as Staff, a direct API query for staff costs or another person's timesheets returns nothing.
6. An invoice drafted by Admin can't be sent until approved; it receives the next number in the sequence only on approval, and invoice numbers have no gaps.
7. VAT and levies on an invoice match the tax code in force on the invoice date; changing a rate later doesn't alter issued invoices.
8. An invoice to a WHT-deducting client, settled by cash plus WHT, shows as fully Paid and creates an Expected WHT certificate, flagged if not received in 30 days.
9. On a job with 10% retention, a GHS 100,000 invoice shows GHS 10,000 retention held, and the job's retention balance and release reminder appear.
10. A payment quick-logged by the Owner shows as "payment reported", creates a task for Admin, and doesn't count in cash until the Accountant confirms it.
11. An unmatched statement credit creates a "Record this receipt" task, and the month can't close until it's recorded and confirmed.
12. With three accounts, a receipt into one, an expense from another and a transfer between them update the right balances; the transfer doesn't change total cash.
13. A reconciliation with a GHS 45 difference can't be closed until it's explained or adjusted.
14. An expense entered by Admin is Recorded until the Accountant Reviews or Queries it; the month can't close while it's unreviewed.
15. A supplier payment can't be marked Paid until the Owner approves it, and can't exceed the approved balance.
16. An out-of-pocket expense moves Owed → Approved → Reimbursed and can't be reimbursed twice. A rechargeable expense is offered on the job's next invoice and can't be billed twice.
17. Statutory arrears show separately for PAYE, SSNIT Tier 1 and SSNIT Tier 2, each with its payee and due date, and an unpaid line turns red after its due date.
18. The monthly VAT workings equal output VAT less credit notes, minus claimable input VAT.
19. A director's loan increases the account balance and "company owes director" without counting as income.
20. A payroll CSV with a missing staff member, or a line where gross − deductions ≠ net, can't be approved. A correct run, once approved, creates the PAYE and SSNIT Tier 1 and Tier 2 lines, records staff loan repayments, and issues one payslip per person.
21. A staff member sees only their own payslips at /me/payslips; opening another person's payslip link returns "No access"; issued payslips can't be edited.
22. Logged in as a Director (Kofi Anaman or Ransford Addai), every Owner route opens read-only with no action buttons, and any attempt to create, edit, approve or delete through the API is rejected. Settings, users and roles are not reachable. An area the Owner hides from Directors disappears from their views and API results.
23. A client payment of GHS 5,000 recorded as "Received by director" settles the invoice, shows GHS 5,000 owed by that director to the company, and is excluded from MeLiNS cash until the director's transfer to a MeLiNS account is recorded.
24. A director's fee paid to Kofi Anaman needs Owner approval, deducts tax at the configured rate, appears under Directors' fees and allowances, and creates the matching statutory line.
25. A closed month can't be edited; only the Owner can reopen it, and the reopening is logged.
26. The monthly running cost is calculated from payroll and recurring expenses, with any Owner override shown alongside.
27. A monthly "Cleaner" recurring expense creates a draft each month that lands under Office running → Cleaning services once confirmed.
28. Every table imports and exports CSV; the weekly backup runs and is stored outside Supabase.
29. Staff can log time on a phone in under 30 seconds, including after a failed save on a weak connection; the Project lead approves it and the job's hours vs. budget update.
30. For work done on a Monday, the staff member can log it until the end of Thursday. From Friday, their app and the API reject their own entry, and only Francis can enter it (marked Late entry, with a reason). From the 11th working day, only the Owner can. A public holiday in between extends each deadline by a day.
31. Francis's own missing day can be entered only by the Owner from day 4. Timesheet compliance shows each person's on-time %.
32. Approving 5 working days of annual leave for Ernest fills those days with Leave entries, stops timesheet reminders for them, reduces his annual balance by 5 and his utilisation target pro-rata. A public holiday inside the leave isn't counted as a leave day.
33. A request that would take someone's annual balance below zero needs Owner approval or is converted to Unpaid. Colleagues see only names and dates on the leave calendar, never the leave type or reason.
34. Changing a staff cost or the overhead share today leaves the frozen rate snapshots on already-approved timesheets unchanged (and, once job costing exists in Phase B, completed job margins).
35. A job whose logged hours for any role exceed that role's hour budget is flagged on the Delivery panel.
36. Utilisation shows each person's billable hours as a % of target, including the Owner.

**Phase B**
37. A won lead becomes a job with its referrer, value, budget lines and billing milestones; a lost lead can't be saved without a lost reason.
38. A job flags when any role's hours or any cost category exceeds its budget.
39. A GHS 10,000 subcontract paid in two instalments shows the right balance, deducts WHT at the configured rate, and rejects a payment above the balance.
40. An approved two-day overnight trip for two engineers and a hired driver generates the correct per diems at the rates in force on the trip date, unchanged if rates change later.
41. A GHS 2,000 advance retired against GHS 1,650 of receipts shows GHS 350 to refund and can't close until it's recorded.
42. A 10% After-client-pays BD fee on a GHS 50,000 job shows GHS 2,500 due after a confirmed GHS 25,000 payment, visible only to the Owner, Directors and Accountant; Upfront requires Owner approval after a cash-impact warning.
43. A design-and-build valuation of GHS 200,000 gross to date, 5% retention and GHS 120,000 previously certified shows GHS 70,000 due this valuation; once certified, it appears on "Ready to invoice".
44. A weekly site labour sheet posts its total to the job's Site labour cost.
45. The job margin includes staff time (including the Owner's), sublet, hire, per diems, BD fees, materials, labour, plant and other costs, and matches a manual calculation.
46. A GHS 3,000 staff loan repaid at GHS 500 a month shows the right balance each month and warns if the end date comes first.

**Phase C**
47. A tax clearance certificate expiring in 25 days shows on the dashboard, and a tender lead that needs it warns before submission.
48. An asset can be issued, returned and transferred with full history; a staff member's approaching end date lists assets to collect.
49. A GHS 48,000 two-year rent prepayment reduces the account by GHS 48,000 on the day, shows GHS 2,000 a month against Rent for 24 months, and creates a provisioned renewal commitment.
50. A staff member who joined on 1 July shows a 13th-month bonus of 6/12 of the base; the provision recalculates on joining, leaving or a pay change; the November schedule goes to the Owner for approval.
51. Reserved provisions and ring-fenced accounts are excluded from available cash and weeks of cover.
52. An overhead category at 80% of its annual budget alerts the Owner.

## 14. Working method

- Phase by phase, as in Section 12. Within a phase, build in this order: data model and RLS → forms and CSV import → list and detail views with routes → home screens → reminders → acceptance tests on staging → deploy to production.
- Keep PROJECT_BRIEF.md and DECISIONS.md current.
- After each phase, give a short report: what works, test results, anything that needs a decision, and what the Owner must do (e.g. set up DNS, SMTP, or data loading).

## Revision history

- 1.0: initial prompt. 1.1: locked rates, billing milestones, reimbursements, role budgets, asset register. 1.2: Netlify + Supabase with RLS. 1.3: subcontracts, hire, trips, per diems, advances, BD fees, WHT on suppliers. 1.4-1.5: accounts, commitments, 13th-month bonus, chart of categories, recurring expenses, prepayments. 1.6: VAT, client WHT, corporate tax, SSNIT tiers, rechargeables, director's account, staff loans, credit notes, tenders, compliance, contracts. 1.7: Accountant role; Admin entry-only. 1.8: client-payment logging rule.
- 2.4: timesheets, leave, public holiday calendar, job hour budgets by role, utilisation, timesheet compliance and a basic Delivery panel moved into Phase A (target now 3-4 weeks); timesheet windows confirmed as working days.
- 2.3: payroll import from the existing spreadsheet with checks, payroll runs and payslips (Phase A); leave types, entitlements, requests, approvals, balances and calendar, exempt from the timesheet window (Phase B); full payroll calculation moved to version 2.
- 2.2: timesheet entry window (own entry for 3 working days, then Project lead to day 10, then Owner only), late-entry marking, timesheet compliance, and daily reminders.
- 2.1: added the Director (view-only) role for Kofi Anaman and Ransford Addai; directors' current accounts for all three directors; payments to directors (fees, allowances, reimbursements, loan repayments, dividends); client payments received by a director; final staff list of 8 core staff (three national service persons: NSP1 and NSP2 technical, NSP3 admin).
- 2.0: clean consolidation; contradictions fixed ("finance-restricted" defined for Owner and Accountant; explicit approval flows; job delivery status separate from derived money status); added design-and-build valuations, BOQ summary, site labour and materials; retention; construction value; utilisation; lost reasons; gapless numbering; 2FA; calculated running cost; Owner logs time; staging environment; app.themelins.com with routes for every view and branded email; three build phases with acceptance tests per phase; PROJECT_BRIEF.md and DECISIONS.md.
