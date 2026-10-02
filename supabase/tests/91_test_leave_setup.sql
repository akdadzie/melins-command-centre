-- Leave screens: working-day preview and setting up a leave year (A-038).
\set ON_ERROR_STOP 1

-- Annual leave defaults to 15 days; up to 5 unused days carry over (test values).
update public.leave_types set default_entitled_days = 15 where name = 'Annual';
update public.settings_versions set max_carry_over_days = 5;
-- NSP1 leaves at the end of June 2028; Ernest had 15 days in 2027 and took none.
update public.staff set end_date = '2028-06-30' where full_name = 'NSP1 - Technical';
insert into public.leave_entitlements (staff_id, leave_type_id, leave_year, entitled_days)
select s.id, t.id, 2027, 15 from public.staff s, public.leave_types t
where s.full_name = 'Ernest Gbadago' and t.name = 'Annual';

select tests.login('ernest@t');
set role authenticated;
do $$ begin
  -- Mon 3 Jan 2028 to Sun 9 Jan 2028: five working days.
  perform tests.eq(public.working_days('2028-01-03', '2028-01-09'), 5, 'A-038: working days exclude weekends');
  perform tests.eq(public.working_days('2028-01-09', '2028-01-03'), null::int, 'A-038: no answer for an end before the start');
  perform tests.throws($q$select public.set_up_leave_year(2028)$q$, '%Only the Owner%', 'A-038: staff cannot set up a leave year');
end $$;
reset role;

select tests.login('owner@t');
set role authenticated;
do $$
declare annual uuid := (select id from public.leave_types where name = 'Annual');
begin
  perform tests.eq(public.set_up_leave_year(2028), (select count(*)::int from public.staff where is_active),
                   'A-038: one Annual entitlement per active person (other types have no default)');
  perform tests.eq((select entitled_days from public.leave_entitlements e join public.staff s on s.id = e.staff_id
                    where s.full_name = 'Francis Austin' and e.leave_year = 2028 and e.leave_type_id = annual), 15.0,
                   'A-038: a full year gets the default');
  perform tests.eq((select entitled_days from public.leave_entitlements e join public.staff s on s.id = e.staff_id
                    where s.full_name = 'NSP1 - Technical' and e.leave_year = 2028), 7.5,
                   'A-038: someone leaving on 30 Jun is pro-rated (15 x 182/366, to the half day)');
  perform tests.eq((select carried_over_days from public.leave_entitlements e join public.staff s on s.id = e.staff_id
                    where s.full_name = 'Ernest Gbadago' and e.leave_year = 2028), 5.0,
                   'A-038: unused annual leave carries over up to the cap');
  perform tests.eq((select carried_over_days from public.leave_entitlements e join public.staff s on s.id = e.staff_id
                    where s.full_name = 'Francis Austin' and e.leave_year = 2028), 0.0,
                   'A-038: nothing to carry, nothing carried');
  perform tests.eq(public.set_up_leave_year(2028), 0, 'A-038: running it again adds nothing');
end $$;
reset role;

-- 33 (other branch): the Project lead approves an overdrawing request as Unpaid,
-- in one change, as the /leave screen does.
select tests.login('ernest@t', 'aal1');
set role authenticated;
insert into public.leave_requests (staff_id, leave_type_id, start_date, end_date, reason)
select app.my_staff_id(), (select id from public.leave_types where name = 'Annual'), '2028-03-06', '2028-03-31', 'Unpaid path';
reset role;
select tests.login('francis@t');
set role authenticated;
update public.leave_requests
   set status = 'approved', leave_type_id = (select id from public.leave_types where name = 'Unpaid'),
       decision_note = 'Approved as Unpaid: not enough Annual leave left'
 where reason = 'Unpaid path';
do $$ begin
  perform tests.eq((select t.name from public.leave_requests r join public.leave_types t on t.id = r.leave_type_id
                    where r.reason = 'Unpaid path' and r.status = 'approved'), 'Unpaid',
                   '33: the Project lead can approve it as Unpaid leave');
  perform tests.eq((select available from public.leave_balances b join public.staff s on s.id = b.staff_id
                    where s.full_name = 'Ernest Gbadago' and b.leave_year = 2028 and b.leave_type = 'Annual'), 20.0,
                   '33: and the annual balance is untouched');
end $$;
reset role;
