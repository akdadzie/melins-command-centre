-- The Owner's answers of 2 Oct 2026: cost to company (D-027) and the Owner
-- confirming client payments as the Accountant's backup (D-028).
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------------------
-- D-027: cost to company = gross + employer SSNIT + employer PF
-- ---------------------------------------------------------------------------
select tests.login('acct@t');
set role authenticated;
insert into public.payroll_runs (period_month, source_files) values ('2027-01-01', '["test.csv"]');
-- Francis's May 2026 line: gross 6,955.00, employer SSF 487.50, sheet 7,442.50.
-- Here with 40.00 of post-tax allowances and, on a second person, employer PF.
insert into public.payroll_lines (run_id, staff_id, sheet_kind, basic, gross, ssnit_employee, taxable_income, paye,
                                  post_tax_allowances, net_pay, bank_amount, ssnit_employer, pf_employer, sheet_cost_to_company)
select r.id, s.id, 'staff', v.basic, v.gross, 0, v.gross, 0, 40, v.gross + 40, v.gross + 40, v.er, v.pf, v.sheet
from public.payroll_runs r
cross join (values ('Francis Austin', 3750, 6955.00, 487.50, 0, 7442.50),
                   ('Ernest Gbadago', 2000, 3805.00, 260.00, 100, 4065.00)) v(name, basic, gross, er, pf, sheet)
join public.staff s on s.full_name = v.name
where r.period_month = '2027-01-01';
do $$
declare run uuid := (select id from public.payroll_runs where period_month = '2027-01-01');
begin
  perform tests.eq((select full_cost_to_company from public.payroll_lines l join public.staff s on s.id = l.staff_id
                    where l.run_id = run and s.full_name = 'Francis Austin'), 7442.50,
                   'D-027: Francis = gross + employer SSNIT = the sheet''s 7,442.50 (post-tax allowances left out)');
  perform tests.eq((select full_cost_to_company from public.payroll_lines l join public.staff s on s.id = l.staff_id
                    where l.run_id = run and s.full_name = 'Ernest Gbadago'), 4165.00,
                   'D-027: employer PF is included');
  perform tests.ok(exists (select 1 from public.payroll_checks(run) where code = 'sheet_cost_differs' and staff_name = 'Ernest Gbadago'),
                   'D-027: a sheet figure without employer PF is flagged');
  perform tests.ok(not exists (select 1 from public.payroll_checks(run) where code = 'sheet_cost_differs' and staff_name = 'Francis Austin'),
                   'D-027: a matching sheet figure is not flagged');
end $$;
delete from public.payroll_runs where period_month = '2027-01-01';
reset role;

-- ---------------------------------------------------------------------------
-- D-028: the Owner confirms a payment as the Accountant's backup
-- ---------------------------------------------------------------------------
select tests.login('admin@t');
set role authenticated;
insert into public.invoices (job_id, invoice_date, notes, ready_for_approval)
select id, app.today(), 'backup confirm', true from public.jobs where title = 'Office block, East Legon';
insert into public.invoice_lines (invoice_id, description, tax_code_id, net_amount)
select i.id, 'Site visit', (select id from public.tax_codes where name = 'No VAT'), 2000
from public.invoices i where notes = 'backup confirm';
reset role;

select tests.login('owner@t');
set role authenticated;
update public.invoices set status = 'approved' where notes = 'backup confirm';
select public.quick_log_payment(1000, app.today(), (select id from public.invoices where notes = 'backup confirm'));
select public.quick_log_payment(800, app.today(), (select id from public.invoices where notes = 'backup confirm'));
update public.receipts set account_id = (select id from public.accounts where name = 'GCB operating'), method = 'bank_transfer'
where status = 'reported' and cash_amount in (1000, 800);
do $$ begin
  perform set_config('tests.gcb_before', app.account_balance((select id from public.accounts where name = 'GCB operating'))::text, false);
end $$;
update public.receipts set status = 'confirmed' where cash_amount in (1000, 800) and status = 'reported';
do $$
declare gcb uuid := (select id from public.accounts where name = 'GCB operating');
begin
  perform tests.eq((select count(*)::int from public.receipts where cash_amount in (1000, 800) and status = 'confirmed'
                    and review_status = 'recorded' and confirmed_by = auth.uid()), 2,
                   'D-028: the Owner can confirm; the payment waits for the Accountant''s review');
  perform tests.eq(app.account_balance(gcb), current_setting('tests.gcb_before')::numeric + 1800,
                   'D-028: an Owner-confirmed payment counts as cash');
  perform tests.ok(exists (select 1 from public.month_close_blockers(app.today())
                           where record_type = 'receipts' and kind = 'unreviewed_entry'),
                   'D-028: it blocks month close until reviewed');
  perform tests.ok(exists (select 1 from public.audit_log where table_name = 'receipts'
                           and new_data ->> 'status' = 'confirmed' and new_data ->> 'confirmed_by' = auth.uid()::text),
                   'D-028: the confirmation is in the audit log');
  perform tests.throws($q$update public.receipts set review_status = 'reviewed' where cash_amount = 1000$q$,
                       '%Only the Accountant reviews%', 'D-028: the Owner cannot review it');
end $$;
reset role;

select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.notifications where kind = 'owner_confirmed_payment'), 2,
                   'D-028: the Accountant is told');
  perform tests.eq((public.accountant_queue() ->> 'owner_confirmed_payments')::int, 2, 'D-028: on the Accountant''s queue');
  perform tests.throws($q$update public.receipts set review_status = 'reviewed', cash_amount = 1 where cash_amount = 1000$q$,
                       '%without changing it%', 'D-028: review does not change the payment');
  perform tests.throws($q$update public.receipts set status = 'reported' where cash_amount = 800$q$,
                       '%Say why%', 'D-028: sending back needs a reason');
end $$;
update public.receipts set review_status = 'reviewed' where cash_amount = 1000 and status = 'confirmed';
update public.receipts set status = 'reported', review_note = 'Not on the GCB statement' where cash_amount = 800 and status = 'confirmed';
do $$
declare gcb uuid := (select id from public.accounts where name = 'GCB operating');
begin
  perform tests.eq((select review_status from public.receipts where cash_amount = 1000 and receipt_date = app.today()), 'reviewed',
                   'D-028: the Accountant reviews it');
  perform tests.eq((select status from public.receipts where cash_amount = 800 and receipt_date = app.today()), 'reported',
                   'D-028: or sends it back to Reported');
  perform tests.eq(app.account_balance(gcb), current_setting('tests.gcb_before')::numeric + 1000,
                   'D-028: a payment sent back leaves cash');
  perform tests.ok(not exists (select 1 from public.month_close_blockers(app.today())
                               where record_type = 'receipts' and kind = 'unreviewed_entry'),
                   'D-028: nothing left to review');
  perform tests.throws($q$update public.receipts set status = 'reported', review_note = 'x' where cash_amount = 1000$q$,
                       '%Only the Accountant can send back%', 'D-028: a reviewed payment cannot be sent back');
end $$;
-- An Accountant confirmation needs no review.
update public.receipts set status = 'confirmed' where cash_amount = 800 and status = 'reported';
do $$ begin
  perform tests.eq((select review_status from public.receipts where cash_amount = 800 and receipt_date = app.today()), 'not_required',
                   'D-028: the Accountant''s own confirmation needs no review');
end $$;
reset role;

select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.notifications where kind = 'payment_sent_back'), 1,
                   'D-028: the Owner is told when a payment is sent back');
end $$;
reset role;

