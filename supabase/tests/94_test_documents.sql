-- Documents (A-045): a file is visible to whoever can read its record.
\set ON_ERROR_STOP 1

select tests.login('ernest@t', 'aal1');
set role authenticated;
insert into public.leave_requests (staff_id, leave_type_id, start_date, end_date, reason)
select app.my_staff_id(), (select id from public.leave_types where name = 'Sick'), '2027-05-03', '2027-05-04', 'Doc test';
insert into storage.objects (bucket_id, name)
select 'documents', 'leave_requests/' || id || '/certificate.pdf' from public.leave_requests where reason = 'Doc test';
do $$ begin
  perform tests.eq((select count(*)::int from storage.objects where name like 'leave_requests/%/certificate.pdf'), 1,
                   'A-045: the person uploads and sees their own leave document');
  perform tests.throws($q$insert into storage.objects (bucket_id, name) values ('documents', 'leave_requests/not-an-id/x.pdf')$q$,
                       '%row-level security%', 'A-045: a path that isn''t <table>/<record id>/<file> is refused');
  perform tests.throws($q$insert into storage.objects (bucket_id, name) values ('documents', 'profiles/' || auth.uid() || '/x.pdf')$q$,
                       '%row-level security%', 'A-045: only tables that take attachments');
end $$;
reset role;

select tests.login('ibrahim@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from storage.objects where name like 'leave_requests/%/certificate.pdf'), 0,
                   'A-045 / brief §7.3: a colleague cannot see the leave document');
end $$;
reset role;

select tests.login('francis@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from storage.objects where name like 'leave_requests/%/certificate.pdf'), 1,
                   'A-045: the approver can see it');
end $$;
reset role;

-- Statements are finance-only, so their files are too.
select tests.login('acct@t');
set role authenticated;
insert into public.statement_imports (account_id, period_start, period_end, closing_balance)
select id, '2027-05-01', '2027-05-31', 0 from public.accounts where name = 'MTN MoMo';
insert into storage.objects (bucket_id, name)
select 'documents', 'statement_imports/' || id || '/momo-may.csv' from public.statement_imports where period_start = '2027-05-01';
reset role;
select tests.login('admin@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from storage.objects where name like 'statement_imports/%'), 0, 'A-045 / acceptance 4: Admin cannot see statement files');
end $$;
reset role;

select tests.login('kofi@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from storage.objects where name like 'statement_imports/%'), 1, 'A-045: a Director can open finance documents');
  perform tests.throws($q$insert into storage.objects (bucket_id, name)
                          select 'documents', 'statement_imports/' || id || '/x.csv' from public.statement_imports limit 1$q$,
                       '%row-level security%', 'acceptance 22: a Director cannot upload');
end $$;
reset role;

-- Only the uploader or the Owner deletes.
select tests.login('francis@t');
set role authenticated;
do $$ begin
  perform tests.eq(tests.rows($q$delete from storage.objects where name like 'leave_requests/%/certificate.pdf'$q$), 0,
                   'A-045: someone else cannot delete the file');
end $$;
reset role;
