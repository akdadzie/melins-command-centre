-- =============================================================================
-- 2400 Security Advisor fixes (D-056).
-- * auth_users_exposed: public.user_directory joined auth.users in an
--   API-exposed schema. It becomes a SECURITY DEFINER function that returns
--   rows to the Owner only, and nothing to anyone else.
-- * Emails, not names: profiles is readable by the user themself (and the
--   Owner, through profiles_owner_write); staff.email moves to staff_private
--   (Owner, finance and the person themself). Names stay where they were:
--   staff.full_name is still readable by every signed-in role.
-- * anon gets nothing in public: no table or view, and no function. Nothing in
--   the app reads data before sign-in.
-- * function_search_path_mutable: every app/public function gets search_path ''.
--   All of them already use schema-qualified names.
-- security_definer_view stays as decided in A-029 (views check the role
-- themselves); anon can no longer select from them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Users screen: a function instead of a view over auth.users
-- -----------------------------------------------------------------------------
drop view public.user_directory;

create function public.user_directory()
returns table (user_id uuid, full_name text, email text, role public.app_role, is_active boolean,
               staff_id uuid, staff_name text, director_id uuid, last_sign_in_at timestamptz,
               accepted_invite boolean)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.full_name, p.email, p.role, p.is_active, p.staff_id, s.full_name,
         d.id, u.last_sign_in_at, u.email_confirmed_at is not null
  from public.profiles p
  join auth.users u on u.id = p.user_id
  left join public.staff s on s.id = p.staff_id
  left join public.directors d on d.profile_id = p.user_id
  where app.has_role('owner')
$$;
revoke execute on function public.user_directory() from public, anon;
grant execute on function public.user_directory() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Profiles: your own row. The Owner reads all rows through profiles_owner_write.
-- SECURITY DEFINER functions (notifications, approvals) are unaffected.
-- -----------------------------------------------------------------------------
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Staff email moves to staff_private
-- -----------------------------------------------------------------------------
alter table public.staff_private add column email text unique;

insert into public.staff_private (staff_id, email)
select id, email from public.staff where email is not null
on conflict (staff_id) do update set email = excluded.email;

alter table public.staff drop column email;

create or replace function app.provision_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}');
  v_staff uuid := nullif(m ->> 'staff_id', '')::uuid;
  v_director uuid := nullif(m ->> 'director_id', '')::uuid;
begin
  if not (m ? 'role') then
    return new;                      -- no role: no profile (the app shows "No access yet")
  end if;
  insert into public.profiles (user_id, full_name, email, role, staff_id)
  values (new.id, coalesce(nullif(m ->> 'full_name', ''), new.email), lower(new.email),
          (m ->> 'role')::public.app_role, v_staff)
  on conflict (user_id) do nothing;
  if v_staff is not null then
    insert into public.staff_private (staff_id, email) values (v_staff, lower(new.email))
    on conflict (staff_id) do update set email = excluded.email;
  end if;
  if v_director is not null then
    update public.directors set profile_id = new.id where id = v_director and profile_id is null;
  end if;
  return new;
end $$;

create or replace function app.bootstrap_owner(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  v_staff uuid;
begin
  if exists (select 1 from public.profiles where role = 'owner') then
    raise exception 'An Owner already exists; invite other users from Settings > Users';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'No log-in for %: invite it first (Authentication > Users > Invite user)', p_email;
  end if;
  select id into v_staff from public.staff where full_name = 'Kwasi Dadzie Ennison';
  insert into public.profiles (user_id, full_name, email, role, staff_id)
  values (uid, 'Kwasi Dadzie Ennison', lower(trim(p_email)), 'owner', v_staff);
  if v_staff is not null then
    insert into public.staff_private (staff_id, email) values (v_staff, lower(trim(p_email)))
    on conflict (staff_id) do update set email = excluded.email;
  end if;
  update public.directors set profile_id = uid where is_owner;
  return 'Owner profile created for ' || p_email || '. Sign in and set up two-factor authentication.';
end $$;
revoke execute on function app.bootstrap_owner(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- anon: nothing in public, now or later
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Functions are executable by PUBLIC unless revoked, so revoke from PUBLIC too,
-- keeping signed-in access exactly as it was.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
           has_function_privilege('service_role', p.oid, 'execute') as service_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.auth_ok then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if f.service_ok then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Fixed search_path on every app/public function that lacks one
-- -----------------------------------------------------------------------------
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = %L', f, '');
  end loop;
end $$;
