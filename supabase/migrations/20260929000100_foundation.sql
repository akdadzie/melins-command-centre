-- =============================================================================
-- 0100 Foundation: roles, profiles, access helpers, audit log, Director write
-- block, gapless numbering, month locks, notifications and action items.
-- See DECISIONS.md A-002..A-005, A-007, A-008, D-017, D-021.
-- =============================================================================

-- Private helper schema. Not exposed through the API; policies call into it.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.app_role as enum
  ('owner', 'director', 'accountant', 'admin', 'project_lead', 'staff');

-- Accountant review of money entries (brief §4: Recorded -> Reviewed / Queried)
create type public.review_status as enum
  ('recorded', 'reviewed', 'queried', 'not_required');

-- Money-out approval flow (brief §4): Prepared -> Approved -> Paid
create type public.payout_status as enum
  ('prepared', 'approved', 'paid', 'cancelled');

-- -----------------------------------------------------------------------------
-- Companies (version 2 hook, A-007). One row today: MeLiNS.
-- -----------------------------------------------------------------------------
create table public.companies (
  id uuid primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);
insert into public.companies (id, name)
values ('00000000-0000-0000-0000-000000000001', 'MeLiNS Associates Limited');

create or replace function app.default_company() returns uuid
language sql immutable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;

-- -----------------------------------------------------------------------------
-- Profiles: one per log-in. The role lives here (brief §3).
-- staff_id is linked in 0200 once the staff table exists.
-- -----------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role public.app_role not null,
  staff_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Directors (for current accounts, payments to directors and D-017 "own account").
create table public.directors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  profile_id uuid unique references public.profiles (user_id),
  is_owner boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index directors_one_owner on public.directors (is_owner) where is_owner;

-- Areas the Owner can hide from Directors (D-017). Visible by default.
create table public.director_hidden_areas (
  area text primary key check (area in ('salaries', 'staff_costs', 'other_director_accounts')),
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.director_hidden_areas (area) values
  ('salaries'), ('staff_costs'), ('other_director_accounts');

-- -----------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so they can read profiles regardless of RLS.
--
-- app.my_role() returns NULL (= no access anywhere) when the user is inactive,
-- or is Owner / Director / Accountant without a verified second factor (A-005).
-- -----------------------------------------------------------------------------
create or replace function app.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role
  from public.profiles p
  where p.user_id = auth.uid()
    and p.is_active
    and (p.role not in ('owner', 'director', 'accountant')
         or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
$$;

create or replace function app.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_role() = any (roles), false)
$$;

-- Finance-restricted information: Owner, Directors, Accountant only (brief §4).
create or replace function app.is_finance() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('owner', 'director', 'accountant')
$$;

-- Finance roles that may write (Directors never write).
create or replace function app.is_finance_writer() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('owner', 'accountant')
$$;

-- False only for a Director when the Owner has hidden the area (D-017).
create or replace function app.area_visible(p_area text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.my_role() is distinct from 'director'
      or not coalesce((select h.hidden from public.director_hidden_areas h where h.area = p_area), false)
$$;

create or replace function app.my_staff_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.staff_id from public.profiles p where p.user_id = auth.uid() and p.is_active
$$;

create or replace function app.my_director_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select d.id from public.directors d where d.profile_id = auth.uid()
$$;

create or replace function app.today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Accra')::date $$;

grant execute on all functions in schema app to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Generic triggers
-- -----------------------------------------------------------------------------

-- Keeps updated_at / updated_by current on tables that have them.
create or replace function app.touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if to_jsonb(new) ? 'updated_by' then
    new := jsonb_populate_record(new, jsonb_build_object('updated_by', auth.uid()));
  end if;
  return new;
end $$;

-- Directors are read-only everywhere, enforced in the database (brief §4, A-004).
-- This is a second lock behind the RLS write policies, which never admit Directors.
-- It checks the raw profile (ignoring 2FA state), so it holds even if a policy is
-- written wrongly later.
create or replace function app.block_director_writes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'director') then
    raise exception 'Directors have read-only access' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- -----------------------------------------------------------------------------
-- Audit log (brief §3): who, what, when, old and new values.
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index audit_log_record on public.audit_log (table_name, record_id);
create index audit_log_changed_at on public.audit_log (changed_at);

create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return null;
  end if;
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (tg_table_name,
          coalesce(r ->> 'id', r ->> 'user_id', r ->> 'month', r ->> 'area'),
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  return null;
end $$;

-- Attaches the audit trigger to a table. Used by every later migration.
create or replace function app.enable_audit(p_table regclass) returns void
language plpgsql as $$
begin
  execute format(
    'create trigger audit after insert or update or delete on %s for each row execute function app.audit()',
    p_table);
end $$;

-- -----------------------------------------------------------------------------
-- Gapless numbering (A-008, D-021). The counter row is locked by the UPDATE, so
-- two approvals can't take the same number, and a rolled-back approval gives
-- its number back. year = 0 for series that never reset (assets).
-- -----------------------------------------------------------------------------
create table public.number_sequences (
  series text not null,
  year int not null,
  last_value int not null default 0 check (last_value >= 0),
  primary key (series, year)
);

create or replace function app.next_number(p_series text, p_year int) returns int
language sql security definer set search_path = '' as $$
  insert into public.number_sequences as s (series, year, last_value)
  values (p_series, p_year, 1)
  on conflict (series, year) do update set last_value = s.last_value + 1
  returning last_value
$$;

-- Imported documents keep their numbers; new numbers continue after the highest (D-021).
create or replace function app.bump_number(p_series text, p_year int, p_value int) returns void
language sql security definer set search_path = '' as $$
  insert into public.number_sequences as s (series, year, last_value)
  values (p_series, p_year, p_value)
  on conflict (series, year) do update set last_value = greatest(s.last_value, excluded.last_value)
$$;

-- Parses the running number out of e.g. INV-2026-014 -> (2026, 14), MEL-AST-007 -> (0, 7).
create or replace function app.parse_number(p_number text, out year int, out seq int)
language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(p_number, '^[A-Z]+-(\d{4})-(\d+)$');
  if m is not null then
    year := m[1]::int; seq := m[2]::int; return;
  end if;
  m := regexp_match(p_number, '^[A-Z]+-[A-Z]+-(\d+)$');
  if m is not null then
    year := 0; seq := m[1]::int; return;
  end if;
  raise exception 'Unrecognised document number format: %', p_number;
end $$;

-- -----------------------------------------------------------------------------
-- Month close and locks (brief §3 "Locked records", §7.8)
-- -----------------------------------------------------------------------------
create table public.month_closes (
  month date primary key check (extract(day from month) = 1),
  status text not null default 'open' check (status in ('open', 'closed')),
  admin_checklist jsonb not null default '{}',
  admin_completed_at timestamptz,
  admin_completed_by uuid references public.profiles (user_id),
  accountant_checklist jsonb not null default '{}',
  closed_at timestamptz,
  closed_by uuid references public.profiles (user_id),
  owner_reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.month_reopenings (
  id uuid primary key default gen_random_uuid(),
  month date not null references public.month_closes (month),
  reason text not null check (length(trim(reason)) > 0),
  reopened_by uuid not null default auth.uid() references public.profiles (user_id),
  reopened_at timestamptz not null default now()
);

create or replace function app.is_month_closed(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.month_closes m
    where m.month = date_trunc('month', p_date)::date and m.status = 'closed')
$$;

-- Trigger: rejects changes to rows dated in a closed month. TG_ARGV[0] names the
-- date column. Checks both the old and the new date, so a row can't be moved
-- out of (or into) a closed month either.
create or replace function app.guard_closed_month() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  col text := tg_argv[0];
  d_old date;
  d_new date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    d_old := (to_jsonb(old) ->> col)::date;
    if d_old is not null and app.is_month_closed(d_old) then
      raise exception 'The month of % is closed. Ask the Owner to reopen it, or post a reversing entry in an open month.',
        to_char(d_old, 'Mon YYYY') using errcode = '42501';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    d_new := (to_jsonb(new) ->> col)::date;
    if d_new is not null and app.is_month_closed(d_new) then
      raise exception 'The month of % is closed.', to_char(d_new, 'Mon YYYY') using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create or replace function app.enable_month_lock(p_table regclass, p_date_column text) returns void
language plpgsql as $$
begin
  execute format(
    'create trigger month_lock before insert or update or delete on %s for each row execute function app.guard_closed_month(%L)',
    p_table, p_date_column);
end $$;

-- -----------------------------------------------------------------------------
-- Notifications (in-app first; email for overdue / approvals). Every one links
-- to its record (brief §3).
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (user_id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text not null,
  record_type text,
  record_id uuid,
  send_email boolean not null default false,
  emailed_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient on public.notifications (recipient_id, read_at, created_at desc);

create or replace function app.notify(
  p_recipient uuid, p_kind text, p_title text, p_link text,
  p_record_type text default null, p_record_id uuid default null,
  p_body text default null, p_email boolean default false)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, kind, title, body, link, record_type, record_id, send_email)
  select p_recipient, p_kind, p_title, p_body, p_link, p_record_type, p_record_id, p_email
  where p_recipient is not null
$$;

create or replace function app.notify_role(
  p_role public.app_role, p_kind text, p_title text, p_link text,
  p_record_type text default null, p_record_id uuid default null,
  p_body text default null, p_email boolean default false)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, kind, title, body, link, record_type, record_id, send_email)
  select p.user_id, p_kind, p_title, p_body, p_link, p_record_type, p_record_id, p_email
  from public.profiles p where p.role = p_role and p.is_active
$$;

-- -----------------------------------------------------------------------------
-- Action items: the task list behind Admin's home screen ("Record this
-- receipt", "Complete reported payment", ...). Assigned to a role or a person.
-- -----------------------------------------------------------------------------
create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  link text not null,
  assigned_role public.app_role,
  assigned_to uuid references public.profiles (user_id),
  record_type text,
  record_id uuid,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_date date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid,
  check (assigned_role is not null or assigned_to is not null)
);
create index action_items_open on public.action_items (status, assigned_role, assigned_to);
create unique index action_items_one_open_per_record
  on public.action_items (kind, record_id) where status = 'open' and record_id is not null;

create or replace function app.open_action(
  p_kind text, p_title text, p_link text, p_role public.app_role,
  p_record_type text, p_record_id uuid, p_due date default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.action_items (kind, title, link, assigned_role, record_type, record_id, due_date)
  values (p_kind, p_title, p_link, p_role, p_record_type, p_record_id, p_due)
  on conflict (kind, record_id) where status = 'open' and record_id is not null do nothing
$$;

create or replace function app.close_action(p_kind text, p_record_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.action_items
     set status = 'done', done_at = now(), done_by = auth.uid()
   where kind = p_kind and record_id = p_record_id and status = 'open'
$$;

-- -----------------------------------------------------------------------------
-- RLS for this migration's tables
-- -----------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.directors enable row level security;
alter table public.director_hidden_areas enable row level security;
alter table public.audit_log enable row level security;
alter table public.number_sequences enable row level security;
alter table public.month_closes enable row level security;
alter table public.month_reopenings enable row level security;
alter table public.notifications enable row level security;
alter table public.action_items enable row level security;

create policy companies_read on public.companies for select to authenticated
  using (app.my_role() is not null);

-- Names and roles are needed across the app (approver names, "entered by").
create policy profiles_read on public.profiles for select to authenticated
  using (app.my_role() is not null or user_id = auth.uid());
create policy profiles_owner_write on public.profiles for all to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));

create policy directors_read on public.directors for select to authenticated
  using (app.is_finance());
create policy directors_owner_write on public.directors for all to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));

create policy hidden_areas_read on public.director_hidden_areas for select to authenticated
  using (app.is_finance());
create policy hidden_areas_owner_write on public.director_hidden_areas for update to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));

create policy audit_read on public.audit_log for select to authenticated
  using (app.has_role('owner', 'accountant'));
-- No write policies: only the SECURITY DEFINER trigger writes the audit log.

-- number_sequences: no policies. Only SECURITY DEFINER functions touch it.

create policy month_closes_read on public.month_closes for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin'));
-- Month-close changes go through app functions in 0600 (close / reopen / checklists).

create policy month_reopenings_read on public.month_reopenings for select to authenticated
  using (app.is_finance());

create policy notifications_own_read on public.notifications for select to authenticated
  using (recipient_id = auth.uid());
-- Marking a notification read is the one write a Director may make (personal UI state).
create policy notifications_own_mark_read on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create policy action_items_read on public.action_items for select to authenticated
  using (app.has_role('owner', 'accountant')
         or assigned_to = auth.uid()
         or (assigned_role = app.my_role() and app.my_role() <> 'director'));
create policy action_items_update on public.action_items for update to authenticated
  using (app.has_role('owner', 'accountant') or assigned_to = auth.uid() or assigned_role = app.my_role())
  with check (app.my_role() is not null and app.my_role() <> 'director');

-- Profiles: keep at least one active Owner, and audit every role change.
create or replace function app.keep_an_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where role = 'owner' and is_active) then
    raise exception 'There must always be one active Owner';
  end if;
  return null;
end $$;
create constraint trigger keep_an_owner after update or delete on public.profiles
  deferrable initially deferred for each row execute function app.keep_an_owner();

create trigger touch before update on public.profiles for each row execute function app.touch();
create trigger touch before update on public.month_closes for each row execute function app.touch();

select app.enable_audit('public.profiles');
select app.enable_audit('public.directors');
select app.enable_audit('public.director_hidden_areas');
select app.enable_audit('public.month_closes');
select app.enable_audit('public.month_reopenings');
