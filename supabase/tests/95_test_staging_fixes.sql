-- Fixes from the Owner's staging test, 3 Oct 2026 (D-032..D-036).
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------------------
-- D-032: the opening VAT credit offsets later VAT returns automatically
-- ---------------------------------------------------------------------------
select tests.login('acct@t');
set role authenticated;
insert into public.tax_credits (authority, tax_type, description, amount, as_at, auto_offset_type, notes)
values ('GRA', 'vat', 'VAT overpaid', 9482.80, '2026-09-30', 'vat', 'Per the September VAT return');
insert into public.statutory_lines (type, period_start, amount_due) values ('vat', '2026-10-01', 3000.00);
insert into public.statutory_lines (type, period_start, amount_due) values ('vat', '2026-11-01', 8000.00);
do $$ begin
  perform tests.eq((select outstanding from public.statutory_ledger where type = 'vat' and period_start = '2026-10-01'), 0.00,
                   'D-032: October''s VAT is covered by the credit');
  perform tests.eq((select status from public.statutory_ledger where type = 'vat' and period_start = '2026-10-01'), 'paid',
                   'D-032: and shows as settled');
  perform tests.eq((select outstanding from public.statutory_ledger where type = 'vat' and period_start = '2026-11-01'), 1517.20,
                   'D-032: November uses the rest (8,000 - 6,482.80)');
  perform tests.eq((select remaining from public.tax_credit_balances where description = 'VAT overpaid'), 0.00,
                   'D-032: the credit is used up, oldest return first');
  perform tests.eq((select amount_paid from public.statutory_ledger where type = 'vat' and period_start = '2026-10-01'), 0.00,
                   'D-032: no cash counted as paid');
end $$;
-- A correction to October's figure re-works the offsets on later returns by itself.
update public.statutory_lines set amount_due = 2000 where type = 'vat' and period_start = '2026-10-01';
do $$ begin
  perform tests.eq((select outstanding from public.statutory_ledger where type = 'vat' and period_start = '2026-11-01'), 517.20,
                   'D-032: a lower October return leaves more credit for November');
end $$;

-- A second credit, applied to PAYE arrears once GRA approves.
insert into public.tax_credits (authority, tax_type, description, amount, as_at, auto_offset_type)
values ('GRA', 'vat', 'Refund agreed', 1000, '2026-09-30', null);
insert into public.statutory_lines (type, is_opening_arrears, amount_due, notes) values ('paye', true, 5000, 'PAYE Apr to Sep 2026');
insert into public.statutory_lines (type, is_opening_arrears, amount_due, notes)
values ('ssnit_tier2', true, 45000, 'Estimate, awaiting trustee statement');
do $$
declare
  credit uuid := (select id from public.tax_credits where description = 'Refund agreed');
  paye uuid := (select id from public.statutory_lines where notes = 'PAYE Apr to Sep 2026');
  tier2 uuid := (select id from public.statutory_lines where notes like 'Estimate%');
begin
  perform tests.throws(format($q$select public.apply_tax_credit(%L, %L, 400, '')$q$, credit, paye), '%GRA''s reference%',
                       'D-032: an offset needs GRA''s reference');
  perform tests.throws(format($q$select public.apply_tax_credit(%L, %L, 400, 'GRA/OFF/1')$q$, credit, tier2), '%payable to GRA%',
                       'D-032: a GRA credit can''t pay SSNIT Tier 2');
  perform tests.throws(format($q$select public.apply_tax_credit(%L, %L, 1500, 'GRA/OFF/1')$q$, credit, paye), '%left%',
                       'D-032: no more than the credit has left');
  perform public.apply_tax_credit(credit, paye, 1000, 'GRA/OFF/1', 'Offset agreed by letter');
  perform tests.eq((select outstanding from public.statutory_ledger where id = paye), 4000.00, 'D-032: PAYE arrears reduced by the offset');
  perform tests.eq((select credit_applied from public.statutory_ledger where id = paye), 1000.00, 'D-032: the ledger shows the credit applied');
  perform tests.ok(exists (select 1 from public.audit_log where table_name = 'tax_credit_applications'), 'D-032: offsets are in the audit log');
  -- D-036: the arrears note travels with the figure.
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.money_panel() -> 'statutory' -> 'arrears') a
                           where a ->> 'notes' = 'Estimate, awaiting trustee statement' and (a ->> 'outstanding')::numeric = 45000),
                   'D-036: the Money panel shows the arrears line with its note');
  perform tests.eq((select count(*)::int from jsonb_array_elements(public.money_panel() -> 'statutory' -> 'credits')), 0,
                   'D-032: used-up credits drop off the Money panel');
end $$;
reset role;

select tests.login('owner@t');
set role authenticated;
insert into public.tax_credits (authority, tax_type, description, amount, as_at, auto_offset_type)
values ('GRA', 'wht', 'WHT overpaid', 250, '2026-09-30', null);
do $$ begin
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.money_panel() -> 'statutory' -> 'credits') c
                           where (c ->> 'remaining')::numeric = 250), 'D-032: an unused credit shows in the Money panel');
  perform tests.ok((public.money_panel() -> 'accounts' -> 0) ? 'opening_date', 'D-033: the Money panel knows each account''s opening date');
end $$;
reset role;

select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.tax_credits), 0, 'acceptance 4: Admin sees no tax credits');
  perform tests.throws($q$select public.apply_tax_credit(gen_random_uuid(), gen_random_uuid(), 1, 'x')$q$, '%Only the Owner or the Accountant%',
                       'D-032: Admin cannot apply a credit');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- D-033: an account opened this month isn't due for last month's reconciliation
-- ---------------------------------------------------------------------------
select tests.login('acct@t');
set role authenticated;
do $$ begin perform set_config('tests.unrec', (public.accountant_queue() ->> 'unreconciled_accounts'), false); end $$;
insert into public.accounts (name, type, purpose, opening_balance, opening_date)
values ('Opened this month', 'bank', 'operating', 100, date_trunc('month', app.today())::date);
do $$ begin
  perform tests.eq((public.accountant_queue() ->> 'unreconciled_accounts')::int, current_setting('tests.unrec')::int,
                   'D-033: an account opened this month is not asked for last month''s reconciliation');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- D-034: nothing before go-live counts
-- ---------------------------------------------------------------------------
update app.system_config set go_live_date = app.today();
select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.missing_timesheet_days(app.today() - 30, app.today() - 1)), 0,
                   'D-034: no missing days before go-live');
  perform tests.ok(not exists (select 1 from public.timesheet_compliance(app.today() - 30, app.today() - 1) where working_days > 0),
                   'D-034: compliance counts no days before go-live');
  perform tests.ok(not exists (select 1 from public.utilisation(app.today() - 90, app.today()) where month < date_trunc('month', app.today())),
                   'D-034: utilisation starts at the go-live month');
end $$;
reset role;
update app.system_config set go_live_date = '2025-01-01';
