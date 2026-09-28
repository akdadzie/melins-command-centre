-- Phase A acceptance tests: money out, statutory, VAT, directors.
-- Brief §13 items 15, 16, 17, 18, 19, 24, 26, 27; D-010.
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------------------
-- 15: supplier payment needs Owner approval and can't exceed what's owed
-- ---------------------------------------------------------------------------
select tests.login('admin@t');
set role authenticated;
insert into public.expenses (expense_date, category_id, job_id, supplier_id, description, amount, payment_source)
select app.today(), (select id from public.expense_categories where name = 'Sublet work'),
       (select id from public.jobs where title = 'Office block, East Legon'),
       (select id from public.suppliers where name = 'Kojo CAD Services'), 'CAD drafting, drawings set A', 2000, 'supplier_payable';
insert into public.payments_out (supplier_id, description)
select id, 'Kojo CAD for set A' from public.suppliers where name = 'Kojo CAD Services';
do $$ begin
  perform tests.throws($q$insert into public.payment_out_items (payment_out_id, expense_id, amount)
    select p.id, e.id, 2500 from public.payments_out p, public.expenses e where e.description like 'CAD drafting%'$q$,
    '%more than is owed%', '15: cannot pay more than the bill');
end $$;
insert into public.payment_out_items (payment_out_id, expense_id, amount)
select p.id, e.id, 2000 from public.payments_out p, public.expenses e where e.description like 'CAD drafting%';
do $$ begin
  perform tests.eq((select gross_amount from public.payments_out), 2000.00, '15: payment gross = bills settled');
  perform tests.eq((select wht_amount from public.payments_out), 150.00, '15: WHT deducted at the supplier category rate (7.5%)');
  perform tests.eq((select net_amount from public.payments_out), 1850.00, '15: net paid');
  perform tests.throws($q$update public.payments_out set status = 'paid', payment_date = app.today(),
      account_id = (select id from public.account_picker where name = 'GCB operating')$q$,
    '%cannot move from prepared to paid%', '15: cannot be marked Paid before Owner approval');
  perform tests.throws($q$update public.payments_out set status = 'approved'$q$, '%Only the Owner approves%', '15: admin cannot approve');
end $$;
reset role;
select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.payments_out set status = 'approved'$q$, '%Only the Owner approves%', '15: accountant cannot approve payments out');
end $$;
reset role;
select tests.login('owner@t');
set role authenticated;
update public.payments_out set status = 'approved';
reset role;
do $$ begin
  perform tests.eq((select count(*)::int from public.action_items where kind = 'pay_approved' and status = 'open'), 1, '15: admin gets a "pay" task');
end $$;
select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.payment_out_items set amount = 1000$q$, '%fixed%', '15: approved amounts are fixed');
end $$;
update public.payments_out set status = 'paid', payment_date = app.today(), reference = 'CHQ 001', method = 'cheque',
  account_id = (select id from public.account_picker where name = 'GCB operating');
do $$ begin
  perform tests.throws($q$update public.payments_out set reference = 'changed'$q$, '%locked%', '15: paid payment is locked');
  perform tests.eq((select outstanding from public.supplier_bills_open), null::numeric, '15: bill no longer open');
end $$;
reset role;
do $$ begin
  perform tests.eq((select amount_due from public.statutory_lines where type = 'wht_remittance'), 150.00, '15: WHT deducted goes to this month''s remittance line');
  perform tests.eq((select amount from public.ledger_entries where source_type = 'payment_out'), -1850.00, '15: net paid leaves the account');
end $$;

-- ---------------------------------------------------------------------------
-- 16: out-of-pocket Owed -> Approved -> Reimbursed, never twice; recharges once
-- ---------------------------------------------------------------------------
select tests.login('ernest@t');
set role authenticated;
insert into public.expenses (expense_date, category_id, job_id, description, amount, payment_source, staff_id,
                             rechargeable, recharge_markup_pct)
select app.today(), (select id from public.expense_categories where name = 'Testing and lab fees'),
       (select id from public.my_jobs where title = 'Office block, East Legon'), 'Concrete cube tests', 600,
       'staff_out_of_pocket', app.my_staff_id(), true, 10;
do $$ begin
  perform tests.eq((select reimbursement_status from public.expenses where description = 'Concrete cube tests'), 'owed', '16: claim starts Owed');
  perform tests.throws($q$update public.expenses set reimbursement_status = 'approved' where description = 'Concrete cube tests'$q$,
    '%not this person''s approver%', '16: cannot approve own claim');
  perform tests.throws($q$insert into public.expenses (expense_date, category_id, description, amount, payment_source, account_id)
    select app.today(), (select id from public.expense_categories where name = 'Rent'), 'x', 1, 'company_account', null$q$,
    '%own out-of-pocket%', '16: staff can only claim their own out-of-pocket expenses');
end $$;
reset role;
select tests.login('francis@t');
set role authenticated;
update public.expenses set reimbursement_status = 'approved' where description = 'Concrete cube tests';
reset role;
select tests.login('admin@t');
set role authenticated;
insert into public.staff_payments (staff_id) select staff_id from public.expenses where description = 'Concrete cube tests';
update public.expenses set staff_payment_id = (select id from public.staff_payments) where description = 'Concrete cube tests';
do $$ begin
  perform tests.eq((select amount from public.staff_payments), 600.00, '16: reimbursement = approved claim');
end $$;
reset role;
select tests.login('owner@t');
set role authenticated;
update public.staff_payments set status = 'approved';
reset role;
select tests.login('admin@t');
set role authenticated;
update public.staff_payments set status = 'paid', payment_date = app.today(), method = 'mobile_money',
  account_id = (select id from public.account_picker where name = 'MTN MoMo');
insert into public.staff_payments (staff_id) select staff_id from public.expenses where description = 'Concrete cube tests';
do $$ begin
  perform tests.eq((select reimbursement_status from public.expenses where description = 'Concrete cube tests'), 'reimbursed', '16: claim Reimbursed when paid');
  perform tests.throws($q$update public.expenses set staff_payment_id = (select id from public.staff_payments where status = 'prepared')
    where description = 'Concrete cube tests'$q$, '%', '16: cannot be reimbursed twice');
end $$;
-- Recharge once: offered on the next invoice, then not again.
insert into public.invoices (job_id, invoice_date, notes)
select id, app.today(), 'recharge' from public.jobs where title = 'Office block, East Legon';
do $$ begin
  perform tests.eq((select count(*)::int from public.ready_to_invoice where item_type = 'rechargeable_expense'), 1, '16: rechargeable expense offered for invoicing');
end $$;
insert into public.invoice_lines (invoice_id, line_type, description, expense_id, net_amount)
select i.id, 'rechargeable_expense', 'Recharge: concrete cube tests', e.id, null
from public.invoices i, public.expenses e where i.notes = 'recharge' and e.description = 'Concrete cube tests';
do $$ begin
  perform tests.eq((select net_amount from public.invoice_lines where line_type = 'rechargeable_expense'), 660.00, '16: recharged at cost + 10% markup');
  perform tests.throws($q$insert into public.invoice_lines (invoice_id, line_type, description, expense_id, net_amount)
    select i.id, 'rechargeable_expense', 'again', e.id, null from public.invoices i, public.expenses e
    where i.notes = 'recharge' and e.description = 'Concrete cube tests'$q$, '%duplicate key%', '16: cannot be billed twice');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- D-010: the Owner's own reimbursement is flagged to Directors and reviewed
-- ---------------------------------------------------------------------------
select tests.login('owner@t');
set role authenticated;
insert into public.expenses (expense_date, category_id, description, amount, payment_source, staff_id)
select app.today(), (select id from public.expense_categories where name = 'Fuel'), 'Fuel to client meeting', 300,
       'staff_out_of_pocket', app.my_staff_id();
update public.expenses set reimbursement_status = 'approved' where description = 'Fuel to client meeting';
reset role;
select tests.login('acct@t');
set role authenticated;
insert into public.staff_payments (staff_id) select staff_id from public.expenses where description = 'Fuel to client meeting';
update public.expenses set staff_payment_id = (select id from public.staff_payments where is_to_owner)
where description = 'Fuel to client meeting';
reset role;
select tests.login('owner@t');
set role authenticated;
update public.staff_payments set status = 'approved' where is_to_owner;
reset role;
do $$ begin
  perform tests.eq((select review_status::text from public.staff_payments where is_to_owner), 'recorded',
                   'D-010: payment to the Owner needs Accountant review even when the Accountant prepared it');
  perform tests.eq((select count(distinct recipient_id)::int from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                    where n.kind = 'payment_to_owner' and p.role = 'director'), 2, 'D-010: both Directors notified');
end $$;

-- ---------------------------------------------------------------------------
-- 17: statutory arrears by type, with payee and due date; red when overdue
-- ---------------------------------------------------------------------------
select tests.login('acct@t');
set role authenticated;
insert into public.statutory_lines (type, amount_due, is_opening_arrears, notes, period_start) values
  ('paye', 30000, true, 'Opening arrears', null),
  ('ssnit_tier1', 15000, true, 'Opening arrears', null),
  ('ssnit_tier2', 7500, true, 'Opening arrears', null);
insert into public.statutory_lines (type, period_start, amount_due) values
  ('paye', (date_trunc('month', app.today()) - interval '2 months')::date, 1000),
  ('paye', date_trunc('month', app.today())::date, 1000);
do $$ begin
  perform tests.eq((select count(distinct type)::int from public.statutory_ledger where is_opening_arrears and status = 'overdue'), 3,
                   '17: arrears separate for PAYE, Tier 1, Tier 2');
  perform tests.eq((select payee from public.statutory_ledger where is_opening_arrears and type = 'ssnit_tier1'), 'SSNIT', '17: each has its payee');
  perform tests.eq((select status from public.statutory_ledger where not is_opening_arrears and type = 'paye'
                    and period_start < date_trunc('month', app.today()) - interval '1 month'), 'overdue', '17: unpaid past its due date turns red');
  perform tests.eq((select status from public.statutory_ledger where not is_opening_arrears and type = 'paye'
                    and period_start = date_trunc('month', app.today())), 'due', '17: this month''s line is not yet overdue');
  perform tests.eq((select due_date from public.statutory_ledger where not is_opening_arrears and type = 'paye'
                    and period_start = date_trunc('month', app.today())),
                   (date_trunc('month', app.today()) + interval '1 month' + interval '14 days')::date, '17: PAYE due on the 15th of the next month');
end $$;
-- D-016: Accountant prepares a statutory payment, Owner approves, then paid.
insert into public.statutory_payments (statutory_line_id, amount)
select id, 5000 from public.statutory_lines where type = 'paye' and is_opening_arrears;
do $$ begin
  perform tests.throws($q$update public.statutory_payments set status = 'approved'$q$, '%Only the Owner%', 'D-016: accountant cannot approve');
end $$;
reset role;
select tests.login('owner@t');
set role authenticated;
update public.statutory_payments set status = 'approved';
reset role;
select tests.login('acct@t');
set role authenticated;
update public.statutory_payments set status = 'paid', payment_date = app.today(), reference = 'GRA-REC-1',
  account_id = (select id from public.accounts where name = 'GCB operating');
do $$ begin
  perform tests.eq((select outstanding from public.statutory_ledger where is_opening_arrears and type = 'paye'), 25000.00, 'D-016: paid amount reduces the arrears');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 18: VAT workings = output VAT - credit notes - claimable input VAT
-- ---------------------------------------------------------------------------
select tests.login('owner@t');
set role authenticated;
-- Standard is now VAT 20% only (new version from test 7).
insert into public.invoices (job_id, invoice_date, notes)
select id, app.today(), 'vat-test' from public.jobs where title = 'Office block, East Legon';
insert into public.invoice_lines (invoice_id, description, tax_code_id, net_amount)
select id, 'Stage 2 design fee', (select id from public.tax_codes where name = 'Standard'), 20000
from public.invoices where notes = 'vat-test';
update public.invoices set status = 'approved' where notes = 'vat-test';
insert into public.credit_notes (invoice_id, reason, tax_code_id, net_amount)
select id, 'Scope reduced', (select id from public.tax_codes where name = 'Standard'), 5000 from public.invoices where notes = 'vat-test';
update public.credit_notes set status = 'approved';
insert into public.expenses (expense_date, category_id, description, amount, payment_source, account_id,
                             tax_code_id, has_valid_vat_invoice)
select app.today(), (select id from public.expense_categories where name = 'Software licences and subscriptions'),
       'Structural analysis software', 1200, 'company_account', (select id from public.accounts where name = 'GCB operating'),
       (select id from public.tax_codes where name = 'Standard'), true;
insert into public.expenses (expense_date, category_id, description, amount, payment_source, account_id,
                             tax_code_id, has_valid_vat_invoice)
select app.today(), (select id from public.expense_categories where name = 'Printing and plotting'),
       'Plotting, no VAT invoice', 600, 'company_account', (select id from public.accounts where name = 'GCB operating'),
       (select id from public.tax_codes where name = 'Standard'), false;
reset role;
do $$
declare v record;
begin
  perform tests.eq((select cn_number from public.credit_notes) ~ '^CN-\d{4}-001$', true, '18: credit note numbered on approval');
  perform tests.eq((select credited_total from public.invoices where notes = 'vat-test'), 6000.00, '18: credit note reduces the invoice');
  select * into v from public.vat_workings(app.today()) where component = 'VAT';
  -- output: 15,750 (INV-001, old rates) + 4,000 (vat-test); credit: 1,000; input: 200 (only the valid VAT invoice)
  perform tests.eq(v.output_tax, 19750.00, '18: output VAT');
  perform tests.eq(v.credit_notes, 1000.00, '18: less credit notes');
  perform tests.eq(v.input_claimable, 200.00, '18: claimable input VAT only with a valid VAT invoice');
  perform tests.eq(v.net_payable, 18550.00, '18: net VAT payable');
  perform tests.eq((select sum(output_tax) from public.vat_workings(app.today()) where component in ('NHIL', 'GETFund')), 5000.00,
                   '18: levies reported separately');
end $$;
select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.expenses set amount = 1 where description = 'Concrete cube tests'$q$, '%', '16: reimbursed expense is locked');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 19: a director's loan raises cash and "company owes director", not income
-- ---------------------------------------------------------------------------
select tests.login('acct@t');
set role authenticated;
insert into public.director_transactions (director_id, txn_date, type, amount, account_id, description)
select (select id from public.directors where full_name = 'Ransford Addai'), app.today(), 'loan_in', 20000,
       (select id from public.accounts where name = 'GCB operating'), 'Short-term loan for cash flow';
reset role;
do $$
declare
  r uuid := (select id from public.directors where full_name = 'Ransford Addai');
begin
  perform tests.eq(app.director_balance(r), 20000.00, '19: company owes the director 20,000');
  perform tests.eq((select amount from public.ledger_entries where source_type = 'director_txn' and account_id is not null), 20000.00,
                   '19: account balance increases');
  perform tests.eq(((public.monthly_summary(app.today())) ->> 'fees_received')::numeric
                   - (select coalesce(sum(cash_amount), 0) from public.receipts where status = 'confirmed' and receipt_date >= date_trunc('month', app.today())),
                   0::numeric, '19: not counted as fees received') where false;
end $$;
select tests.login('ransford@t');
set role authenticated;
do $$ begin
  perform tests.eq((select balance from public.director_balances where full_name = 'Ransford Addai'), 20000.00, '19: director sees own balance');
end $$;
reset role;
select tests.login('owner@t');
set role authenticated;
update public.director_hidden_areas set hidden = true where area = 'other_director_accounts';
reset role;
select tests.login('ransford@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.director_balances), 1, 'D-017: other directors'' accounts hidden, own still visible');
  perform tests.eq((select count(*)::int from public.director_transactions), 1, 'D-017: own entries visible');
end $$;
reset role;
select tests.login('kofi@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.director_transactions), 0, 'D-017: another director''s entries hidden');
end $$;
reset role;
select set_config('request.jwt.claims', '', false);
update public.director_hidden_areas set hidden = false;

-- ---------------------------------------------------------------------------
-- 24: director's fee to Kofi: Owner approval, tax deducted, category, statutory line
-- ---------------------------------------------------------------------------
select tests.login('acct@t');
set role authenticated;
insert into public.director_payments (director_id, payment_type, gross_amount)
select id, 'fee_or_allowance', 5000 from public.directors where full_name = 'Kofi Anaman';
do $$ begin
  perform tests.eq((select tax_amount from public.director_payments), 1000.00, '24: tax deducted at the configured rate (20%)');
  perform tests.eq((select c.name from public.director_payments p join public.expense_categories c on c.id = p.category_id),
                   'Directors'' fees and allowances', '24: appears under Directors'' fees and allowances');
  perform tests.throws($q$update public.director_payments set status = 'approved'$q$, '%Only the Owner%', '24: needs Owner approval');
end $$;
reset role;
select tests.login('owner@t');
set role authenticated;
update public.director_payments set status = 'approved';
update public.director_payments set status = 'paid', payment_date = app.today(), account_id = (select id from public.accounts where name = 'GCB operating');
reset role;
do $$ begin
  perform tests.eq((select amount_due from public.statutory_lines where type = 'wht_directors_dividends'), 1000.00, '24: matching statutory line created');
  perform tests.eq((select amount from public.ledger_entries where source_type = 'director_payment'), -4000.00, '24: net paid from the account');
end $$;

-- ---------------------------------------------------------------------------
-- 26, 27: running cost; monthly "Cleaner" recurring expense
-- ---------------------------------------------------------------------------
select tests.login('admin@t');
set role authenticated;
insert into public.recurring_expenses (name, category_id, expected_amount, frequency, next_due_date, account_id)
select 'Cleaner', (select id from public.expense_categories where name = 'Cleaning services'), 800, 'monthly',
       date_trunc('month', app.today())::date, (select id from public.account_picker where name = 'Petty cash');
reset role;
select app.generate_recurring_drafts(app.today());
select app.generate_recurring_drafts(app.today());   -- safe to re-run
do $$ begin
  perform tests.eq((select count(*)::int from public.expenses where description = 'Cleaner'), 1, '27: one draft per due date');
  perform tests.eq((select entry_status from public.expenses where description = 'Cleaner'), 'draft', '27: draft awaits confirmation');
  perform tests.eq((select count(*)::int from public.ledger_entries l join public.expenses e on e.id = l.source_id
                    where e.description = 'Cleaner'), 0, '27: drafts do not move cash');
end $$;
select tests.login('admin@t');
set role authenticated;
update public.expenses set entry_status = 'confirmed' where description = 'Cleaner';
reset role;
do $$ begin
  perform tests.eq((select p.name || ' > ' || c.name from public.expenses e join public.expense_categories c on c.id = e.category_id
                    join public.expense_categories p on p.id = c.parent_id where e.description = 'Cleaner'),
                   'Office running > Cleaning services', '27: lands under Office running > Cleaning services');
  perform tests.eq((select next_due_date from public.recurring_expenses), (date_trunc('month', app.today()) + interval '1 month')::date,
                   '27: next due date moves on a month');
end $$;
select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.eq((public.running_cost()).recurring, 800.00, '26: running cost includes recurring expenses (monthly equivalent)');
end $$;
insert into public.settings_versions (effective_from, running_cost_override, notes)
values (app.today(), 50000, 'Owner override');
do $$ begin
  perform tests.eq((public.running_cost()).override, 50000.00, '26: Owner override shown alongside the calculated figure');
  perform tests.ok((public.running_cost()).calculated is not null, '26: calculated figure still shown');
  perform tests.ok((public.money_panel() ->> 'weeks_of_cover') is not null, 'money panel: weeks of cover calculated');
end $$;
reset role;
