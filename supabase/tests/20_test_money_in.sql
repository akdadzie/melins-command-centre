-- Phase A acceptance tests: invoices and money in.
-- Brief §13 items 6, 7, 8, 9, 10, 12, 23.
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------------------
-- 6: Admin drafts; only the Owner approves; numbers are gapless on approval
-- ---------------------------------------------------------------------------
select tests.login('admin@t');
set role authenticated;
insert into public.invoices (job_id, invoice_date)
select id, app.today() from public.jobs where title = 'Office block, East Legon';
insert into public.invoice_lines (invoice_id, description, tax_code_id, net_amount)
select i.id, 'Stage 1 design fee', (select id from public.tax_codes where name = 'Standard'), 100000
from public.invoices i;
do $$ begin
  perform tests.ok((select invoice_number is null and draft_ref like 'DRAFT-%' from public.invoices), '6: draft has a temporary reference, no number');
  perform tests.eq(tests.rows($q$update public.invoices set status = 'approved'$q$), 0, '6: admin cannot approve (no effect)')
    where false;
  perform tests.throws($q$update public.invoices set status = 'approved'$q$, '%Only the Owner approves%', '6: admin cannot approve');
  perform tests.throws($q$update public.invoices set status = 'sent'$q$, '%cannot move from draft to sent%', '6: draft cannot be sent');
end $$;
update public.invoices set ready_for_approval = true;
reset role;

select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.notifications where kind = 'approval_needed' and record_type = 'invoice'), 1,
                   '6: owner notified that a draft is ready');
end $$;
-- Approve the first invoice; then a second invoice whose approval fails and
-- rolls back; then a third. Numbers must be 001 and 002 with no gap.
update public.invoices set status = 'approved';
insert into public.invoices (job_id, invoice_date, notes)
select id, app.today(), 'rolled back' from public.jobs limit 1;
do $$ begin
  -- approval fails (no lines) and gives its number back
  perform tests.throws($q$update public.invoices set status = 'approved' where notes = 'rolled back'$q$, '%at least one line%', '6: approval without lines fails');
end $$;
insert into public.invoice_lines (invoice_id, description, tax_code_id, net_amount)
select id, 'Additional site visit', (select id from public.tax_codes where name = 'No VAT'), 5000
from public.invoices where notes = 'rolled back';
update public.invoices set status = 'approved' where notes = 'rolled back';
do $$
declare y text := extract(year from app.today())::text;
begin
  perform tests.eq((select string_agg(invoice_number, ',' order by invoice_number) from public.invoices),
                   format('INV-%s-001,INV-%s-002', y, y), '6: numbers allocated on approval with no gaps');
  perform tests.throws($q$update public.invoice_lines set net_amount = 1 where description = 'Stage 1 design fee'$q$, '%locked%', '6: issued invoice lines are locked');
  perform tests.throws($q$update public.invoices set due_date = due_date + 1 where notes is null$q$, '%locked%', '6: issued invoice is locked');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 7 and 9: taxes per the code in force on the date; 10% retention on 100,000
-- ---------------------------------------------------------------------------
do $$
declare i public.invoices;
begin
  select * into i from public.invoices where notes is null;
  -- NHIL 2,500 + GETFund 2,500 + VAT 15% x 105,000 = 15,750
  perform tests.eq(i.tax_total, 20750.00, '7: VAT and levies per the tax code (stacked basis)');
  perform tests.eq(i.gross_total, 120750.00, '7: gross');
  perform tests.eq(i.retention_amount, 10000.00, '9: 10% retention on GHS 100,000 net');
  perform tests.eq(i.expected_wht, 7500.00, '8: expected client WHT on the VAT-exclusive amount');
  perform tests.eq(app.job_retention_held(i.job_id), 10500.00, '9: job retention balance (10,000 + 500 on the second invoice)');
end $$;
-- The Accountant changes the VAT rate from today: issued invoices don't move.
select tests.login('acct@t');
set role authenticated;
insert into public.tax_code_versions (tax_code_id, effective_from, vat_withholding_rate)
select id, app.today(), 0.4667 from public.tax_codes where name = 'Standard';
insert into public.tax_code_components (version_id, seq, name, rate, basis, recoverable, is_vat)
select v.id, 1, 'VAT', 0.20, 'net', true, true
from public.tax_code_versions v join public.tax_codes t on t.id = v.tax_code_id
where t.name = 'Standard' and v.effective_from = app.today();
reset role;
do $$ begin
  perform tests.eq((select tax_total from public.invoices where notes is null), 20750.00, '7: changing a rate later does not alter an issued invoice');
end $$;
select tests.login('owner@t');
set role authenticated;
update public.jobs set retention_release_date = app.today() + 365, retention_release_terms = '12 months after completion';
reset role;
select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.eq((select retention_held from public.retention_by_job), 10500.00, '9: retention shows on the retention list');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 8: settled by cash + WHT -> Paid, with an Expected WHT certificate
-- ---------------------------------------------------------------------------
select tests.login('admin@t');
set role authenticated;
update public.invoices set status = 'sent' where notes is null;
-- due = 120,750 - 10,000 retention = 110,750 ; WHT 7,500 ; cash 103,250
insert into public.receipts (client_id, receipt_date, cash_amount, wht_amount, account_id, method, reference, source)
select client_id, app.today(), 103250, 7500, (select id from public.account_picker where name = 'GCB operating'),
       'bank_transfer', 'TT123', 'remittance_advice'
from public.invoices where notes is null;
insert into public.receipt_allocations (receipt_id, invoice_id, cash_amount, wht_amount)
select r.id, i.id, 103250, 7500 from public.receipts r, public.invoices i where i.notes is null and r.reference = 'TT123';
do $$ begin
  perform tests.eq((select status from public.invoices where notes is null), 'paid', '8: cash + WHT settles the invoice (less retention)');
  perform tests.eq((select status from public.wht_certificates), 'expected', '8: an Expected WHT certificate is created');
  perform tests.eq((select expected_by from public.wht_certificates), app.today() + 30, '8: flagged if not received in 30 days');
  perform tests.eq((select status from public.billing_milestones limit 1), null::text, '8: (no milestones on this job)');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 10: Owner quick-log -> Reported, task for Admin, not cash until confirmed
-- ---------------------------------------------------------------------------
select tests.login('owner@t');
set role authenticated;
-- invoice of 5,000 less 10% retention = 4,500 due
select public.quick_log_payment(4500, app.today(), (select id from public.invoices where notes = 'rolled back'));
do $$
declare cash_before numeric := app.account_balance((select id from public.accounts where name = 'GCB operating'));
begin
  perform tests.eq((select status from public.receipts where source = 'reported_by_owner'), 'reported', '10: quick-logged payment is Reported');
  perform tests.eq((select status from public.invoices where notes = 'rolled back'), 'paid', '10: it settles the invoice');
  perform tests.eq(cash_before, 10000.00, '10/12: GCB balance = opening 10,000 (receipt of 103,250 not yet confirmed; admin expense 250 posted? see below)')
    where false;
end $$;
reset role;
do $$ begin
  perform tests.eq((select count(*)::int from public.action_items where kind = 'complete_reported_payment' and status = 'open'), 1,
                   '10: Admin has a task to complete the details');
  -- Only confirmed receipts post to the ledger.
  perform tests.eq((select count(*)::int from public.ledger_entries where source_type = 'receipt'), 0, '10: reported payments are not cash');
end $$;

select tests.login('admin@t');
set role authenticated;
update public.receipts set account_id = (select id from public.account_picker where name = 'MTN MoMo'),
                           method = 'mobile_money', reference = 'MOMO-9'
where source = 'reported_by_owner';
reset role;
do $$ begin
  perform tests.eq((select count(*)::int from public.action_items where kind = 'complete_reported_payment' and status = 'open'), 0,
                   '10: task closes once the details are complete');
end $$;

select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.receipts set status = 'confirmed'$q$, '%Only the Accountant%confirms%', '10: admin cannot confirm');
end $$;
reset role;
select tests.login('acct@t');
set role authenticated;
update public.receipts set status = 'confirmed';
reset role;

-- ---------------------------------------------------------------------------
-- 12: receipt, expense and transfer update the right balances; transfer
--     doesn't change total cash
-- ---------------------------------------------------------------------------
do $$
declare
  gcb uuid := (select id from public.accounts where name = 'GCB operating');
  momo uuid := (select id from public.accounts where name = 'MTN MoMo');
  petty uuid := (select id from public.accounts where name = 'Petty cash');
  total_before numeric;
begin
  perform tests.eq(app.account_balance(gcb), 10000 + 103250 - 250.00, '12: GCB = opening + receipt - admin expense');
  perform tests.eq(app.account_balance(momo), 4500.00, '12: MoMo = confirmed quick-logged receipt');
  total_before := app.account_balance(gcb) + app.account_balance(momo) + app.account_balance(petty);
  perform set_config('tests.total_before', total_before::text, false);
end $$;
select tests.login('admin@t');
set role authenticated;
insert into public.transfers (transfer_date, from_account_id, to_account_id, amount, reason)
select app.today(), (select id from public.account_picker where name = 'MTN MoMo'),
       (select id from public.account_picker where name = 'GCB operating'), 4000, 'Sweep MoMo to bank';
do $$ begin
  perform tests.eq((select count(*)::int from public.transfers), 1, '12: admin sees the transfer they recorded');
end $$;
reset role;
do $$
declare
  gcb uuid := (select id from public.accounts where name = 'GCB operating');
  momo uuid := (select id from public.accounts where name = 'MTN MoMo');
  petty uuid := (select id from public.accounts where name = 'Petty cash');
begin
  perform tests.eq(app.account_balance(momo), 500.00, '12: transfer reduces MoMo');
  perform tests.eq(app.account_balance(gcb) + app.account_balance(momo) + app.account_balance(petty),
                   current_setting('tests.total_before')::numeric, '12: transfer leaves total cash unchanged');
end $$;

-- ---------------------------------------------------------------------------
-- 23: client pays a director personally
-- ---------------------------------------------------------------------------
select tests.login('owner@t');
set role authenticated;
insert into public.jobs (title, client_id, fee)
select 'House extension', id, 5000 from public.clients where name = 'Private Client';
insert into public.invoices (job_id, invoice_date, notes)
select id, app.today(), 'director-paid' from public.jobs where title = 'House extension';
insert into public.invoice_lines (invoice_id, description, tax_code_id, net_amount)
select id, 'Consultation', (select id from public.tax_codes where name = 'No VAT'), 5000 from public.invoices where notes = 'director-paid';
update public.invoices set status = 'approved' where notes = 'director-paid';
insert into public.receipts (client_id, receipt_date, cash_amount, method, source, received_by_director_id)
select client_id, app.today(), 5000, 'cash', 'received_by_director', (select id from public.directors where full_name = 'Kofi Anaman')
from public.invoices where notes = 'director-paid';
do $$ begin
  perform tests.throws($q$insert into public.receipt_allocations (receipt_id, invoice_id, cash_amount)
    select r.id, i.id, 5000.01 from public.receipts r, public.invoices i where i.notes = 'director-paid' and r.source = 'received_by_director'$q$,
    '%more than%', '23: allocations must stay within the payment and the invoice');
end $$;
insert into public.receipt_allocations (receipt_id, invoice_id, cash_amount)
select r.id, i.id, 5000 from public.receipts r, public.invoices i
where i.notes = 'director-paid' and r.source = 'received_by_director';
reset role;
select tests.login('acct@t');
set role authenticated;
update public.receipts set status = 'confirmed' where source = 'received_by_director';
reset role;
do $$
declare
  kofi uuid := (select id from public.directors where full_name = 'Kofi Anaman');
  cash_now numeric := (select sum(app.account_balance(id)) from public.accounts);
begin
  perform tests.eq((select status from public.invoices where notes = 'director-paid'), 'paid', '23: payment received by a director settles the invoice');
  perform tests.eq(app.director_balance(kofi), -5000.00, '23: GHS 5,000 owed by that director to the company');
  perform tests.eq(cash_now, current_setting('tests.total_before')::numeric, '23: excluded from MeLiNS cash');
end $$;
select tests.login('owner@t');
set role authenticated;
insert into public.transfers (transfer_date, from_director_id, to_account_id, amount, reason)
select app.today(), (select id from public.directors where full_name = 'Kofi Anaman'),
       (select id from public.accounts where name = 'GCB operating'), 5000, 'Kofi hands over client cash';
reset role;
do $$
declare kofi uuid := (select id from public.directors where full_name = 'Kofi Anaman');
begin
  perform tests.eq(app.director_balance(kofi), 0.00, '23: transfer to a MeLiNS account clears the director balance');
  perform tests.eq((select sum(app.account_balance(id)) from public.accounts),
                   current_setting('tests.total_before')::numeric + 5000, '23: and the cash now counts');
end $$;
select set_config('tests.kofi', (select id::text from public.directors where full_name = 'Kofi Anaman'), false);
select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$insert into public.transfers (transfer_date, from_director_id, to_account_id, amount)
    select app.today(), current_setting('tests.kofi')::uuid, (select id from public.account_picker limit 1), 1$q$,
    '%Only the Owner or Accountant records a director%', '23: admin cannot record director hand-overs');
end $$;
reset role;
