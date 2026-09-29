-- =============================================================================
-- 1100 User provisioning (brief §3: invite only; only the Owner creates users).
-- * The invite-user Edge Function invites through the Auth admin API with
--   {full_name, role, staff_id, director_id} in the user metadata; this
--   trigger turns that into the profile. Public sign-up is off, so only the
--   service role can create auth users.
-- * app.bootstrap_owner() creates the very first Owner profile. It is run once
--   per environment from the Supabase SQL editor (docs/SETUP_INFRA.md §9) and
--   refuses if an Owner already exists.
-- =============================================================================

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
    update public.staff set email = lower(new.email) where id = v_staff;
  end if;
  if v_director is not null then
    update public.directors set profile_id = new.id where id = v_director and profile_id is null;
  end if;
  return new;
end $$;

create trigger provision_profile after insert on auth.users
  for each row execute function app.provision_profile();

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
  update public.staff set email = lower(trim(p_email)) where id = v_staff;
  update public.directors set profile_id = uid where is_owner;
  return 'Owner profile created for ' || p_email || '. Sign in and set up two-factor authentication.';
end $$;

revoke execute on function app.provision_profile() from public, anon, authenticated;
revoke execute on function app.bootstrap_owner(text) from public, anon, authenticated;

-- Users screen: everything the Owner needs to manage people, without auth internals.
create view public.user_directory with (security_barrier) as
  select p.user_id, p.full_name, p.email, p.role, p.is_active, p.staff_id, s.full_name as staff_name,
         d.id as director_id, u.last_sign_in_at, u.email_confirmed_at is not null as accepted_invite
  from public.profiles p
  join auth.users u on u.id = p.user_id
  left join public.staff s on s.id = p.staff_id
  left join public.directors d on d.profile_id = p.user_id
  where app.has_role('owner');
