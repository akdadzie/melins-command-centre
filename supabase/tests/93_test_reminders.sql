-- Reminders and routines (brief §9; A-042). The routines take the date, so
-- these run on fixed days in March 2027: Thu 18 Mar 2027 is "today".
\set ON_ERROR_STOP 1

-- A PAYE line due in 7 days, and a pending leave request from Ernest.
insert into public.statutory_lines (type, period_start, amount_due, due_date)
values ('paye', '2027-02-01', 1000, '2027-03-25');
select tests.login('ernest@t', 'aal1');
set role authenticated;
insert into public.leave_requests (staff_id, leave_type_id, start_date, end_date, reason)
select app.my_staff_id(), (select id from public.leave_types where name = 'Annual'), '2027-04-05', '2027-04-06', 'Reminder test';
reset role;

do $$
declare
  res jsonb := app.run_daily_reminders('2027-03-18');
  ibrahim uuid := (select id from public.staff where full_name = 'Ibrahim Commedan');
  francis uuid := (select id from public.staff where full_name = 'Francis Austin');
  again jsonb;
begin
  perform tests.ok((res ->> 'timesheets')::int > 0, 'A-042: the daily routine runs and reports what it sent');
  -- Mon 15 Mar is day 3 for Ibrahim: final warning to him.
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where p.email = 'ibrahim@t' and n.reminder_key = format('tsfinal:%s:2027-03-15', ibrahim)),
                   'brief §9: day 3, the person is warned the window closes tonight');
  -- Fri 12 Mar is day 4: Francis (his approver) hears.
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where p.email = 'francis@t' and n.reminder_key = format('tslead:%s:2027-03-12', ibrahim)),
                   'brief §9: day 4, the Project lead is told of the missing day');
  -- Francis's own missing day 4 goes to the Owner (D-015).
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where p.email = 'owner@t' and n.reminder_key = format('tslead:%s:2027-03-12', francis)),
                   'acceptance 31: Francis''s missing day goes to the Owner from day 4');
  -- Wed 3 Mar is day 11: the Owner hears.
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where p.email = 'owner@t' and n.reminder_key = format('tsowner:%s:2027-03-03', ibrahim)),
                   'brief §9: day 11, the Owner is told');
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where p.email = 'acct@t' and n.kind = 'statutory_due' and n.title like 'PAYE%due in 7 days%' and n.send_email),
                   'brief §9: statutory reminder 7 days before, by email too');
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where p.email = 'francis@t' and n.kind = 'leave_waiting'),
                   'brief §9: the approver is reminded of a leave request after 2 working days');

  again := app.run_daily_reminders('2027-03-18');
  perform tests.eq((select sum(v::int) from jsonb_each_text(again - 'recurring_drafts_created') e(k, v))::int, 0,
                   'A-042: running again the same day sends nothing new');
end $$;

-- 17:00 nudge: working days only, and not for someone on approved leave.
do $$
declare
  ernest uuid := (select id from public.staff where full_name = 'Ernest Gbadago');
begin
  perform tests.ok(app.run_timesheet_nudges('2027-03-18') > 0, 'brief §9: 5 pm reminder to anyone with no hours today');
  perform tests.eq(app.run_timesheet_nudges('2027-03-20'), 0, 'brief §9: no reminder on a Saturday');
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where p.email = 'ibrahim@t' and n.reminder_key = 'ts5pm:2027-03-18'), 'brief §9: Ibrahim is nudged');
end $$;

-- Invoice chase: 14 days after an invoice falls due, Admin gets a ready-made reminder.
select tests.login('admin@t');
set role authenticated;
insert into public.invoices (job_id, invoice_date, notes, ready_for_approval)
select id, app.today(), 'chase test', true from public.jobs where title = 'Office block, East Legon';
insert into public.invoice_lines (invoice_id, description, tax_code_id, net_amount)
select i.id, 'Report', (select id from public.tax_codes where name = 'No VAT'), 3000 from public.invoices i where notes = 'chase test';
reset role;
select tests.login('owner@t');
set role authenticated;
update public.invoices set status = 'approved' where notes = 'chase test';
reset role;
select tests.login('admin@t');
set role authenticated;
update public.invoices set status = 'sent' where notes = 'chase test';
reset role;
do $$
declare i public.invoices;
begin
  select * into i from public.invoices where notes = 'chase test' and status = 'sent';
  perform app.run_daily_reminders(i.due_date + 14);
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where p.email = 'admin@t' and n.reminder_key = 'chase14:' || i.id
                             and n.body like '%' || i.invoice_number || '%accounts@themelins.com%'),
                   'brief §9: chase at 14 days overdue with a polite reminder to send');
end $$;

select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$select app.run_daily_reminders()$q$, '%permission denied%', 'A-042: the API cannot run the routines');
end $$;
reset role;

select tests.login('ernest@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.ok(exists (select 1 from public.notifications where kind = 'payslip_ready' and send_email
                           and link like '/me/payslips/%' and title like 'Your payslip for%'),
                   'brief §7.5: the person is told their payslip is ready, with a link (by email too)');
end $$;
reset role;
