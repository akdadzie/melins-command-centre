-- Fixes from the Owner's staging test, 3 Oct 2026 (D-037..D-041).
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------------------
-- D-037: the reported bug. A payment quick-logged at the invoice's full
-- outstanding, then corrected to 24,000 cash + 6,000 WHT, kept a 60,000-style
-- cash allocation ("-30,000 not allocated"). Now the allocation follows.
-- ---------------------------------------------------------------------------
select tests.login('admin@t');
set role authenticated;
insert into public.invoices (job_id, invoice_date, notes, ready_for_approval)
select id, app.today(), 'alloc bug', true from public.jobs where title = 'Office block, East Legon';
insert into public.invoice_lines (invoice_id, description, tax_code_id, net_amount)
select i.id, 'Design stage', (select id from public.tax_codes where name = 'No VAT'), 60000 from public.invoices i where notes = 'alloc bug';
reset role;
select tests.login('owner@t');
set role authenticated;
update public.invoices set status = 'approved' where notes = 'alloc bug';
-- The quick-log offers the invoice's outstanding (60,000 less 10% retention = 54,000).
select public.quick_log_payment((select outstanding from public.invoices where notes = 'alloc bug'), app.today(),
                                (select id from public.invoices where notes = 'alloc bug'));
reset role;
select tests.login('admin@t');
set role authenticated;
update public.receipts set cash_amount = 24000, wht_amount = 6000,
       account_id = (select id from public.account_picker where name = 'GCB operating'), method = 'bank_transfer'
 where id = (select a.receipt_id from public.receipt_allocations a join public.invoices i on i.id = a.invoice_id where i.notes = 'alloc bug');
do $$
declare a record;
begin
  select sum(ra.cash_amount) c, sum(ra.wht_amount) w, sum(ra.vat_withheld_amount) v into a
  from public.receipt_allocations ra join public.invoices i on i.id = ra.invoice_id where i.notes = 'alloc bug';
  perform tests.eq(a.c, 24000.00, 'D-037: the allocation''s cash follows the corrected payment');
  perform tests.eq(a.w, 6000.00, 'D-037: and the WHT is allocated too');
  perform tests.eq((select outstanding from public.invoices where notes = 'alloc bug'), 24000.00,
                   'D-037: the invoice still owes 54,000 - 30,000');
end $$;
reset role;
select tests.login('acct@t');
set role authenticated;
update public.receipts set status = 'confirmed'
 where id = (select a.receipt_id from public.receipt_allocations a join public.invoices i on i.id = a.invoice_id where i.notes = 'alloc bug');
do $$ begin
  perform tests.eq((select status from public.invoices where notes = 'alloc bug'), 'part_paid', 'D-037: it confirms and the invoice is part-paid');
end $$;
reset role;

-- The quick-log never allocates more than the invoice owes.
select tests.login('owner@t');
set role authenticated;
select public.quick_log_payment(100000, app.today(), (select id from public.invoices where notes = 'alloc bug'));
do $$ begin
  perform tests.eq((select a.cash_amount from public.receipt_allocations a join public.receipts r on r.id = a.receipt_id
                    where r.cash_amount = 100000), 24000.00, 'D-037: a quick-log above what''s owed allocates only what''s owed');
end $$;
reset role;
select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.receipts set status = 'confirmed', account_id = (select id from public.accounts where name = 'GCB operating'),
                          method = 'bank_transfer' where cash_amount = 100000$q$, '%Allocate the whole payment%',
                       'D-037: it can''t be confirmed until it balances');
end $$;
update public.receipts set status = 'rejected', rejection_reason = 'Test over-payment' where cash_amount = 100000;
reset role;

-- ---------------------------------------------------------------------------
-- D-039: the invoice's letterhead and payment options
-- ---------------------------------------------------------------------------
-- The migration fills the Owner's details into the settings versions that
-- existed then (here the initial one; later test versions don't have them).
do $$ declare s public.settings_versions := (select v from public.settings_versions v order by effective_from limit 1);
begin
  perform tests.eq(s.payment_bank_account_number || ' / ' || s.payment_bank_name || ', ' || s.payment_bank_branch,
                   '0392000680010 / Prudential Bank, Taifa Branch', 'D-039: the bank details are filled in');
  perform tests.eq(s.payment_momo_account_name, 'MeLiNS Associates Limited', 'D-041: the MoMo account name');
  perform tests.ok(s.payment_momo_note like '%Kwasi Dadzie Ennison (Managing Director)%', 'D-041: with the wallet-name note');
  perform tests.eq(s.company_website, 'www.themelins.com', 'D-039: the website for the header');
  perform tests.ok(s.payment_momo_number is null and s.company_phone is null, 'D-039: the MoMo number and phone are left for the Owner (not guessed)');
end $$;
select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from (select company_phone, company_email, company_website, payment_bank_account_number,
                    payment_momo_number, payment_momo_account_name, payment_momo_note from public.company_profile) x), 1,
                   'D-039: anyone printing an invoice can read them');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- D-040: payment plans
-- ---------------------------------------------------------------------------
select tests.login('acct@t');
set role authenticated;
insert into public.statutory_lines (type, is_opening_arrears, amount_due, due_date, planned_payment_date, notes)
values ('paye', true, 5000, '2026-04-15', app.today() - 1, 'Plan A');
insert into public.statutory_lines (type, is_opening_arrears, amount_due, due_date, notes)
values ('paye', true, 9000, '2026-05-15', 'Plan B');
insert into public.statutory_plan_instalments (statutory_line_id, due_on, amount)
select id, d.due_on, 3000 from public.statutory_lines, (values (app.today() - 10), (app.today() + 7), (app.today() + 40)) d(due_on)
where notes = 'Plan B';
do $$ begin
  perform tests.eq((select missed_count from public.statutory_plans p join public.statutory_lines l on l.id = p.statutory_line_id where l.notes = 'Plan A'), 1,
                   'D-040: a planned date that has passed unpaid is flagged');
  perform tests.eq((select due_date from public.statutory_ledger where notes = 'Plan A'), '2026-04-15'::date,
                   'D-040: the original due date is kept separately');
  perform tests.eq((select first_missed_on from public.statutory_plans p join public.statutory_lines l on l.id = p.statutory_line_id where l.notes = 'Plan B'),
                   app.today() - 10, 'D-040: an unpaid instalment is missed');
end $$;
-- GRA approves setting a credit against the first instalment.
insert into public.tax_credits (authority, tax_type, description, amount, as_at) values ('GRA', 'vat', 'Plan test credit', 3000, '2026-09-30');
select public.apply_tax_credit((select id from public.tax_credits where description = 'Plan test credit'),
                               (select id from public.statutory_lines where notes = 'Plan B'), 3000, 'GRA/PLAN/1');
do $$ begin
  perform tests.eq((select missed_count from public.statutory_plans p join public.statutory_lines l on l.id = p.statutory_line_id where l.notes = 'Plan B'), 0,
                   'D-040: payments and credit count towards the instalments in date order');
  perform tests.eq((select next_due_on from public.statutory_plans p join public.statutory_lines l on l.id = p.statutory_line_id where l.notes = 'Plan B'),
                   app.today() + 7, 'D-040: the next planned payment');
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.money_panel() -> 'statutory' -> 'arrears') a
                           where a ->> 'notes' = 'Plan A' and a ->> 'plan_missed_on' = (app.today() - 1)::text),
                   'D-040: the Money panel flags the missed plan date');
end $$;
reset role;

do $$ begin
  perform app.run_daily_reminders(app.today());
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where p.email = 'acct@t' and n.kind = 'statutory_plan_due' and n.title like '%due on%'),
                   'D-040: the Accountant is reminded 7 days before a planned payment');
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where p.email = 'owner@t' and n.kind = 'statutory_plan_missed'),
                   'D-040: and the Owner is told the day after one is missed');
end $$;

-- ---------------------------------------------------------------------------
-- D-038: a WHT-deducting client with no rate set
-- ---------------------------------------------------------------------------
select tests.login('owner@t');
set role authenticated;
insert into public.clients (name, type, deducts_wht, wht_category) values ('Feeder Roads (WHT test)', 'government', true, 'works_consultancy');
insert into public.jobs (title, client_id, fee) select 'Bridge assessment', id, 60000 from public.clients where name = 'Feeder Roads (WHT test)';
insert into public.invoices (job_id, invoice_date, notes) select id, app.today(), 'wht test' from public.jobs where title = 'Bridge assessment';
insert into public.invoice_lines (invoice_id, description, tax_code_id, net_amount)
select id, 'Assessment report', (select id from public.tax_codes where name = 'No VAT'), 60000 from public.invoices where notes = 'wht test';
do $$ begin
  perform tests.eq((select wht_rate from public.invoices where notes = 'wht test'), 0::numeric,
                   'D-038: no rate for the category, so the draft has none (the screens warn)');
end $$;
insert into public.wht_rates (applies_to, category, rate, effective_from) values ('client', 'works_consultancy', 0.075, '2026-01-01');
update public.invoices set status = 'approved' where notes = 'wht test';
do $$ begin
  perform tests.eq((select expected_wht from public.invoices where notes = 'wht test'), 4500.00,
                   'D-038: a rate added before approval is used when the invoice is approved');
  perform tests.eq((select expected_net_receipt from public.invoices where notes = 'wht test'), 55500.00,
                   'D-038: and the expected net receipt is gross less WHT');
end $$;
reset role;
