-- TEST ONLY. Helpers for the SQL acceptance tests: create users per role,
-- "log in" as them, and assert.
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- Creates an auth user + profile; optionally links a seeded staff member or director.
create or replace function tests.create_user(p_email text, p_name text, p_role public.app_role,
  p_staff_name text default null, p_director_name text default null) returns uuid
language plpgsql as $$
declare uid uuid;
begin
  insert into auth.users (email) values (p_email) returning id into uid;
  insert into public.profiles (user_id, full_name, email, role, staff_id)
  values (uid, p_name, p_email, p_role, (select id from public.staff where full_name = p_staff_name));
  if p_staff_name is not null then
    update public.staff set email = p_email where full_name = p_staff_name;
  end if;
  if p_director_name is not null then
    update public.directors set profile_id = uid where full_name = p_director_name;
  end if;
  return uid;
end $$;

create or replace function tests.uid(p_email text) returns uuid
language sql stable as $$ select id from auth.users where email = p_email $$;

-- Sets the JWT claims PostgREST would set. Follow with SET ROLE authenticated.
create or replace function tests.login(p_email text, p_aal text default 'aal2') returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', tests.uid(p_email), 'role', 'authenticated', 'aal', p_aal)::text, false)
$$;

-- Asserts that a statement fails, with an error message matching p_like.
create or replace function tests.throws(p_sql text, p_like text default '%', p_label text default null) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not ilike p_like then
      raise exception 'FAIL %: expected error like "%" but got "%"', coalesce(p_label, p_sql), p_like, sqlerrm;
    end if;
    raise notice 'ok  % (rejected: %)', coalesce(p_label, left(p_sql, 60)), sqlerrm;
    return;
  end;
  raise exception 'FAIL %: expected an error, statement succeeded', coalesce(p_label, p_sql);
end $$;

create or replace function tests.eq(p_actual anyelement, p_expected anyelement, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok  %', p_label;
end $$;

create or replace function tests.ok(p_cond boolean, p_label text) returns void
language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAIL %', p_label; end if;
  raise notice 'ok  %', p_label;
end $$;

-- Rows changed by a statement (0 = the write had no effect).
create or replace function tests.rows(p_sql text) returns int
language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- A working date exactly n working days before today (for the timesheet window).
create or replace function tests.working_days_ago(n int) returns date
language sql stable as $$
  select min(d)::date from generate_series(app.today() - 60, app.today(), interval '1 day') g(d)
  where app.is_working_day(d::date) and app.timesheet_days_elapsed(d::date) = n
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- The acceptance tests use dates around "today", some before the real
-- go-live (1 Oct 2026), so they run with an earlier go-live. 95_test_* checks
-- the go-live floor itself.
update app.system_config set go_live_date = '2025-01-01';
