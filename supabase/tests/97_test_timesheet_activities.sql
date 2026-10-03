-- Timesheet improvements, 3 Oct 2026 (D-042..D-044).
\set ON_ERROR_STOP 1

select set_config('tests.d2', tests.working_days_ago(2)::text, false);
select set_config('tests.d5', tests.working_days_ago(5)::text, false);
select set_config('tests.job', (select id::text from public.jobs where title = 'Office block, East Legon'), false);

-- ---------------------------------------------------------------------------
-- D-042: an activity and a description are required
-- ---------------------------------------------------------------------------
select tests.login('ernest@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.throws(format($q$insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours, description)
    values (app.my_staff_id(), app.today(), 'job', %L, 2, 'Beam calculations')$q$, current_setting('tests.job')),
    '%Choose the activity%', 'D-042: an entry needs an activity');
  perform tests.throws(format($q$insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours, description, activity_id)
    values (app.my_staff_id(), app.today(), 'job', %L, 2, 'Beams', (select id from public.timesheet_activities where name = 'Design calculations'))$q$,
    current_setting('tests.job')), '%at least 10 characters%', 'D-042: "what you did" needs at least 10 characters');
end $$;
insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours, description, activity_id)
select app.my_staff_id(), app.today(), 'job', current_setting('tests.job')::uuid, 2.25, 'Beam calculations, grid B',
       (select id from public.timesheet_activities where name = 'Design calculations');
insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours, description, activity_custom)
select app.my_staff_id(), app.today(), 'job', current_setting('tests.job')::uuid, 0.75, 'Photos of the existing columns', '  Site photos ';
do $$ begin
  perform tests.eq((select activity_custom from public.timesheet_entries where description = 'Photos of the existing columns'), 'Site photos',
                   'D-042: a custom activity is saved (trimmed)');
  perform tests.ok(not exists (select 1 from public.timesheet_activity_hours(app.today() - 30, app.today()) where full_name <> 'Ernest Gbadago'),
                   'D-044: staff see only their own hours in the report');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- D-043: entering for someone inside their window isn't late
-- ---------------------------------------------------------------------------
select tests.login('francis@t');
set role authenticated;
insert into public.timesheet_entries (staff_id, work_date, category, job_id, hours, description, activity_custom)
select id, current_setting('tests.d2')::date, 'job', current_setting('tests.job')::uuid, 3, 'Detailing for Ibrahim', 'Site photos'
from public.staff where full_name = 'Ibrahim Commedan';
do $$ begin
  perform tests.ok((select not is_late_entry and late_reason is null and entered_by = auth.uid()
                    from public.timesheet_entries where description = 'Detailing for Ibrahim'),
                   'D-043: inside the window, no reason, not late, recorded as entered by the Project lead');
  perform tests.throws(format($q$insert into public.timesheet_entries (staff_id, work_date, category, hours, description, activity_custom)
    values ((select id from public.staff where full_name = 'Ibrahim Commedan'), %L, 'internal', 1, 'Office admin work', 'x')$q$,
    current_setting('tests.d5')), '%reason is required%', 'D-043: from day 4 a reason is required');
end $$;
insert into public.timesheet_entries (staff_id, work_date, category, hours, description, activity_custom, late_reason)
select id, current_setting('tests.d5')::date, 'internal', 1, 'Office admin work', 'Office admin', 'He was on leave without logging'
from public.staff where full_name = 'Ibrahim Commedan';
do $$ begin
  perform tests.ok((select is_late_entry from public.timesheet_entries where late_reason = 'He was on leave without logging'),
                   'D-043: and it''s marked late');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- D-042 / D-044: custom activities are reported and the Owner promotes them
-- ---------------------------------------------------------------------------
select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.eq((select entries from public.timesheet_custom_activities where key = 'site photos'), 2,
                   'D-042: custom activities are reported with how often they''re used');
  perform tests.ok(exists (select 1 from public.timesheet_activity_hours(app.today() - 30, app.today())
                           where activity = 'Design calculations' and activity_group = 'Design' and full_name = 'Ernest Gbadago' and hours = 2.25),
                   'D-044: hours by activity, per job and per person');
  perform public.promote_custom_activity('site photos', 'Site', 'Site photography');
  perform tests.eq((select count(*)::int from public.timesheet_entries te join public.timesheet_activities a on a.id = te.activity_id
                    where a.name = 'Site photography'), 2, 'D-042: promoting moves the entries onto the new list item');
  perform tests.ok(not exists (select 1 from public.timesheet_custom_activities where key = 'site photos'),
                   'D-042: and it leaves the custom list');
end $$;
reset role;

select tests.login('ernest@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.throws($q$select public.promote_custom_activity('x', 'Site', 'y')$q$, '%Only the Owner%', 'D-042: only the Owner edits the list');
  perform tests.eq((select count(*)::int from public.timesheet_custom_activities), 0, 'D-042: staff don''t see the custom-activity report');
end $$;
reset role;
