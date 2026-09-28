-- =============================================================================
-- 0300 Jobs, timesheets and leave (brief §7.3, §4 timesheet window; D-013..D-015)
-- =============================================================================

-- Lets trusted internal functions (leave fill, payroll approval, ...) bypass
-- the user-facing guards on a table for the rest of the transaction.
create or replace function app.in_system() returns boolean
language sql stable as $$ select coalesce(current_setting('app.system', true), '') = 'on' $$;

create or replace function app.enter_system() returns void
language sql as $$ select set_config('app.system', 'on', true) $$;

create or replace function app.leave_system() returns void
language sql as $$ select set_config('app.system', '', true) $$;

-- Profile id of a staff member (NULL if they have no log-in).
create or replace function app.staff_profile(p_staff uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.profiles where staff_id = p_staff
$$;

create or replace function app.staff_is_owner(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where staff_id = p_staff and role = 'owner')
$$;

-- May the current user approve this person's timesheets and leave? (D-013, D-015)
-- The Owner approves anyone; otherwise only the person's named approver.
create or replace function app.can_approve_for(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('owner')
      or (app.has_role('project_lead')
          and exists (select 1 from public.staff s
                      where s.id = p_staff and s.approver_staff_id = app.my_staff_id()))
$$;

-- -----------------------------------------------------------------------------
-- Jobs (brief §7.3). Number MEL-YYYY-NNN is allocated on creation, inside the
-- insert transaction, so a failed insert returns its number (A-008).
-- -----------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text unique,
  title text not null,
  client_id uuid not null references public.clients (id),
  referrer_id uuid references public.referrers (id),
  job_type_id uuid references public.job_types (id),
  contract_mode text not null default 'consultancy' check (contract_mode in ('consultancy', 'design_build')),
  delivery_status text not null default 'not_started' check (delivery_status in
    ('not_started', 'in_progress', 'on_hold', 'under_review', 'completed', 'closed')),
  fee_basis text not null default 'lump_sum' check (fee_basis in
    ('lump_sum', 'percent_of_construction', 'monthly', 'time_based')),
  fee numeric(14,2) check (fee >= 0),                 -- agreed fee; D&B: contract sum
  fee_percent numeric(7,4) check (fee_percent > 0),   -- when fee_basis = percent_of_construction
  construction_value numeric(16,2) check (construction_value >= 0),
  retention_pct numeric(5,2) not null default 0 check (retention_pct between 0 and 100),
  retention_basis text not null default 'net' check (retention_basis in ('net', 'gross')),   -- D-020
  retention_release_terms text,
  retention_release_date date,
  start_date date,
  due_date date,
  percent_complete numeric(5,2) not null default 0 check (percent_complete between 0 and 100),
  project_lead_staff_id uuid references public.staff (id),
  is_goodwill boolean not null default false,
  notes text,
  is_imported boolean not null default false,
  currency char(3) not null default 'GHS',
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (fee_basis <> 'percent_of_construction' or (construction_value is not null and fee_percent is not null))
);
create index jobs_client on public.jobs (client_id);

create table public.job_team (
  job_id uuid not null references public.jobs (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  primary key (job_id, staff_id)
);

create or replace function app.on_my_job(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_team t where t.job_id = p_job and t.staff_id = app.my_staff_id())
      or exists (select 1 from public.jobs j where j.id = p_job and j.project_lead_staff_id = app.my_staff_id())
$$;

create or replace function app.jobs_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n int; y int;
begin
  -- Fee from construction value (brief §7.3)
  if new.fee_basis = 'percent_of_construction' then
    new.fee := round(new.construction_value * new.fee_percent / 100, 2);
  end if;

  if tg_op = 'INSERT' then
    if new.is_imported then
      if new.job_number is null then raise exception 'An imported job must keep its existing number'; end if;
      select p.year, p.seq into y, n from app.parse_number(new.job_number) p;
      perform app.bump_number('MEL', y, n);                         -- D-021
    else
      y := extract(year from app.today())::int;
      n := app.next_number('MEL', y);
      new.job_number := format('MEL-%s-%s', y, lpad(n::text, 3, '0'));
    end if;
  else
    if new.job_number is distinct from old.job_number then
      raise exception 'A job number cannot be changed';
    end if;
    -- Admin keeps billing and contracts current but can't change the commercial terms.
    if app.my_role() = 'admin' and (
         new.fee is distinct from old.fee or new.fee_basis is distinct from old.fee_basis
      or new.fee_percent is distinct from old.fee_percent
      or new.construction_value is distinct from old.construction_value
      or new.retention_pct is distinct from old.retention_pct
      or new.retention_basis is distinct from old.retention_basis
      or new.contract_mode is distinct from old.contract_mode) then
      raise exception 'Only the Owner or Project lead can change a job''s fee, retention or contract mode'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger before_write before insert or update on public.jobs
  for each row execute function app.jobs_before_write();

-- Hour budgets by role (entered by hand in Phase A; from quotes in Phase B).
create table public.job_hour_budgets (
  job_id uuid not null references public.jobs (id) on delete cascade,
  budget_role_id uuid not null references public.budget_roles (id),
  hours numeric(8,2) not null check (hours >= 0),
  primary key (job_id, budget_role_id)
);

-- Billing milestones (consultancy jobs). invoice_id is linked in 0400.
create table public.billing_milestones (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  seq int not null default 1,
  name text not null,
  amount numeric(14,2) check (amount >= 0),
  percent_of_fee numeric(6,3) check (percent_of_fee > 0 and percent_of_fee <= 100),
  trigger_description text,
  target_date date,
  status text not null default 'pending' check (status in ('pending', 'reached', 'invoiced', 'paid')),
  reached_on date,
  reached_by uuid references public.profiles (user_id),
  invoice_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount is not null or percent_of_fee is not null)
);
create index billing_milestones_job on public.billing_milestones (job_id, seq);

create or replace function app.milestones_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.percent_of_fee is not null then
    new.amount := round((select fee from public.jobs where id = new.job_id) * new.percent_of_fee / 100, 2);
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and not app.in_system() then
    -- Only Pending <-> Reached is a manual change, by the Owner or Project lead.
    -- Invoiced and Paid are set by the invoice and payment triggers.
    if not (old.status in ('pending', 'reached') and new.status in ('pending', 'reached')) then
      raise exception 'Milestone status % is set automatically', new.status;
    end if;
    if not app.has_role('owner', 'project_lead') then
      raise exception 'Only the Owner or Project lead can mark a milestone reached' using errcode = '42501';
    end if;
    if new.status = 'reached' then
      new.reached_on := coalesce(new.reached_on, app.today());
      new.reached_by := auth.uid();
    else
      new.reached_on := null; new.reached_by := null;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status in ('invoiced', 'paid') and not app.in_system()
     and (new.amount is distinct from old.amount or new.job_id is distinct from old.job_id) then
    raise exception 'An invoiced milestone cannot be changed';
  end if;
  return new;
end $$;
create trigger before_write before insert or update on public.billing_milestones
  for each row execute function app.milestones_before_write();

-- Notify Admin when a milestone is reached (brief §9).
create or replace function app.milestones_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  if new.status = 'reached' and (tg_op = 'INSERT' or old.status <> 'reached') then
    select * into j from public.jobs where id = new.job_id;
    perform app.notify_role('admin', 'milestone_reached',
      format('%s: milestone "%s" reached. Ready to invoice.', j.job_number, new.name),
      format('/jobs/%s?tab=milestones', j.job_number), 'billing_milestone', new.id);
  end if;
  return null;
end $$;
create trigger after_write after insert or update on public.billing_milestones
  for each row execute function app.milestones_after_write();

-- Contracts register (per job).
create table public.job_contracts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  doc_type text not null check (doc_type in
    ('appointment_letter', 'signed_agreement', 'letter_of_award', 'variation', 'subcontract_agreement', 'other')),
  doc_date date,
  parties text,
  value numeric(14,2),
  payment_terms text,
  retention_terms text,
  liability_cap text,
  file_path text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- -----------------------------------------------------------------------------
-- Leave (brief §7.3)
-- -----------------------------------------------------------------------------
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_paid boolean not null default true,
  uses_annual_balance boolean not null default false,
  requires_document boolean not null default false,
  document_after_days int,          -- e.g. sick leave beyond N days needs a medical certificate
  default_entitled_days numeric(5,1),
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table public.leave_entitlements (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  leave_type_id uuid not null references public.leave_types (id),
  leave_year int not null,
  entitled_days numeric(5,1) not null check (entitled_days >= 0),
  carried_over_days numeric(5,1) not null default 0 check (carried_over_days >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, leave_type_id, leave_year)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  leave_type_id uuid not null references public.leave_types (id),
  start_date date not null,
  end_date date not null,
  working_days int not null default 0,
  reason text,
  document_path text,
  status text not null default 'requested' check (status in ('requested', 'approved', 'declined', 'cancelled', 'taken')),
  decided_by uuid references public.profiles (user_id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index leave_requests_staff on public.leave_requests (staff_id, start_date);

-- Leave year of a date (leave year starts in settings.leave_year_start_month).
create or replace function app.leave_year(p_date date) returns int
language sql stable security definer set search_path = '' as $$
  select case when extract(month from p_date) >= s.leave_year_start_month
              then extract(year from p_date)::int else extract(year from p_date)::int - 1 end
  from app.settings_at(p_date) s
$$;

-- entitled + carried over - taken - approved future = available (brief §7.3)
create or replace function app.leave_balance(p_staff uuid, p_leave_type uuid, p_year int,
  out entitled numeric, out carried_over numeric, out taken numeric, out booked numeric, out available numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  select coalesce(sum(e.entitled_days), 0), coalesce(sum(e.carried_over_days), 0)
    into entitled, carried_over
    from public.leave_entitlements e
   where e.staff_id = p_staff and e.leave_type_id = p_leave_type and e.leave_year = p_year;
  select coalesce(sum(r.working_days) filter (where r.end_date < app.today()), 0),
         coalesce(sum(r.working_days) filter (where r.end_date >= app.today()), 0)
    into taken, booked
    from public.leave_requests r
   where r.staff_id = p_staff and r.leave_type_id = p_leave_type
     and r.status in ('approved', 'taken') and app.leave_year(r.start_date) = p_year;
  available := entitled + carried_over - taken - booked;
end $$;

create or replace function app.leave_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.leave_types;
  bal record;
begin
  select * into t from public.leave_types where id = new.leave_type_id;
  new.working_days := app.working_days_in(new.start_date, new.end_date);
  if new.working_days = 0 then
    raise exception 'The leave dates contain no working days';
  end if;
  if exists (select 1 from public.leave_requests r
             where r.staff_id = new.staff_id and r.id <> new.id
               and r.status in ('requested', 'approved', 'taken')
               and daterange(r.start_date, r.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'This overlaps another leave request';
  end if;

  if tg_op = 'INSERT' then
    if new.staff_id <> coalesce(app.my_staff_id(), '00000000-0000-0000-0000-000000000000') and not app.has_role('owner') then
      raise exception 'You can only request leave for yourself' using errcode = '42501';
    end if;
    -- The Owner's own leave is recorded without approval (brief §4).
    if app.staff_is_owner(new.staff_id) then
      new.status := 'approved'; new.decided_by := auth.uid(); new.decided_at := now();
    else
      new.status := 'requested'; new.decided_by := null; new.decided_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if app.in_system() then return new; end if;
  if old.status <> 'requested' and (new.start_date, new.end_date, new.leave_type_id, new.staff_id)
       is distinct from (old.start_date, old.end_date, old.leave_type_id, old.staff_id) then
    raise exception 'Only a pending request can be changed';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'requested' and new.status in ('approved', 'declined') then
      if not app.can_approve_for(new.staff_id) then
        raise exception 'You are not this person''s leave approver' using errcode = '42501';
      end if;
      if new.status = 'approved' and t.uses_annual_balance then
        bal := app.leave_balance(new.staff_id, new.leave_type_id, app.leave_year(new.start_date));
        if bal.available - new.working_days < 0 and not app.has_role('owner') then
          raise exception 'This takes the annual balance below zero: only the Owner can approve it, or change it to Unpaid leave'
            using errcode = '42501';
        end if;
      end if;
      new.decided_by := auth.uid(); new.decided_at := now();
    elsif new.status = 'cancelled' and old.status in ('requested', 'approved') then
      if old.status = 'approved' and old.start_date <= app.today() then
        raise exception 'Approved leave can only be cancelled before it starts';
      end if;
      if not (new.staff_id = app.my_staff_id() or app.can_approve_for(new.staff_id)) then
        raise exception 'Not allowed' using errcode = '42501';
      end if;
    elsif new.status = 'taken' and old.status = 'approved' then
      if not app.has_role('owner') then raise exception 'Not allowed' using errcode = '42501'; end if;
    else
      raise exception 'Leave cannot move from % to %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;
create trigger before_write before insert or update on public.leave_requests
  for each row execute function app.leave_before_write();

-- -----------------------------------------------------------------------------
-- Timesheets (brief §4, §7.3; A-013)
-- -----------------------------------------------------------------------------
create table public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  -- Client-generated id for the offline retry queue: resending the same entry
  -- is a no-op instead of a duplicate (brief §3 "retry automatically").
  client_ref uuid unique,
  staff_id uuid not null references public.staff (id),
  work_date date not null,
  category text not null check (category in ('job', 'internal', 'business_development', 'goodwill', 'leave')),
  job_id uuid references public.jobs (id),
  hours numeric(4,2) not null check (hours >= 0 and hours <= 16 and hours * 4 = trunc(hours * 4)),
  description text,
  budget_role_id uuid references public.budget_roles (id),   -- role at the time (set by trigger)
  billable boolean not null default false,                   -- set by trigger
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'returned')),
  return_note text,
  approved_by uuid references public.profiles (user_id),
  approved_at timestamptz,
  is_late_entry boolean not null default false,
  late_reason text,
  entered_by uuid default auth.uid() references public.profiles (user_id),
  leave_request_id uuid references public.leave_requests (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((category = 'job') = (job_id is not null)),
  check (category = 'leave' or hours > 0),
  check (not is_late_entry or length(trim(coalesce(late_reason, ''))) > 0)
);
create index timesheet_staff_date on public.timesheet_entries (staff_id, work_date);
create index timesheet_job on public.timesheet_entries (job_id) where job_id is not null;
create index timesheet_pending on public.timesheet_entries (status) where status = 'submitted';

-- Frozen rates, written once on approval (brief §8). Finance-restricted.
create table public.timesheet_rate_snapshots (
  entry_id uuid primary key references public.timesheet_entries (id) on delete cascade,
  cost_rate numeric(12,2),
  charge_out_rate numeric(12,2),
  frozen_at timestamptz not null default now()
);

-- Working days elapsed since the day worked (brief §4, A-013). A weekend or
-- holiday counts from the next working day.
create or replace function app.timesheet_days_elapsed(p_work_date date) returns int
language sql stable security definer set search_path = '' as $$
  select greatest(0, app.working_days_between(app.next_working_day(p_work_date), app.today()))
$$;

create or replace function app.timesheet_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.timesheet_entries := coalesce(new, old);
  st public.staff;
  s public.settings_versions := app.settings_at(app.today());
  days int;
  me uuid := app.my_staff_id();
  role public.app_role := app.my_role();
  owner_target boolean;
begin
  if app.in_system() then return coalesce(new, old); end if;

  select * into st from public.staff where id = r.staff_id;
  owner_target := app.staff_is_owner(r.staff_id);

  -- Approved entries are locked, whatever the window (brief §4).
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'approved' then
    raise exception 'This timesheet entry is approved and locked' using errcode = '42501';
  end if;

  -- Approving or returning: only the approver, and nothing else may change.
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'returned') then
    if not app.can_approve_for(new.staff_id) or new.staff_id = me then
      raise exception 'You are not this person''s timesheet approver' using errcode = '42501';
    end if;
    if (new.work_date, new.category, new.job_id, new.hours, new.staff_id)
       is distinct from (old.work_date, old.category, old.job_id, old.hours, old.staff_id) then
      raise exception 'Approve or return an entry without changing it';
    end if;
    if new.status = 'approved' then
      new.approved_by := auth.uid(); new.approved_at := now(); new.return_note := null;
    elsif length(trim(coalesce(new.return_note, ''))) = 0 then
      raise exception 'Say why the entry is being returned';
    end if;
    return new;
  end if;

  if r.category = 'leave' then
    raise exception 'Leave entries are created by approving a leave request';
  end if;
  if tg_op <> 'DELETE' and new.work_date > app.today() then
    raise exception 'Time can''t be logged for a future date';
  end if;

  -- The entry window (brief §4). Checked against the old date too, so an entry
  -- can't be moved out of a closed window.
  days := app.timesheet_days_elapsed(r.work_date);
  if tg_op = 'UPDATE' then
    days := greatest(days, app.timesheet_days_elapsed(old.work_date));
  end if;

  if r.staff_id = me then
    if not owner_target and days > s.timesheet_self_days then
      raise exception 'The entry window for % has closed. Ask % to enter it for you, with a reason.',
        to_char(r.work_date, 'DD Mon YYYY'),
        case when days <= s.timesheet_lead_days and st.approver_staff_id is not null
                  and not app.staff_is_owner(st.approver_staff_id)
             then 'your Project lead' else 'the Owner' end
        using errcode = '42501';
    end if;
  else
    -- Entry on someone's behalf: Project lead for their team on days 4-10,
    -- the Owner at any time. Always marked as a late entry with a reason.
    if not (role = 'owner'
            or (role = 'project_lead' and st.approver_staff_id = me
                and days > s.timesheet_self_days and days <= s.timesheet_lead_days)) then
      raise exception 'You can''t enter or change time for this person on this date' using errcode = '42501';
    end if;
    if tg_op <> 'DELETE' then
      new.is_late_entry := true;
      new.entered_by := auth.uid();
      if length(trim(coalesce(new.late_reason, ''))) = 0 then
        raise exception 'A reason is required when entering time for someone else';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;

  -- Role at the time and billable default (D-014).
  if tg_op = 'INSERT' or new.staff_id is distinct from old.staff_id then
    new.budget_role_id := st.budget_role_id;
  end if;
  new.billable := new.category = 'job' and st.billable_default
                  and not coalesce((select is_goodwill from public.jobs where id = new.job_id), false);

  -- The Owner's own time is auto-approved; everything else (re)enters approval.
  if owner_target and new.staff_id = me then
    new.status := 'approved'; new.approved_by := auth.uid(); new.approved_at := now();
  else
    new.status := 'submitted'; new.approved_by := null; new.approved_at := null;
  end if;
  return new;
end $$;
create trigger before_write before insert or update or delete on public.timesheet_entries
  for each row execute function app.timesheet_before_write();

-- A person can't log more than 16 hours in a day (A-013).
create or replace function app.timesheet_day_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select sum(hours) from public.timesheet_entries
      where staff_id = new.staff_id and work_date = new.work_date) > 16 then
    raise exception 'More than 16 hours logged on %', to_char(new.work_date, 'DD Mon YYYY');
  end if;
  return null;
end $$;
create constraint trigger day_cap after insert or update on public.timesheet_entries
  for each row execute function app.timesheet_day_cap();

-- Freeze rates when an entry is approved (brief §8: rates in force on the entry date).
create or replace function app.timesheet_freeze_rates() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rt record;
begin
  if new.status = 'approved' and new.category <> 'leave' and (tg_op = 'INSERT' or old.status <> 'approved') then
    rt := app.staff_rates_at(new.staff_id, new.work_date);
    insert into public.timesheet_rate_snapshots (entry_id, cost_rate, charge_out_rate)
    values (new.id, rt.cost_rate, rt.charge_out_rate)
    on conflict (entry_id) do nothing;
  end if;
  return null;
end $$;
create trigger freeze_rates after insert or update on public.timesheet_entries
  for each row execute function app.timesheet_freeze_rates();

-- Approving leave fills its working days with Leave entries (0 billable hours);
-- cancelling it removes them (brief §7.3).
create or replace function app.leave_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  st public.staff;
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    select * into st from public.staff where id = new.staff_id;
    perform app.enter_system();
    insert into public.timesheet_entries
      (staff_id, work_date, category, hours, description, budget_role_id, billable,
       status, approved_by, approved_at, leave_request_id, entered_by)
    select new.staff_id, g.d::date, 'leave', 0,
           (select name from public.leave_types where id = new.leave_type_id),
           st.budget_role_id, false, 'approved', new.decided_by, now(), new.id, new.decided_by
    from generate_series(new.start_date, new.end_date, interval '1 day') g(d)
    where app.is_working_day(g.d::date);
    perform app.leave_system();
    perform app.notify(app.staff_profile(new.staff_id), 'leave_decided',
      format('Your leave from %s to %s is approved', to_char(new.start_date, 'DD Mon YYYY'), to_char(new.end_date, 'DD Mon YYYY')),
      '/me/leave', 'leave_request', new.id);
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status = 'approved' then
    perform app.enter_system();
    delete from public.timesheet_entries where leave_request_id = new.id;
    perform app.leave_system();
  elsif tg_op = 'UPDATE' and new.status = 'declined' and old.status = 'requested' then
    perform app.notify(app.staff_profile(new.staff_id), 'leave_decided', 'Your leave request was declined',
      '/me/leave', 'leave_request', new.id);
  elsif tg_op = 'INSERT' and new.status = 'requested' then
    perform app.notify(
      coalesce(app.staff_profile((select approver_staff_id from public.staff where id = new.staff_id)),
               (select user_id from public.profiles where role = 'owner' and is_active limit 1)),
      'leave_requested', 'New leave request to approve', '/leave', 'leave_request', new.id, null, true);
  end if;
  return null;
end $$;
create trigger after_write after insert or update on public.leave_requests
  for each row execute function app.leave_after_write();

-- -----------------------------------------------------------------------------
-- Views with restricted columns
-- -----------------------------------------------------------------------------

-- Staff see their own jobs: name, deadlines, status only (brief §4).
create view public.my_jobs with (security_barrier) as
  select j.id, j.job_number, j.title, j.delivery_status, j.start_date, j.due_date, j.percent_complete,
         c.name as client_name
  from public.jobs j join public.clients c on c.id = j.client_id
  where app.my_role() is not null and app.on_my_job(j.id);

-- Who is away: names and dates only, never the type or reason (brief §7.3).
create view public.leave_calendar with (security_barrier) as
  select r.id, s.full_name, r.start_date, r.end_date
  from public.leave_requests r join public.staff s on s.id = r.staff_id
  where app.my_role() is not null and r.status in ('approved', 'taken');

-- The Project lead sees final charge-out rates only (brief §4).
create view public.timesheet_charge_out with (security_barrier) as
  select s.entry_id, s.charge_out_rate
  from public.timesheet_rate_snapshots s
  where app.has_role('owner', 'director', 'accountant', 'project_lead');

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.jobs enable row level security;
alter table public.job_team enable row level security;
alter table public.job_hour_budgets enable row level security;
alter table public.billing_milestones enable row level security;
alter table public.job_contracts enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_entitlements enable row level security;
alter table public.leave_requests enable row level security;
alter table public.timesheet_entries enable row level security;
alter table public.timesheet_rate_snapshots enable row level security;

create policy jobs_read on public.jobs for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead'));
create policy jobs_insert on public.jobs for insert to authenticated
  with check (app.has_role('owner', 'admin', 'project_lead'));
create policy jobs_update on public.jobs for update to authenticated
  using (app.has_role('owner', 'admin', 'project_lead')) with check (app.has_role('owner', 'admin', 'project_lead'));

create policy job_team_read on public.job_team for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead') or staff_id = app.my_staff_id());
create policy job_team_write on public.job_team for all to authenticated
  using (app.has_role('owner', 'project_lead')) with check (app.has_role('owner', 'project_lead'));

create policy hour_budgets_read on public.job_hour_budgets for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'project_lead'));
create policy hour_budgets_write on public.job_hour_budgets for all to authenticated
  using (app.has_role('owner', 'project_lead')) with check (app.has_role('owner', 'project_lead'));

create policy milestones_read on public.billing_milestones for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead'));
create policy milestones_write on public.billing_milestones for all to authenticated
  using (app.has_role('owner', 'admin', 'project_lead')) with check (app.has_role('owner', 'admin', 'project_lead'));

create policy contracts_read on public.job_contracts for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead'));
create policy contracts_write on public.job_contracts for all to authenticated
  using (app.has_role('owner', 'admin', 'project_lead')) with check (app.has_role('owner', 'admin', 'project_lead'));

create policy leave_types_read on public.leave_types for select to authenticated using (app.my_role() is not null);
create policy leave_types_write on public.leave_types for all to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));

create policy entitlements_read on public.leave_entitlements for select to authenticated
  using (app.has_role('owner', 'director', 'accountant')
         or staff_id = app.my_staff_id()
         or (app.has_role('project_lead') and app.can_approve_for(staff_id)));
create policy entitlements_write on public.leave_entitlements for all to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));

-- Leave type, reason and documents: only the person, their approver, Owner,
-- Directors and Accountant (brief §7.3). Colleagues use leave_calendar.
create policy leave_read on public.leave_requests for select to authenticated
  using (app.has_role('owner', 'director', 'accountant')
         or staff_id = app.my_staff_id()
         or (app.has_role('project_lead') and app.can_approve_for(staff_id)));
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (app.has_role('owner', 'admin', 'project_lead', 'staff', 'accountant')
              and (staff_id = app.my_staff_id() or app.has_role('owner')));
create policy leave_update on public.leave_requests for update to authenticated
  using (app.has_role('owner') or staff_id = app.my_staff_id()
         or (app.has_role('project_lead') and app.can_approve_for(staff_id)))
  with check (app.my_role() is not null and app.my_role() <> 'director');

create policy timesheet_read on public.timesheet_entries for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'project_lead') or staff_id = app.my_staff_id());
create policy timesheet_insert on public.timesheet_entries for insert to authenticated
  with check (app.has_role('owner', 'project_lead', 'staff', 'admin')
              and (staff_id = app.my_staff_id() or app.has_role('owner', 'project_lead')));
create policy timesheet_update on public.timesheet_entries for update to authenticated
  using (app.has_role('owner', 'project_lead', 'staff', 'admin')
         and (staff_id = app.my_staff_id() or app.has_role('owner', 'project_lead')))
  with check (app.has_role('owner', 'project_lead', 'staff', 'admin'));
create policy timesheet_delete on public.timesheet_entries for delete to authenticated
  using (app.has_role('owner', 'project_lead', 'staff', 'admin')
         and (staff_id = app.my_staff_id() or app.has_role('owner', 'project_lead')));

create policy rate_snapshots_read on public.timesheet_rate_snapshots for select to authenticated
  using (app.is_finance() and app.area_visible('staff_costs'));
-- No write policies: snapshots are written only by the approval trigger.

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create trigger touch before update on public.jobs for each row execute function app.touch();
create trigger touch before update on public.billing_milestones for each row execute function app.touch();
create trigger touch before update on public.leave_entitlements for each row execute function app.touch();
create trigger touch before update on public.leave_requests for each row execute function app.touch();
create trigger touch before update on public.timesheet_entries for each row execute function app.touch();

select app.enable_audit(t) from unnest(array[
  'public.jobs', 'public.billing_milestones', 'public.job_hour_budgets',
  'public.leave_entitlements', 'public.leave_requests', 'public.timesheet_entries',
  'public.timesheet_rate_snapshots']::regclass[]) t;
