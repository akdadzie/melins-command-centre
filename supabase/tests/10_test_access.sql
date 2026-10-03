-- Phase A acceptance tests: setup, 2FA, and who can see / write what.
-- Brief §13 items 3, 4, 5, 22 (plus fixtures used by later test files).
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Fixtures (as the service role)
-- ---------------------------------------------------------------------------
select tests.create_user('owner@t', 'Kwasi Dadzie Ennison', 'owner', 'Kwasi Dadzie Ennison', 'Kwasi Dadzie Ennison');
select tests.create_user('kofi@t', 'Kofi Anaman', 'director', null, 'Kofi Anaman');
select tests.create_user('ransford@t', 'Ransford Addai', 'director', null, 'Ransford Addai');
select tests.create_user('acct@t', 'The Accountant', 'accountant');
select tests.create_user('admin@t', 'NSP3 - Admin', 'admin', 'NSP3 - Admin');
select tests.create_user('francis@t', 'Francis Austin', 'project_lead', 'Francis Austin');
select tests.create_user('ernest@t', 'Ernest Gbadago', 'staff', 'Ernest Gbadago');
select tests.create_user('ibrahim@t', 'Ibrahim Commedan', 'staff', 'Ibrahim Commedan');
-- Everyone started well before the test dates.
update public.staff set start_date = '2025-01-01';

-- ---------------------------------------------------------------------------
-- Owner sets up accounts, tax codes and rates (test rates only)
-- ---------------------------------------------------------------------------
select tests.login('owner@t');
set role authenticated;

insert into public.accounts (name, type, purpose, opening_balance, opening_date, admin_may_post, last4) values
  ('GCB operating', 'bank', 'operating', 10000, '2026-01-01', true, '1234'),
  ('MTN MoMo', 'mobile_money', 'collections', 0, '2026-01-01', true, null),
  ('Petty cash', 'petty_cash', 'petty_cash', 500, '2026-01-01', true, null),
  ('Tax & bonus reserve', 'bank', 'reserve', 0, '2026-01-01', false, '9876');

-- Standard: VAT 15% on (net + NHIL + GETFund), NHIL and GETFund 2.5% on net (test values)
insert into public.tax_code_versions (tax_code_id, effective_from, vat_withholding_rate)
select id, '2026-01-01', 0.4667 from public.tax_codes where name = 'Standard';
insert into public.tax_code_components (version_id, seq, name, rate, basis, recoverable, is_vat)
select v.id, c.seq, c.name, c.rate, c.basis, c.rec, c.is_vat
from public.tax_code_versions v join public.tax_codes t on t.id = v.tax_code_id and t.name = 'Standard'
cross join (values (1, 'NHIL', 0.025, 'net', false, false), (2, 'GETFund', 0.025, 'net', false, false),
                   (3, 'VAT', 0.15, 'net_plus_prior', true, true)) c(seq, name, rate, basis, rec, is_vat);
insert into public.tax_code_versions (tax_code_id, effective_from)
select id, '2026-01-01' from public.tax_codes where name = 'No VAT';

insert into public.wht_rates (applies_to, category, rate, effective_from) values
  ('client', 'services', 0.075, '2026-01-01'),
  ('supplier', 'services', 0.075, '2026-01-01'),
  ('director_fee', 'default', 0.20, '2026-01-01'),
  ('dividend', 'default', 0.08, '2026-01-01');

insert into public.clients (name, type, deducts_wht, wht_category, is_vat_withholding_agent)
values ('Acme Estates', 'corporate', true, 'services', false),
       ('Private Client', 'private_individual', false, null, false),
       ('Ministry of Works', 'government', true, 'services', true);
insert into public.suppliers (name, type, wht_category) values ('Kojo CAD Services', 'freelance_cad', 'services');

do $$ begin
  perform tests.eq((select count(*)::int from public.accounts), 4, 'owner sees accounts');
end $$;

-- A job for later tests: Ernest and Ibrahim on Francis's team.
insert into public.jobs (title, client_id, contract_mode, fee, retention_pct, project_lead_staff_id, start_date, due_date)
select 'Office block, East Legon', c.id, 'consultancy', 100000, 10,
       (select id from public.staff where full_name = 'Francis Austin'), '2026-01-15', '2026-12-31'
from public.clients c where c.name = 'Acme Estates';
insert into public.job_team (job_id, staff_id)
select j.id, s.id from public.jobs j, public.staff s
where j.title = 'Office block, East Legon' and s.full_name in ('Ernest Gbadago', 'Ibrahim Commedan');
insert into public.job_hour_budgets (job_id, budget_role_id, hours)
select j.id, r.id, 10 from public.jobs j, public.budget_roles r
where j.title = 'Office block, East Legon' and r.name = 'Graduate Engineer';
reset role;

do $$ begin
  perform tests.ok((select job_number from public.jobs limit 1) ~ '^MEL-\d{4}-001$', 'job numbered MEL-YYYY-001');
end $$;

-- ---------------------------------------------------------------------------
-- Acceptance 3: Owner, Directors and Accountant see nothing without 2FA
-- ---------------------------------------------------------------------------
select tests.login('owner@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.accounts), 0, '3: owner without 2FA sees no accounts');
  perform tests.eq((select count(*)::int from public.clients), 0, '3: owner without 2FA sees no clients');
  perform tests.throws($q$insert into public.clients (name) values ('x')$q$, '%row-level security%', '3: owner without 2FA cannot write');
end $$;
reset role;
select tests.login('acct@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.accounts), 0, '3: accountant without 2FA sees nothing');
end $$;
reset role;
select tests.login('kofi@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.jobs), 0, '3: director without 2FA sees nothing');
end $$;
reset role;
-- Staff don't need 2FA.
select tests.login('ernest@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.my_jobs), 1, '3: staff without 2FA can work');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Acceptance 4: Admin sees no balance, total, salary, cost rate, director entry
-- ---------------------------------------------------------------------------
select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.accounts), 0, '4: admin cannot read accounts');
  perform tests.eq((select count(*)::int from public.account_balances), 0, '4: admin gets no balances');
  perform tests.eq((select count(*)::int from public.ledger_entries), 0, '4: admin cannot read the ledger');
  perform tests.eq((select count(*)::int from public.staff_cost_history), 0, '4: admin sees no staff costs');
  perform tests.eq((select count(*)::int from public.settings_versions), 0, '4: admin sees no rate build-up');
  perform tests.eq((select count(*)::int from public.receivables_ageing), 0, '4: admin gets no ageing totals');
  perform tests.eq((select count(*)::int from public.director_balances), 0, '4: admin gets no director balances');
  perform tests.eq((select count(*)::int from public.statutory_ledger), 0, '4: admin gets no statutory ledger');
  perform tests.ok(public.money_panel() is null, '4: admin gets no money panel');
  perform tests.ok((public.running_cost()).calculated is null, '4: admin gets no running cost');
  perform tests.eq((select count(*)::int from public.vat_workings(app.today())), 0, '4: admin gets no VAT workings');
  -- ... but can pick an account by name and post an expense to it.
  perform tests.eq((select count(*)::int from public.account_picker), 3, '4: admin picker lists postable accounts only');
  perform tests.ok(not exists (select 1 from public.account_picker where name = 'Tax & bonus reserve'), '4: reserve not postable by admin');
end $$;
insert into public.expenses (expense_date, category_id, description, amount, payment_source, account_id)
select app.today(), (select id from public.expense_categories where name = 'Office supplies and stationery'),
       'Printer paper', 250, 'company_account', (select id from public.account_picker where name = 'GCB operating');
do $$ begin
  perform tests.eq((select review_status::text from public.expenses where description = 'Printer paper'), 'recorded',
                   '4/14: admin expense is Recorded for review');
  perform tests.throws($q$insert into public.expenses (expense_date, category_id, description, amount, payment_source, account_id)
    select app.today(), (select id from public.expense_categories where name = 'Rent'), 'x', 1, 'company_account',
           (select id from public.account_picker limit 1) where false
    union all select app.today(), (select id from public.expense_categories where name = 'Rent'), 'x', 1, 'company_account',
           '00000000-0000-0000-0000-000000000000'::uuid$q$, '%Admin may not post to this account%', '4: admin cannot post to a non-admin account');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Acceptance 5: Staff can't read staff costs or other people's timesheets
-- ---------------------------------------------------------------------------
-- Francis logs one hour today on the job (for the check below).
select tests.login('francis@t');
set role authenticated;
insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours, description, activity_custom)
select app.my_staff_id(), app.today(), 'job', (select id from public.jobs limit 1), 1, 'Design review', 'Test activity';
reset role;

select tests.login('ernest@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.staff_cost_history), 0, '5: staff sees no staff costs');
  perform tests.eq((select count(*)::int from public.timesheet_entries where staff_id <> app.my_staff_id()), 0,
                   '5: staff sees no one else''s timesheets');
  perform tests.eq((select count(*)::int from public.jobs), 0, '5: staff cannot read the jobs table (fees)');
  perform tests.eq((select count(*)::int from public.my_jobs), 1, '5: staff sees own job via my_jobs');
  perform tests.eq((select count(*)::int from public.invoices), 0, '5: staff sees no invoices');
  perform tests.eq((select count(*)::int from public.expenses), 0, '5: staff sees no one else''s expenses');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Acceptance 22: Directors read everything, write nothing; hidden areas vanish
-- ---------------------------------------------------------------------------
select tests.login('kofi@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.accounts), 4, '22: director reads accounts');
  perform tests.eq((select count(*)::int from public.staff_cost_history), 8, '22: director reads staff costs by default');
  perform tests.ok(public.money_panel() is not null, '22: director sees the money panel');
  perform tests.throws($q$insert into public.clients (name) values ('Director client')$q$, '%', '22: director cannot create');
  perform tests.eq(tests.rows($q$update public.clients set notes = 'x'$q$), 0, '22: director edit changes nothing');
  perform tests.eq(tests.rows($q$delete from public.expenses$q$), 0, '22: director delete changes nothing');
  perform tests.eq(tests.rows($q$update public.expenses set review_status = 'reviewed'$q$), 0, '22: director cannot review');
  perform tests.eq(tests.rows($q$update public.invoices set status = 'approved'$q$), 0, '22: director cannot approve');
  perform tests.throws($q$select public.close_month(app.today())$q$, '%', '22: director cannot close a month');
  perform tests.eq(tests.rows($q$update public.director_hidden_areas set hidden = true$q$), 0, '22: director cannot change settings');
end $$;
-- Even with a write policy mistake, the trigger blocks Directors:
do $$ begin
  perform tests.eq((select count(*)::int from public.settings_versions), 1, '22: director reads settings values');
end $$;
reset role;
do $$ begin
  -- simulate a wrongly-written policy: director tries through a table whose policy allowed it
  perform tests.throws($q$
    select set_config('request.jwt.claims', json_build_object('sub', tests.uid('kofi@t'), 'aal', 'aal2')::text, true);
    insert into public.clients (name) values ('bypass')$q$, '%read-only%', '22: director write block trigger fires even as superuser session');
end $$;

-- Owner hides salaries and staff costs from Directors.
select tests.login('owner@t');
set role authenticated;
update public.director_hidden_areas set hidden = true where area in ('salaries', 'staff_costs');
reset role;
select tests.login('kofi@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.staff_cost_history), 0, '22: hidden staff costs disappear for director');
  perform tests.eq((select count(*)::int from public.accounts), 4, '22: other areas still visible');
end $$;
reset role;
select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.staff_cost_history), 8, '22: hiding does not affect the accountant');
end $$;
reset role;
select tests.login('owner@t');
set role authenticated;
update public.director_hidden_areas set hidden = false;
reset role;
select set_config('request.jwt.claims', '', false);
