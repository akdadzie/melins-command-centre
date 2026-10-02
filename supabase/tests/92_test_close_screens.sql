-- Month-close screen: Admin's part of the blockers, and the review queue (A-040).
\set ON_ERROR_STOP 1

select tests.login('admin@t');
set role authenticated;
insert into public.expenses (expense_date, category_id, description, amount, payment_source, account_id)
select app.today(), (select id from public.expense_categories where name = 'Postage and courier'),
       'Close-screen courier', 75, 'company_account', (select id from public.account_picker where name = 'GCB operating');
do $$ begin
  perform tests.ok(not exists (select 1 from public.month_close_blockers(app.today()) where kind in ('statement_line', 'reconciliation')),
                   'A-040: Admin sees no statement or reconciliation blockers');
  perform tests.eq((select count(*)::int from public.entries_to_review(app.today())), 0, 'A-040: Admin gets no review queue');
end $$;
reset role;

select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.ok(exists (select 1 from public.month_close_blockers(app.today()) where kind = 'reconciliation'),
                   'A-040: the Accountant still sees every blocker');
  perform tests.ok(exists (select 1 from public.entries_to_review(app.today())
                           where record_type = 'expenses' and description = 'Close-screen courier' and amount = 75
                             and entered_by = 'NSP3 - Admin' and review_status = 'recorded'),
                   'A-040: the queue shows what the entry is, how much and who entered it');
end $$;
update public.expenses set review_status = 'reviewed' where description = 'Close-screen courier';
do $$ begin
  perform tests.ok(not exists (select 1 from public.entries_to_review(null) where description = 'Close-screen courier'),
                   'A-040: a reviewed entry leaves the queue');
  perform tests.throws($q$select * from app.month_close_blockers_all(app.today())$q$, '%permission denied%',
                       'A-040: the unfiltered blockers are not callable from the API');
end $$;
reset role;
