-- The test people: staff records, directors and log-ins, all named "ACC ..."
-- with e-mail addresses at the reserved .invalid domain (never emailed,
-- migration 2300). Log-ins carry their role in the metadata, as the
-- invite-user function does, so app.provision_profile() makes the profiles.
-- {{PASSWORD}} is replaced with a random password for this run.
do $$
declare
  role_id uuid;
  owner_staff uuid; lead_staff uuid; eng1 uuid; eng2 uuid; admin_staff uuid; nsp uuid;
  dir1 uuid; dir2 uuid;
  u record;
  uid uuid;
begin
  insert into public.staff (full_name, job_title, budget_role_id, start_date, approver_staff_id)
  values ('ACC Owner', 'Managing Director', (select id from public.budget_roles where name = 'Managing Director'), '2019-01-01', null)
  returning id into owner_staff;
  insert into public.staff (full_name, job_title, budget_role_id, start_date, approver_staff_id)
  values ('ACC Lead', 'Senior Engineer', (select id from public.budget_roles where name = 'Senior Engineer'), '2019-01-01', owner_staff)
  returning id into lead_staff;
  insert into public.staff (full_name, job_title, budget_role_id, start_date, approver_staff_id)
  values ('ACC Engineer', 'Graduate Engineer', (select id from public.budget_roles where name = 'Graduate Engineer'), '2019-01-01', lead_staff)
  returning id into eng1;
  insert into public.staff (full_name, job_title, budget_role_id, start_date, approver_staff_id)
  values ('ACC Engineer Two', 'Graduate Engineer', (select id from public.budget_roles where name = 'Graduate Engineer'), '2019-01-01', lead_staff)
  returning id into eng2;
  insert into public.staff (full_name, job_title, budget_role_id, start_date, approver_staff_id, is_national_service, billable_default)
  values ('ACC Admin', 'Administrator (national service)', (select id from public.budget_roles where name = 'Admin'), '2019-01-01', owner_staff, true, false)
  returning id into admin_staff;
  insert into public.staff (full_name, job_title, budget_role_id, start_date, approver_staff_id, is_national_service)
  values ('ACC NSP', 'National service engineer', (select id from public.budget_roles where name = 'National service engineer'), '2019-01-01', lead_staff, true)
  returning id into nsp;

  insert into public.staff_cost_history (staff_id, effective_from, monthly_cost, basic_pay, notes) values
    (owner_staff, '2019-01-01', 20340, 18000, 'Acceptance test'),
    (lead_staff, '2019-01-01', 7458, 6600, 'Acceptance test'),
    (eng1, '2019-01-01', 4065, 3600, 'Acceptance test'),
    (eng2, '2019-01-01', 4065, 3600, 'Acceptance test'),
    (admin_staff, '2019-01-01', 1200, 1200, 'Acceptance test'),
    (nsp, '2019-01-01', 1200, 1200, 'Acceptance test');

  insert into public.directors (full_name) values ('ACC Director One') returning id into dir1;
  insert into public.directors (full_name) values ('ACC Director Two') returning id into dir2;

  for u in select * from (values
      ('acc-owner', 'ACC Owner', 'owner', owner_staff, null::uuid),
      ('acc-director1', 'ACC Director One', 'director', null, dir1),
      ('acc-director2', 'ACC Director Two', 'director', null, dir2),
      ('acc-accountant', 'ACC Accountant', 'accountant', null, null),
      ('acc-admin', 'ACC Admin', 'admin', admin_staff, null),
      ('acc-lead', 'ACC Lead', 'project_lead', lead_staff, null),
      ('acc-engineer', 'ACC Engineer', 'staff', eng1, null),
      ('acc-engineer2', 'ACC Engineer Two', 'staff', eng2, null),
      ('acc-nsp', 'ACC NSP', 'staff', nsp, null)) v(handle, full_name, role, staff_id, director_id)
  loop
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
            u.handle || '@melins-acceptance.invalid', extensions.crypt('{{PASSWORD}}', extensions.gen_salt('bf')), now(),
            '{"provider": "email", "providers": ["email"]}',
            jsonb_strip_nulls(jsonb_build_object('full_name', u.full_name, 'role', u.role,
                                                 'staff_id', u.staff_id, 'director_id', u.director_id)),
            now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, 'email',
            jsonb_build_object('sub', uid::text, 'email', u.handle || '@melins-acceptance.invalid', 'email_verified', true),
            now(), now(), now());
  end loop;
end $$;

select json_build_object(
  'staff', (select json_object_agg(full_name, id) from public.staff where full_name like 'ACC %'),
  'directors', (select json_object_agg(full_name, id) from public.directors where full_name like 'ACC %'),
  'users', (select json_object_agg(split_part(email, '@', 1), user_id) from public.profiles where email like '%@melins-acceptance.invalid'),
  'today', (select app.today()),
  'd3', (select min(d)::date from generate_series(app.today() - 60, app.today(), interval '1 day') g(d)
         where app.is_working_day(d::date) and app.timesheet_days_elapsed(d::date) = 3),
  'd4', (select min(d)::date from generate_series(app.today() - 60, app.today(), interval '1 day') g(d)
         where app.is_working_day(d::date) and app.timesheet_days_elapsed(d::date) = 4),
  'd11', (select min(d)::date from generate_series(app.today() - 60, app.today(), interval '1 day') g(d)
          where app.is_working_day(d::date) and app.timesheet_days_elapsed(d::date) = 11)
) as fixtures;
