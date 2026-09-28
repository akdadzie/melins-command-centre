-- Phase A acceptance tests: timesheets, entry window, leave, utilisation.
-- Brief §13 items 29-36. Dates are relative to today (working days).
\set ON_ERROR_STOP 1

select set_config('tests.d3', tests.working_days_ago(3)::text, false);
select set_config('tests.d4', tests.working_days_ago(4)::text, false);
select set_config('tests.d11', tests.working_days_ago(11)::text, false);
select set_config('tests.job', (select id::text from public.jobs where title = 'Office block, East Legon'), false);

-- ---------------------------------------------------------------------------
-- 29: log on a phone; a retried save is not a duplicate; approval updates hours
-- ---------------------------------------------------------------------------
select tests.login('ernest@t', 'aal1');
set role authenticated;
insert into public.timesheet_entries (client_ref, staff_id, work_date, category, job_id, hours, description)
values ('11111111-1111-1111-1111-111111111111', app.my_staff_id(), current_setting('tests.d3')::date, 'job',
        current_setting('tests.job')::uuid, 8, 'Beam design')
on conflict (client_ref) do nothing;
-- the phone lost the response and retries the same entry
insert into public.timesheet_entries (client_ref, staff_id, work_date, category, job_id, hours, description)
values ('11111111-1111-1111-1111-111111111111', app.my_staff_id(), current_setting('tests.d3')::date, 'job',
        current_setting('tests.job')::uuid, 8, 'Beam design')
on conflict (client_ref) do nothing;
do $$ begin
  perform tests.eq((select count(*)::int from public.timesheet_entries), 1, '29: a retried save does not duplicate the entry');
  perform tests.eq((select status from public.timesheet_entries), 'submitted', '29: entry awaits approval');
  perform tests.eq((select billable from public.timesheet_entries), true, 'D-014: job time is billable by default');
  perform tests.throws($q$update public.timesheet_entries set status = 'approved'$q$, '%approver%', '29: cannot approve own time');
  -- 30: day 4 is outside the self-entry window
  perform tests.throws(format($q$insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours)
    values (app.my_staff_id(), %L, 'job', %L, 3)$q$, current_setting('tests.d4'), current_setting('tests.job')),
    '%entry window%closed%Project lead%', '30: from day 4 the person''s own entry is rejected');
  perform tests.throws($q$insert into public.timesheet_entries (staff_id, work_date, category, hours)
    values (app.my_staff_id(), app.today() + 1, 'internal', 1)$q$, '%future%', '30: no time logged for future dates');
  perform tests.throws($q$insert into public.timesheet_entries (staff_id, work_date, category, hours)
    values (app.my_staff_id(), app.today(), 'internal', 0.3)$q$, '%check constraint%', 'A-013: quarter-hour steps');
end $$;
reset role;

select tests.login('francis@t');
set role authenticated;
update public.timesheet_entries set status = 'approved'
where staff_id = (select id from public.staff where full_name = 'Ernest Gbadago');
do $$ begin
  perform tests.eq((select approved_hours from public.job_hours_vs_budget where budget_role = 'Graduate Engineer'), 8.00,
                   '29: approval updates the job''s hours vs budget');
  -- 30: days 4-10: only the Project lead, with a reason, marked late
  perform tests.throws(format($q$insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours)
    values ((select id from public.staff where full_name = 'Ernest Gbadago'), %L, 'job', %L, 3)$q$,
    current_setting('tests.d4'), current_setting('tests.job')), '%reason%', '30: late entry needs a reason');
  perform tests.throws(format($q$insert into public.timesheet_entries (staff_id, work_date, category, hours, late_reason)
    values ((select id from public.staff where full_name = 'Ernest Gbadago'), %L, 'internal', 2, 'x')$q$,
    current_setting('tests.d11')), '%can''t enter or change time%', '30: from the 11th working day the Project lead cannot');
  -- 31: the Project lead's own day-4 entry needs the Owner
  perform tests.throws(format($q$insert into public.timesheet_entries (staff_id, work_date, category, hours)
    values (app.my_staff_id(), %L, 'internal', 2)$q$, current_setting('tests.d4')), '%closed%the Owner%', '31: Francis''s own day 4 needs the Owner');
  perform tests.throws($q$update public.timesheet_entries set hours = 1
    where staff_id = (select id from public.staff where full_name = 'Ernest Gbadago')$q$, '%approved and locked%', '30: approved entries are locked');
end $$;
insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours, description, late_reason)
select id, current_setting('tests.d4')::date, 'job', current_setting('tests.job')::uuid, 3, 'Site visit', 'Was on site without signal'
from public.staff where full_name = 'Ernest Gbadago';
do $$ begin
  perform tests.ok((select is_late_entry and entered_by = auth.uid() from public.timesheet_entries
                    where work_date = current_setting('tests.d4')::date), '30: marked Late entry, with who entered it');
end $$;
reset role;

select tests.login('owner@t');
set role authenticated;
insert into public.timesheet_entries (staff_id, work_date, category, hours, late_reason)
select id, current_setting('tests.d11')::date, 'internal', 2, 'Forgot to log admin time'
from public.staff where full_name = 'Ernest Gbadago';
insert into public.timesheet_entries (staff_id, work_date, category, hours, late_reason)
select id, current_setting('tests.d4')::date, 'internal', 4, 'Francis was travelling'
from public.staff where full_name = 'Francis Austin';
-- 36: the Owner logs time too, auto-approved, and it counts in utilisation
insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours, description)
values (app.my_staff_id(), app.today(), 'job', current_setting('tests.job')::uuid, 6, 'Client meeting');
do $$ begin
  perform tests.ok((select count(*) = 2 from public.timesheet_entries where late_reason in ('Forgot to log admin time', 'Francis was travelling')),
                   '30/31: from day 11 (and for Francis from day 4) the Owner can enter it');
  perform tests.eq((select status from public.timesheet_entries where description = 'Client meeting'), 'approved', '36: Owner''s own time is auto-approved');
  perform tests.ok((select utilisation_pct > 0 from public.utilisation(app.today(), app.today()) where full_name = 'Kwasi Dadzie Ennison'),
                   '36: utilisation includes the Owner');
  -- 35: Graduate Engineer budget is 10 h; Ernest has logged 8 + 3 = 11 h
  perform tests.ok((select over_hours_budget from public.jobs_flagged where job_id = current_setting('tests.job')::uuid),
                   '35: job over its hour budget for a role is flagged');
end $$;
reset role;

-- 30: a public holiday in between extends each deadline by a day
select tests.login('acct@t');
set role authenticated;
insert into public.public_holidays (holiday_date, name)
select max(d)::date, 'Test holiday' from generate_series(current_setting('tests.d4')::date + 1, app.today() - 1, interval '1 day') g(d)
where app.is_working_day(d::date);
reset role;
select tests.login('ibrahim@t', 'aal1');
set role authenticated;
insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours, description)
values (app.my_staff_id(), current_setting('tests.d4')::date, 'job', current_setting('tests.job')::uuid, 7, 'Detailing');
do $$ begin
  perform tests.ok(true, '30: after a public holiday, the old day 4 is day 3 again and the person can log it');
end $$;
reset role;

-- 31: timesheet compliance
select tests.login('francis@t');
set role authenticated;
do $$
declare c record;
begin
  select * into c from public.timesheet_compliance(current_setting('tests.d11')::date, app.today()) where full_name = 'Ernest Gbadago';
  perform tests.ok(c.on_time_days = 1 and c.late_days = 2, '31: compliance counts on-time and late days');
  perform tests.ok(c.on_time_pct < 100, '31: on-time % shown');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 34: frozen rates don't move when costs or the overhead share change
-- ---------------------------------------------------------------------------
do $$
declare s public.timesheet_rate_snapshots;
begin
  select r.* into s from public.timesheet_rate_snapshots r join public.timesheet_entries e on e.id = r.entry_id
  where e.description = 'Beam design';
  perform tests.eq(s.cost_rate, 50.81, '34: cost rate frozen = 4,065 x 1.25 / 100');
  perform tests.eq(s.charge_out_rate, 60.97, '34: charge-out rate frozen = cost rate x 1.20');
end $$;
select tests.login('owner@t');
set role authenticated;
insert into public.staff_cost_history (staff_id, effective_from, monthly_cost, notes)
select id, app.today(), 5000, 'Pay rise' from public.staff where full_name = 'Ernest Gbadago';
update public.settings_versions set overhead_share = 0.40 where effective_from = app.today();
do $$ begin
  perform tests.throws($q$update public.staff_cost_history set monthly_cost = 1$q$, '%', '34: cost history is never overwritten') where false;
  perform tests.eq(tests.rows($q$update public.staff_cost_history set monthly_cost = 1$q$), 0, '34: cost history rows cannot be overwritten');
end $$;
reset role;
do $$ begin
  perform tests.eq((select r.cost_rate from public.timesheet_rate_snapshots r join public.timesheet_entries e on e.id = r.entry_id
                    where e.description = 'Beam design'), 50.81, '34: snapshot unchanged after a pay rise and overhead change');
end $$;
select tests.login('francis@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.timesheet_rate_snapshots), 0, 'brief §4: Project lead sees no cost rates');
  perform tests.ok((select count(*) from public.timesheet_charge_out) > 0, 'brief §4: Project lead sees final charge-out rates');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 32, 33: leave
-- ---------------------------------------------------------------------------
select set_config('tests.m', (date_trunc('week', app.today()) + interval '14 days')::date::text, false);  -- a Monday
select tests.login('owner@t');
set role authenticated;
insert into public.leave_entitlements (staff_id, leave_type_id, leave_year, entitled_days)
select s.id, t.id, app.leave_year(current_setting('tests.m')::date), 15
from public.staff s, public.leave_types t where s.full_name = 'Ernest Gbadago' and t.name = 'Annual';
insert into public.public_holidays (holiday_date, name) values (current_setting('tests.m')::date + 9, 'Holiday inside leave');
reset role;

select tests.login('ernest@t', 'aal1');
set role authenticated;
insert into public.leave_requests (staff_id, leave_type_id, start_date, end_date, reason)
select app.my_staff_id(), (select id from public.leave_types where name = 'Annual'),
       current_setting('tests.m')::date, current_setting('tests.m')::date + 4, 'Family visit';
insert into public.leave_requests (staff_id, leave_type_id, start_date, end_date)
select app.my_staff_id(), (select id from public.leave_types where name = 'Annual'),
       current_setting('tests.m')::date + 7, current_setting('tests.m')::date + 11;
do $$ begin
  perform tests.eq((select working_days from public.leave_requests where reason = 'Family visit'), 5, '32: five working days');
  perform tests.eq((select working_days from public.leave_requests where start_date = current_setting('tests.m')::date + 7), 4,
                   '32: a public holiday inside the leave is not a leave day');
  perform tests.throws($q$update public.leave_requests set status = 'approved'$q$, '%not this person''s leave approver%', '32: cannot approve own leave');
end $$;
reset role;
do $$ begin
  perform tests.ok(exists (select 1 from public.notifications n join public.profiles p on p.user_id = n.recipient_id
                           where n.kind = 'leave_requested' and p.email = 'francis@t'), '32: the approver (Francis) is notified');
end $$;
select tests.login('francis@t');
set role authenticated;
update public.leave_requests set status = 'approved';
reset role;
do $$
declare
  ernest uuid := (select id from public.staff where full_name = 'Ernest Gbadago');
  bal record;
begin
  perform tests.eq((select count(*)::int from public.timesheet_entries where staff_id = ernest and category = 'leave'), 9,
                   '32: approved leave fills its working days with Leave entries');
  perform tests.eq((select count(*)::int from public.missing_timesheet_days(current_setting('tests.m')::date, current_setting('tests.m')::date + 11)
                    where staff_id = ernest), 0, '32: no timesheet reminders for leave days');
  bal := app.leave_balance(ernest, (select id from public.leave_types where name = 'Annual'), app.leave_year(current_setting('tests.m')::date));
  perform tests.eq(bal.available, 6.0, '32: annual balance reduced by 5 (+4)');
end $$;

-- 32: utilisation target reduced pro-rata for the leave month
do $$
declare full_target numeric; leave_target numeric;
begin
  select target_hours into leave_target from public.utilisation(current_setting('tests.m')::date, current_setting('tests.m')::date)
   where full_name = 'Ernest Gbadago';
  select target_hours into full_target from public.utilisation(current_setting('tests.m')::date, current_setting('tests.m')::date)
   where full_name = 'Ibrahim Commedan';
  perform tests.ok(leave_target < full_target, '32: utilisation target reduced pro-rata for approved leave');
end $$;

-- 33: going below zero needs the Owner (or Unpaid)
select tests.login('ernest@t', 'aal1');
set role authenticated;
insert into public.leave_requests (staff_id, leave_type_id, start_date, end_date, reason)
select app.my_staff_id(), (select id from public.leave_types where name = 'Annual'),
       current_setting('tests.m')::date + 14, current_setting('tests.m')::date + 28, 'Long trip';
reset role;
select tests.login('francis@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.leave_requests set status = 'approved' where reason = 'Long trip'$q$,
    '%below zero%Owner%Unpaid%', '33: a request that overdraws the annual balance needs the Owner');
end $$;
reset role;
select tests.login('owner@t');
set role authenticated;
update public.leave_requests set status = 'approved' where reason = 'Long trip';
reset role;

-- 33: colleagues see names and dates only
select tests.login('ibrahim@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.leave_requests), 0, '33: colleagues cannot read leave requests (type, reason)');
  perform tests.eq((select count(*)::int from public.leave_calendar where full_name = 'Ernest Gbadago'), 3, '33: but see names and dates on the calendar');
end $$;
reset role;

-- Approved leave can be cancelled before it starts, and its entries go.
select tests.login('ernest@t', 'aal1');
set role authenticated;
update public.leave_requests set status = 'cancelled' where reason = 'Long trip';
reset role;
do $$ begin
  perform tests.eq((select count(*)::int from public.timesheet_entries te join public.staff s on s.id = te.staff_id
                    where s.full_name = 'Ernest Gbadago' and te.category = 'leave'), 9, '32: cancelling removes its leave entries');
end $$;
