-- Phase A acceptance tests: statements, reconciliation, month close.
-- Brief §13 items 11, 13, 14, 25. Uses February 2026.
\set ON_ERROR_STOP 1

-- A February invoice and an Admin expense.
select tests.login('owner@t');
set role authenticated;
insert into public.invoices (job_id, invoice_date, notes)
select id, '2026-02-10', 'feb' from public.jobs where title = 'House extension';
insert into public.invoice_lines (invoice_id, description, tax_code_id, net_amount)
select id, 'Site inspection', (select id from public.tax_codes where name = 'No VAT'), 3000 from public.invoices where notes = 'feb';
update public.invoices set status = 'approved' where notes = 'feb';
reset role;
select tests.login('admin@t');
set role authenticated;
insert into public.expenses (expense_date, category_id, description, amount, payment_source, account_id)
select '2026-02-05', (select id from public.expense_categories where name = 'Postage and courier'), 'Courier to client', 100,
       'petty_cash', (select id from public.account_picker where name = 'Petty cash');
reset role;

-- 11: the Accountant uploads the GCB statement; a credit nobody logged
select tests.login('acct@t');
set role authenticated;
insert into public.statement_imports (account_id, period_start, period_end, closing_balance, source_format)
select id, '2026-02-01', '2026-02-28', 13000, 'gcb_csv' from public.accounts where name = 'GCB operating';
insert into public.statement_lines (import_id, line_date, description, amount)
select id, '2026-02-20', 'TRF FROM PRIVATE CLIENT', 3000 from public.statement_imports;
update public.statement_lines set status = 'record_task';
reset role;
do $$ begin
  perform tests.eq((select count(*)::int from public.action_items where kind = 'record_receipt' and status = 'open'), 1,
                   '11: unmatched credit creates a "Record this receipt" task');
end $$;
select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.eq((select amount from public.receipt_tasks), 3000.00, '11: admin sees the line to record (no balance)');
  perform tests.eq((select count(*)::int from public.statement_lines), 0, '11: admin cannot read statements');
end $$;
reset role;
select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$select public.close_month('2026-02-01')$q$, '%can''t close yet%', '11/14: month cannot close with open items');
  perform tests.ok(exists (select 1 from public.month_close_blockers('2026-02-01') where kind = 'statement_line'), '11: the unrecorded credit blocks close');
  perform tests.ok(exists (select 1 from public.month_close_blockers('2026-02-01') where kind = 'unreviewed_entry'), '14: the unreviewed expense blocks close');
end $$;
reset role;

-- Admin records the receipt from the task; the Accountant confirms it.
select tests.login('admin@t');
set role authenticated;
insert into public.receipts (client_id, receipt_date, cash_amount, account_id, method, reference, source, statement_line_id)
select (select client_id from public.invoices where notes = 'feb'), '2026-02-20', 3000,
       (select id from public.account_picker where name = 'GCB operating'), 'bank_transfer', 'TRF', 'found_on_statement',
       (select statement_line_id from public.receipt_tasks);
insert into public.receipt_allocations (receipt_id, invoice_id, cash_amount)
select r.id, i.id, 3000 from public.receipts r, public.invoices i where r.reference = 'TRF' and i.notes = 'feb';
reset role;
do $$ begin
  perform tests.eq((select count(*)::int from public.action_items where kind = 'record_receipt' and status = 'open'), 0, '11: task closes once recorded');
end $$;
select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.ok(exists (select 1 from public.month_close_blockers('2026-02-01') where kind = 'unconfirmed_receipt'), '11: and must be confirmed');
end $$;
update public.receipts set status = 'confirmed' where reference = 'TRF';
-- 14: the Accountant queries, then reviews, the Admin expense.
update public.expenses set review_status = 'queried', query_note = 'Attach the courier receipt' where description = 'Courier to client';
reset role;
do $$ begin
  perform tests.eq((select count(*)::int from public.action_items where kind = 'fix_queried_entry' and status = 'open'), 1, '14: queried entry goes back to Admin');
end $$;
select tests.login('admin@t');
set role authenticated;
update public.expenses set receipt_path = 'receipts/courier.jpg' where description = 'Courier to client';
do $$ begin
  perform tests.eq((select review_status::text from public.expenses where description = 'Courier to client'), 'recorded',
                   '14: fixing a queried entry sends it back to the Accountant for review');
  perform tests.throws($q$update public.expenses set review_status = 'reviewed' where description = 'Courier to client'$q$,
                       '%Only the Accountant%', '14: admin cannot mark it reviewed');
end $$;
reset role;
do $$ begin
  perform tests.eq((select count(*)::int from public.action_items where kind = 'fix_queried_entry' and status = 'open'), 0, '14: the query task closes');
end $$;
select tests.login('acct@t');
set role authenticated;
update public.expenses set review_status = 'reviewed' where description = 'Courier to client';

-- 13: a GHS 45 difference can't close until explained
insert into public.reconciliations (account_id, month, statement_balance)
select id, '2026-02-01', app.account_balance(id, '2026-02-28') + case when name = 'GCB operating' then 45 else 0 end
from public.accounts;
do $$ begin
  perform tests.eq((select difference from public.reconciliations r join public.accounts a on a.id = r.account_id
                    where a.name = 'GCB operating'), 45.00, '13: difference calculated');
  perform tests.throws($q$update public.reconciliations set status = 'closed'
    where account_id = (select id from public.accounts where name = 'GCB operating')$q$, '%differ by GHS 45.00%', '13: cannot close with a GHS 45 difference');
end $$;
update public.reconciliations set status = 'closed', explanation = case when difference <> 0 then 'Bank charges not yet recorded; posting in March' end;
update public.statement_lines set status = status;   -- (already matched)
select public.close_month('2026-02-01');
reset role;
do $$ begin
  perform tests.eq((select status from public.month_closes where month = '2026-02-01'), 'closed', '11/13/14: month closes once everything is done');
end $$;

-- 25: a closed month can't be edited; only the Owner reopens, and it's logged
select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.expenses set description = 'changed' where description = 'Courier to client'$q$, '%is closed%', '25: closed month cannot be edited');
  perform tests.throws($q$insert into public.expenses (expense_date, category_id, description, amount, payment_source, account_id)
    select '2026-02-15', (select id from public.expense_categories where name = 'Postage and courier'), 'late', 10, 'petty_cash',
           (select id from public.account_picker where name = 'Petty cash')$q$, '%is closed%', '25: nothing new can be dated in it');
end $$;
reset role;
select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$select public.reopen_month('2026-02-01', 'fix')$q$, '%Only the Owner%', '25: accountant cannot reopen');
end $$;
reset role;
select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$select public.reopen_month('2026-02-01', '')$q$, '%reason%', '25: reopening needs a reason');
end $$;
select public.reopen_month('2026-02-01', 'Correct the courier category');
reset role;
do $$ begin
  perform tests.eq((select reason from public.month_reopenings), 'Correct the courier category', '25: reopening logged with who and why');
  perform tests.ok((select reopened_by from public.month_reopenings) = tests.uid('owner@t'), '25: reopened by the Owner');
  perform tests.ok(exists (select 1 from public.audit_log where table_name = 'month_closes' and new_data ->> 'status' = 'open'), '25: in the audit log');
end $$;
