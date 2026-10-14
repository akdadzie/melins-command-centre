-- Migration 2400: Security Advisor fixes (D-056). Emails restricted, names not.
\set ON_ERROR_STOP 1

do $$ begin
  perform tests.eq((select count(*)::int from pg_views v where v.schemaname = 'public' and v.definition ~ 'auth\.users'),
    0, 'no public view reads auth.users');
  perform tests.eq((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
                      and has_table_privilege('anon', c.oid, 'select')),
    0, 'anon can select from no public table or view');
  perform tests.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
                      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
    0, 'anon can execute no public function');
  perform tests.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('app', 'public') and p.prokind = 'f'
                      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
                      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
    0, 'every app/public function has a fixed search_path');
  perform tests.eq((select count(*)::int from information_schema.columns
                    where table_schema = 'public' and table_name = 'staff' and column_name = 'email'),
    0, 'staff.email has moved to staff_private');
end $$;

-- anon
select set_config('request.jwt.claims', '{"role":"anon"}', false);
set role anon;
do $$ begin
  perform tests.throws('select email from public.profiles', '%permission denied%', 'anon: profiles');
  perform tests.throws('select email from public.staff_private', '%permission denied%', 'anon: staff_private');
  perform tests.throws('select * from public.user_directory()', '%permission denied%', 'anon: user_directory()');
  perform tests.throws('select full_name from public.staff', '%permission denied%', 'anon: staff names');
end $$;
reset role;

-- Staff: own email only; colleagues' names still visible
select tests.login('ernest@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.profiles), 1, 'staff: only their own profile');
  perform tests.eq((select email from public.profiles), 'ernest@t', 'staff: their own email');
  perform tests.eq((select count(*)::int from public.staff_private where email is not null and email <> 'ernest@t'), 0, 'staff: no colleague email');
  perform tests.eq((select count(*)::int from public.user_directory()), 0, 'staff: no user directory');
  perform tests.ok((select count(*) from public.staff where full_name in ('Francis Austin', 'Ibrahim Commedan')) = 2, 'staff: colleagues'' names');
end $$;
reset role;

-- Project lead: team names, no team emails
select tests.login('francis@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.ok((select count(*) from public.staff s join public.staff a on a.id = s.approver_staff_id
                    where a.full_name = 'Francis Austin') >= 1, 'lead: names of the staff they approve');
  perform tests.eq((select count(*)::int from public.profiles where email <> 'francis@t'), 0, 'lead: no other profile');
  perform tests.eq((select count(*)::int from public.staff_private where email <> 'francis@t'), 0, 'lead: no team email');
end $$;
reset role;

-- Directors and the Accountant: names
select tests.login('kofi@t');
set role authenticated;
do $$ begin
  perform tests.ok((select count(*) from public.staff where full_name = 'Ernest Gbadago') = 1, 'director: staff names');
end $$;
reset role;
select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.ok((select count(*) from public.staff where full_name = 'Ernest Gbadago') = 1, 'accountant: staff names');
  perform tests.eq((select count(*)::int from public.user_directory()), 0, 'accountant: no user directory');
end $$;
reset role;

-- Owner: everything
select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.ok((select count(*) from public.profiles) >= 8, 'owner: all profiles');
  perform tests.ok((select count(*) from public.user_directory() where email = 'ernest@t' and staff_name = 'Ernest Gbadago') = 1, 'owner: user directory with emails');
  perform tests.eq((select email from public.staff_private sp join public.staff s on s.id = sp.staff_id
                    where s.full_name = 'Ernest Gbadago'), 'ernest@t', 'owner: staff email');
end $$;
reset role;
select set_config('request.jwt.claims', '', false);
