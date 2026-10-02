-- =============================================================================
-- 1600 Reminders and routines (brief §9; A-042)
-- Two scheduled routines write in-app notifications, each linking to its
-- record. Notifications flagged send_email are emailed by the mailer once
-- SMTP is set up (docs/SETUP_INFRA.md).
--   app.run_daily_reminders()   every day at 06:00 Accra: date-based reminders,
--                               recurring drafts, timesheet escalation
--   app.run_timesheet_nudges()  working days at 17:00: no hours logged today
-- Every reminder has a key, so a routine can run again (or twice in a day)
-- without repeating itself. Both take the date as a parameter for testing.
-- =============================================================================

alter table public.notifications add column reminder_key text;
create unique index notifications_reminder_once on public.notifications (recipient_id, reminder_key)
  where reminder_key is not null;

-- First day the system runs (D-029): nothing before it is chased.
create or replace function app.go_live_date() returns date
language sql immutable as $$ select date '2026-10-01' $$;

create or replace function app.remind(
  p_recipient uuid, p_key text, p_kind text, p_title text, p_link text,
  p_record_type text default null, p_record_id uuid default null,
  p_body text default null, p_email boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_recipient is null then return 0; end if;
  insert into public.notifications (recipient_id, kind, title, body, link, record_type, record_id, send_email, reminder_key)
  values (p_recipient, p_kind, p_title, p_body, p_link, p_record_type, p_record_id, p_email, p_key)
  on conflict (recipient_id, reminder_key) where reminder_key is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function app.remind_role(
  p_role public.app_role, p_key text, p_kind text, p_title text, p_link text,
  p_record_type text default null, p_record_id uuid default null,
  p_body text default null, p_email boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare uid uuid; n int := 0;
begin
  for uid in select user_id from public.profiles where role = p_role and is_active loop
    n := n + app.remind(uid, p_key, p_kind, p_title, p_link, p_record_type, p_record_id, p_body, p_email);
  end loop;
  return n;
end $$;

create or replace function app.owner_profile() returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.profiles where role = 'owner' and is_active order by created_at limit 1
$$;

create or replace function app.ghs(p numeric) returns text
language sql immutable as $$ select 'GHS ' || to_char(p, 'FM999,999,999,990.00') $$;

create or replace function app.dmy(p date) returns text
language sql immutable as $$ select to_char(p, 'FMDD Mon YYYY') $$;

-- -----------------------------------------------------------------------------
-- Daily routine
-- -----------------------------------------------------------------------------
create or replace function app.run_daily_reminders(p_today date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d date := coalesce(p_today, app.today());
  m date := date_trunc('month', coalesce(p_today, app.today()))::date;
  s public.settings_versions := app.settings_at(coalesce(p_today, app.today()));
  counts jsonb := '{}';
  n int;
  r record;
  owner_id uuid := app.owner_profile();
  bal record;
begin
  -- Recurring expenses: a draft for Admin on each due date ...
  counts := counts || jsonb_build_object('recurring_drafts_created', app.generate_recurring_drafts(d));
  -- ... and a reminder for drafts still unconfirmed after 5 days.
  n := 0;
  for r in select x.id, x.description, x.expense_date from public.expenses x
           where x.entry_status = 'draft' and x.expense_date <= d - 5 loop
    n := n + app.remind_role('admin', 'draft5:' || r.id, 'recurring_draft_waiting',
      format('Recurring expense "%s" (%s) is still a draft. Please confirm it.', r.description, app.dmy(r.expense_date)),
      '/expenses', 'expense', r.id);
  end loop;
  counts := counts || jsonb_build_object('recurring_drafts', n);

  -- Tax and statutory: 7 days before, on the due date, and the day it becomes overdue.
  n := 0;
  for r in select l.id, l.due_date, ru.label, l.amount_due - coalesce(p.paid, 0) as outstanding, l.period_start
           from public.statutory_lines l
           join public.statutory_due_rules ru on ru.type = l.type
           left join lateral (select sum(sp.amount) as paid from public.statutory_payments sp
                              where sp.statutory_line_id = l.id and sp.status = 'paid') p on true
           where not l.is_opening_arrears and l.due_date in (d + 7, d, d - 1)
             and l.amount_due - coalesce(p.paid, 0) > 0.005 loop
    n := n + app.remind_role('accountant', 'stat' || (r.due_date - d) || ':' || r.id, 'statutory_due',
      case r.due_date - d when 7 then format('%s of %s due in 7 days (%s)', r.label, app.ghs(r.outstanding), app.dmy(r.due_date))
                          when 0 then format('%s of %s is due today', r.label, app.ghs(r.outstanding))
                          else format('%s of %s is now overdue (was due %s)', r.label, app.ghs(r.outstanding), app.dmy(r.due_date)) end,
      '/tax/statutory', 'statutory_line', r.id, null, true);
    n := n + app.remind(owner_id, 'stat' || (r.due_date - d) || ':' || r.id, 'statutory_due',
      case r.due_date - d when 7 then format('%s of %s due in 7 days (%s)', r.label, app.ghs(r.outstanding), app.dmy(r.due_date))
                          when 0 then format('%s of %s is due today', r.label, app.ghs(r.outstanding))
                          else format('%s of %s is now overdue (was due %s)', r.label, app.ghs(r.outstanding), app.dmy(r.due_date)) end,
      '/tax/statutory', 'statutory_line', r.id, null, true);
  end loop;
  counts := counts || jsonb_build_object('statutory', n);

  -- Invoices: chase 7 days before due, on the due date, and 14, 30 and 60 days
  -- overdue, with a polite reminder ready for Admin to send.
  n := 0;
  for r in select i.id, i.invoice_number, i.due_date, i.outstanding, c.name as client, d - i.due_date as late
           from public.invoices i join public.clients c on c.id = i.client_id
           where i.status in ('sent', 'part_paid') and i.outstanding > 0.005
             and d - i.due_date in (-7, 0, 14, 30, 60) loop
    n := n + app.remind_role('admin', 'chase' || r.late || ':' || r.id, 'invoice_chase',
      format('Chase %s (%s): %s', r.invoice_number, r.client,
             case when r.late < 0 then 'due in 7 days' when r.late = 0 then 'due today' else r.late || ' days overdue' end),
      '/invoices/' || r.invoice_number, 'invoice', r.id,
      format('Dear %s, this is a friendly reminder that invoice %s for %s %s %s. Please arrange payment quoting %s as the reference, '
             'and send the remittance advice and any WHT certificate to accounts@themelins.com. Thank you. MeLiNS Associates Limited.',
             r.client, r.invoice_number, app.ghs(r.outstanding),
             case when r.late < 0 then 'falls due on' when r.late = 0 then 'falls due today,' else 'was due on' end,
             case when r.late = 0 then '' else app.dmy(r.due_date) end, r.invoice_number),
      r.late > 0);
  end loop;
  counts := counts || jsonb_build_object('invoice_chase', n);

  -- Reported payments: daily to Admin until the details are complete; to the
  -- Owner if still unconfirmed after 14 days.
  n := 0;
  for r in select a.record_id, a.title, a.link from public.action_items a
           where a.kind = 'complete_reported_payment' and a.status = 'open' loop
    n := n + app.remind_role('admin', 'details:' || r.record_id || ':' || d, 'reported_payment_details', r.title, r.link, 'receipt', r.record_id);
  end loop;
  for r in select x.id, x.cash_amount, x.receipt_date, c.name from public.receipts x join public.clients c on c.id = x.client_id
           where x.status = 'reported' and x.receipt_date <= d - 14 loop
    n := n + app.remind(owner_id, 'unconf14:' || r.id, 'reported_payment_unconfirmed',
      format('Payment of %s from %s reported on %s is still not confirmed', app.ghs(r.cash_amount), r.name, app.dmy(r.receipt_date)),
      '/receipts?id=' || r.id, 'receipt', r.id, null, true);
  end loop;
  counts := counts || jsonb_build_object('reported_payments', n);

  -- Client money a director has held for more than 7 days (brief §7.4).
  n := 0;
  for r in select x.id, x.cash_amount, x.receipt_date, dr.full_name, dr.id as director_id
           from public.receipts x join public.directors dr on dr.id = x.received_by_director_id
           where x.status = 'confirmed' and x.receipt_date <= d - s.director_receipt_flag_days
             and app.director_balance(dr.id) < 0 loop
    n := n + app.remind(owner_id, 'dirheld:' || r.id, 'director_holds_client_money',
      format('%s has held %s of client money since %s. Record the transfer to a MeLiNS account.', r.full_name, app.ghs(r.cash_amount), app.dmy(r.receipt_date)),
      '/directors/' || r.director_id, 'receipt', r.id, null, true);
  end loop;
  counts := counts || jsonb_build_object('director_held', n);

  -- Milestones: past target and not marked; reached but not invoiced within 5 working days.
  n := 0;
  for r in select ms.id, ms.name, ms.target_date, j.job_number, j.project_lead_staff_id
           from public.billing_milestones ms join public.jobs j on j.id = ms.job_id
           where ms.status = 'pending' and ms.target_date < d and j.delivery_status not in ('completed', 'closed') loop
    n := n + app.remind(coalesce(app.staff_profile(r.project_lead_staff_id),
                                 (select user_id from public.profiles where role = 'project_lead' and is_active limit 1), owner_id),
      'mspast:' || r.id, 'milestone_past_target',
      format('%s: milestone "%s" is past its target date (%s). Mark it reached, or update the date.', r.job_number, r.name, app.dmy(r.target_date)),
      '/jobs/' || r.job_number || '?tab=milestones', 'billing_milestone', r.id);
  end loop;
  for r in select ms.id, ms.name, ms.reached_on, j.job_number from public.billing_milestones ms join public.jobs j on j.id = ms.job_id
           where ms.status = 'reached' and app.working_days_between(ms.reached_on, d) >= 5 loop
    n := n + app.remind_role('admin', 'msinv:' || r.id, 'milestone_not_invoiced',
      format('%s: milestone "%s" was reached on %s and is not invoiced yet', r.job_number, r.name, app.dmy(r.reached_on)),
      '/invoices/ready', 'billing_milestone', r.id);
    n := n + app.remind(owner_id, 'msinv:' || r.id, 'milestone_not_invoiced',
      format('%s: milestone "%s" was reached on %s and is not invoiced yet', r.job_number, r.name, app.dmy(r.reached_on)),
      '/invoices/ready', 'billing_milestone', r.id, null, true);
  end loop;
  counts := counts || jsonb_build_object('milestones', n);

  -- Retention: 30 days before the expected release date.
  n := 0;
  for r in select j.id, j.job_number, j.title, j.retention_release_date, app.job_retention_held(j.id) as held
           from public.jobs j where j.retention_release_date = d + 30 and app.job_retention_held(j.id) > 0 loop
    n := n + app.remind_role('admin', 'ret30:' || r.id || ':' || r.retention_release_date, 'retention_release',
      format('%s: retention of %s is due for release on %s. Prepare the release invoice.', r.job_number, app.ghs(r.held), app.dmy(r.retention_release_date)),
      '/invoices/retention', 'job', r.id);
    n := n + app.remind(owner_id, 'ret30:' || r.id || ':' || r.retention_release_date, 'retention_release',
      format('%s: retention of %s is due for release on %s', r.job_number, app.ghs(r.held), app.dmy(r.retention_release_date)),
      '/invoices/retention', 'job', r.id);
  end loop;
  counts := counts || jsonb_build_object('retention', n);

  -- WHT certificates not received within 30 days.
  n := 0;
  for r in select w.id, w.amount, w.expected_by, c.name from public.wht_certificates w join public.clients c on c.id = w.client_id
           where w.status = 'expected' and w.expected_by < d loop
    n := n + app.remind_role('admin', 'whtcert:' || r.id, 'wht_certificate_missing',
      format('Request the WHT certificate from %s for %s (expected by %s)', r.name, app.ghs(r.amount), app.dmy(r.expected_by)),
      '/receipts/wht', 'wht_certificate', r.id);
  end loop;
  counts := counts || jsonb_build_object('wht_certificates', n);

  -- Leave: remind the approver after 2 working days; in October, remind staff
  -- of unused annual leave above the carry-over limit.
  n := 0;
  for r in select lr.id, st.full_name, st.approver_staff_id, lr.start_date from public.leave_requests lr join public.staff st on st.id = lr.staff_id
           where lr.status = 'requested' and app.working_days_between(lr.created_at::date, d) >= 2 loop
    n := n + app.remind(coalesce(app.staff_profile(r.approver_staff_id), owner_id), 'leave2:' || r.id, 'leave_waiting',
      format('%s''s leave request (from %s) is waiting for your decision', r.full_name, app.dmy(r.start_date)),
      '/leave', 'leave_request', r.id, null, true);
  end loop;
  if extract(month from d) = 10 then
    for r in select st.id, lt.id as type_id from public.staff st cross join public.leave_types lt
             where st.is_active and lt.uses_annual_balance and lt.is_active
               and exists (select 1 from public.leave_entitlements e where e.staff_id = st.id and e.leave_type_id = lt.id
                           and e.leave_year = app.leave_year(d)) loop
      bal := app.leave_balance(r.id, r.type_id, app.leave_year(d));
      if bal.available > coalesce(s.max_carry_over_days, 0) then
        n := n + app.remind(app.staff_profile(r.id), 'leaveoct:' || app.leave_year(d) || ':' || r.id || ':' || r.type_id, 'unused_leave',
          format('You have %s days of annual leave left this year; only %s can be carried over. Plan your leave.',
                 bal.available, coalesce(s.max_carry_over_days, 0)),
          '/me/leave', 'staff', r.id);
      end if;
    end loop;
  end if;
  counts := counts || jsonb_build_object('leave', n);

  -- Payroll: the Accountant imports by the 20th (reminded on the 15th and the
  -- 20th); the Owner approves; Admin checks loan deductions.
  n := 0;
  if extract(day from d) >= 15 and not exists (select 1 from public.payroll_runs pr where pr.period_month = m
                                                and pr.run_kind = 'regular' and pr.status <> 'cancelled') then
    n := n + app.remind_role('accountant', 'payroll15:' || m, 'payroll_import',
      format('Import the %s payroll by the 20th', to_char(m, 'FMMonth YYYY')), '/payroll', null, null, null, false);
    if extract(day from d) >= 20 then
      n := n + app.remind_role('accountant', 'payroll20:' || m, 'payroll_import',
        format('The %s payroll is due for import today', to_char(m, 'FMMonth YYYY')), '/payroll', null, null, null, true);
    end if;
  end if;
  if extract(day from d) = 15 and exists (select 1 from public.staff_loans l where l.status = 'paid' and l.cleared_at is null) then
    n := n + app.remind_role('admin', 'loans:' || m, 'loan_deductions',
      format('Check that staff loan instalments are in the %s payroll sheet', to_char(m, 'FMMonth YYYY')), '/staff-loans');
  end if;
  for r in select pr.id, pr.period_month from public.payroll_runs pr where pr.status = 'imported' and pr.created_at::date <= d - 1 loop
    n := n + app.remind(owner_id, 'payrollapprove:' || r.id, 'payroll_approve',
      format('The %s payroll is imported and waiting for your approval', to_char(r.period_month, 'FMMonth YYYY')),
      '/payroll/' || to_char(r.period_month, 'YYYY-MM'), 'payroll_run', r.id, null, true);
  end loop;
  counts := counts || jsonb_build_object('payroll', n);

  -- Timesheets (brief §9): on day 3 a final warning that the window closes
  -- tonight; on day 4 the Project lead (or the Owner, for people the Owner
  -- approves) hears of each missing day; on day 11 the Owner does.
  n := 0;
  for r in select st.id, st.full_name, st.approver_staff_id, g.day,
                  app.working_days_between(g.day, d) as elapsed
           from public.staff st
           cross join lateral (select gs::date as day from generate_series(greatest(st.start_date, app.go_live_date()), d - 1, interval '1 day') gs) g
           where st.is_active and st.approver_staff_id is not null          -- the Owner's own time has no window
             and (st.end_date is null or g.day <= st.end_date)
             and app.is_working_day(g.day)
             and g.day >= d - 30
             and not exists (select 1 from public.timesheet_entries te where te.staff_id = st.id and te.work_date = g.day) loop
    if r.elapsed = s.timesheet_self_days then
      n := n + app.remind(app.staff_profile(r.id), 'tsfinal:' || r.id || ':' || r.day, 'timesheet_final_warning',
        format('Last chance: log your time for %s today. After tonight only your approver can enter it.', app.dmy(r.day)),
        '/timesheet?date=' || r.day, 'staff', r.id, null, true);
    elsif r.elapsed = s.timesheet_self_days + 1 then
      n := n + app.remind(coalesce(app.staff_profile(r.approver_staff_id), owner_id), 'tslead:' || r.id || ':' || r.day, 'timesheet_missing',
        format('%s has no time logged for %s. Only you can enter it now, with a reason.', r.full_name, app.dmy(r.day)),
        '/timesheet?date=' || r.day, 'staff', r.id, null, true);
    elsif r.elapsed = s.timesheet_lead_days + 1 then
      n := n + app.remind(owner_id, 'tsowner:' || r.id || ':' || r.day, 'timesheet_missing',
        format('%s has no time logged for %s. Only the Owner can enter it now.', r.full_name, app.dmy(r.day)),
        '/timesheet?date=' || r.day, 'staff', r.id, null, true);
    end if;
  end loop;
  -- Mondays: approvers hear of entries waiting for them.
  if extract(isodow from d) = 1 then
    for r in select coalesce(app.staff_profile(st.approver_staff_id), owner_id) as approver, count(*) as entries
             from public.timesheet_entries te join public.staff st on st.id = te.staff_id
             where te.status = 'submitted' and st.approver_staff_id is not null
             group by 1 loop
      n := n + app.remind(r.approver, 'tsapprove:' || d, 'timesheet_approvals',
        format('%s timesheet entr%s waiting for your approval', r.entries, case when r.entries = 1 then 'y is' else 'ies are' end),
        '/timesheet/approvals', null, null, null, true);
    end loop;
  end if;
  counts := counts || jsonb_build_object('timesheets', n);

  return counts;
end $$;

-- -----------------------------------------------------------------------------
-- 17:00 on working days: anyone with no hours logged today (approved leave
-- fills the day with Leave entries, so they're not reminded).
-- -----------------------------------------------------------------------------
create or replace function app.run_timesheet_nudges(p_today date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  d date := coalesce(p_today, app.today());
  r record;
  n int := 0;
begin
  if not app.is_working_day(d) or d < app.go_live_date() then return 0; end if;
  for r in select st.id from public.staff st
           where st.is_active and st.start_date <= d and (st.end_date is null or st.end_date >= d)
             and not exists (select 1 from public.timesheet_entries te where te.staff_id = st.id and te.work_date = d) loop
    n := n + app.remind(app.staff_profile(r.id), 'ts5pm:' || d, 'timesheet_nudge',
      'You haven''t logged any time today', '/timesheet', 'staff', r.id);
  end loop;
  return n;
end $$;

-- Internal routines: the scheduler runs them; the API can't.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('remind', 'remind_role', 'run_daily_reminders', 'run_timesheet_nudges')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Schedule (pg_cron; Accra is UTC+0 all year). Skipped where pg_cron isn't
-- available, e.g. the local test database.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('melins-daily-reminders', '0 6 * * *', 'select app.run_daily_reminders()');
    perform cron.schedule('melins-timesheet-nudge', '0 17 * * 1-5', 'select app.run_timesheet_nudges()');
  end if;
end $$;
