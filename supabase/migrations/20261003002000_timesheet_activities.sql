-- =============================================================================
-- 2000 Timesheet improvements (DECISIONS D-042..D-044)
--  * D-042 Every work entry names an activity: one from the Owner's list
--    (grouped, editable in Settings) or a custom one typed by the person.
--    Custom activities are reported so the Owner can promote common ones.
--    "What you did" is required, at least 10 characters.
--  * D-043 Entering time for someone inside their own window (3 working days)
--    isn't late: it's recorded as entered by the Project lead or Owner, no
--    reason needed. From day 4 it's a late entry and needs a reason.
--  * D-044 Hours by activity, per job and per person.
-- =============================================================================

create table public.timesheet_activities (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (group_name, name)
);

insert into public.timesheet_activities (group_name, name, sort_order) values
  ('Design', 'Scheme/concept design', 101), ('Design', 'Analysis and modelling', 102),
  ('Design', 'Design calculations', 103), ('Design', 'Design checking/review', 104),
  ('Drawings', 'Drafting/CAD', 201), ('Drawings', 'Reinforcement detailing', 202),
  ('Drawings', 'Bar bending schedules', 203), ('Drawings', 'Drawing revisions', 204),
  ('Reports', 'Report writing', 301), ('Reports', 'Specifications', 302), ('Reports', 'BOQ/quantities', 303),
  ('Coordination', 'Client/consultant meeting', 401), ('Coordination', 'Coordination (architect, MEP)', 402),
  ('Coordination', 'Correspondence', 403),
  ('Site', 'Site visit/inspection', 501), ('Site', 'Supervision', 502), ('Site', 'Testing/sampling', 503), ('Site', 'Travel', 504),
  ('Admin', 'Proposals/fee quotes', 601), ('Admin', 'Invoicing/accounts', 602), ('Admin', 'Office admin', 603),
  ('Admin', 'Training/CPD', 604);

alter table public.timesheet_activities enable row level security;
create policy activities_read on public.timesheet_activities for select to authenticated using (app.my_role() is not null);
create policy activities_write on public.timesheet_activities for all to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));
select app.enable_director_block('public.timesheet_activities');
select app.enable_audit('public.timesheet_activities');

alter table public.timesheet_entries
  add column activity_id uuid references public.timesheet_activities (id),
  add column activity_custom text,
  add constraint timesheet_one_activity check (activity_id is null or activity_custom is null);
create index timesheet_activity on public.timesheet_entries (activity_id) where activity_id is not null;

-- -----------------------------------------------------------------------------
-- The entry rules: as 0300, with on-behalf entries inside the window allowed
-- and not late (D-043), and activity and description required (D-042).
-- -----------------------------------------------------------------------------
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
    if tg_op <> 'DELETE' then
      new.is_late_entry := false; new.late_reason := null; new.entered_by := auth.uid();
    end if;
  else
    -- On someone's behalf (D-043): the Owner at any time; the Project lead for
    -- their team up to day 10. Inside the person's own window it's not late
    -- (recorded as entered by the approver); after it, it's a late entry with
    -- a reason (brief §4).
    if not (role = 'owner'
            or (role = 'project_lead' and st.approver_staff_id = me and days <= s.timesheet_lead_days)) then
      raise exception 'You can''t enter or change time for this person on this date' using errcode = '42501';
    end if;
    if tg_op <> 'DELETE' then
      new.entered_by := auth.uid();
      if days > s.timesheet_self_days and not owner_target then
        new.is_late_entry := true;
        if length(trim(coalesce(new.late_reason, ''))) = 0 then
          raise exception 'A reason is required: this is after %''s own entry window', st.full_name;
        end if;
      else
        new.is_late_entry := false; new.late_reason := null;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;

  -- What was done (D-042): an activity from the list or typed, and a description.
  new.activity_custom := nullif(trim(coalesce(new.activity_custom, '')), '');
  if new.activity_id is null and new.activity_custom is null then
    raise exception 'Choose the activity (or type your own under Custom)';
  end if;
  if length(trim(coalesce(new.description, ''))) < 10 then
    raise exception 'Say what you did, in at least 10 characters';
  end if;

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

-- -----------------------------------------------------------------------------
-- D-044: hours by activity, per job and per person. Leave is left out.
-- Everyone sees their own; the Owner, Directors, Accountant and Project lead
-- see everyone's (as for timesheets).
-- -----------------------------------------------------------------------------
create or replace function public.timesheet_activity_hours(p_from date, p_to date)
returns table (staff_id uuid, full_name text, job_id uuid, job_number text, job_title text, category text,
               activity_group text, activity text, is_custom boolean, hours numeric, entries int)
language sql stable security definer set search_path = '' as $$
  select te.staff_id, st.full_name, te.job_id, j.job_number, j.title, te.category,
         coalesce(a.group_name, case when te.activity_custom is not null then 'Other' else 'Not recorded' end),
         coalesce(a.name, te.activity_custom, '(before activities were recorded)'),
         te.activity_custom is not null,
         sum(te.hours), count(*)::int
  from public.timesheet_entries te
  join public.staff st on st.id = te.staff_id
  left join public.jobs j on j.id = te.job_id
  left join public.timesheet_activities a on a.id = te.activity_id
  where te.category <> 'leave' and te.work_date between p_from and p_to
    and (app.has_role('owner', 'director', 'accountant', 'project_lead') or te.staff_id = app.my_staff_id())
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9
$$;
revoke execute on function public.timesheet_activity_hours(date, date) from public, anon;
grant execute on function public.timesheet_activity_hours(date, date) to authenticated;

-- Custom activities typed by staff, most used first, for the Owner to promote.
create view public.timesheet_custom_activities with (security_barrier) as
  select lower(te.activity_custom) as key, min(te.activity_custom) as activity, count(*)::int as entries,
         sum(te.hours) as hours, count(distinct te.staff_id)::int as people, max(te.work_date) as last_used
  from public.timesheet_entries te
  where te.activity_custom is not null and app.has_role('owner', 'director', 'accountant', 'project_lead')
  group by lower(te.activity_custom);

-- The Owner promotes a custom activity into the list. Entries that used that
-- text are moved onto the new list item (only the activity label changes;
-- hours, rates and approval stay as they were).
create or replace function public.promote_custom_activity(p_custom text, p_group text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app.has_role('owner') then raise exception 'Only the Owner edits the activity list' using errcode = '42501'; end if;
  if length(trim(coalesce(p_group, ''))) = 0 or length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the group and the name';
  end if;
  insert into public.timesheet_activities (group_name, name, sort_order)
  values (trim(p_group), trim(p_name),
          coalesce((select max(sort_order) + 1 from public.timesheet_activities where group_name = trim(p_group)), 900))
  on conflict (group_name, name) do update set is_active = true
  returning id into v_id;
  perform app.enter_system();
  update public.timesheet_entries set activity_id = v_id, activity_custom = null
   where lower(activity_custom) = lower(trim(p_custom));
  perform app.leave_system();
  return v_id;
end $$;
revoke execute on function public.promote_custom_activity(text, text, text) from public, anon;
grant execute on function public.promote_custom_activity(text, text, text) to authenticated;
