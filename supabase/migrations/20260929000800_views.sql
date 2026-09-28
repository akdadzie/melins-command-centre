-- =============================================================================
-- 0800 Read models for the Phase A home screens and lists (brief §6).
-- Views run with the owner's rights, so each one checks the role itself.
-- Admin-facing views never expose balances or totals (A-003).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Accounts and balances (finance)
-- -----------------------------------------------------------------------------
create view public.account_balances with (security_barrier) as
  select a.id, a.name, a.type, a.purpose, a.institution, a.last4, a.is_active,
         app.account_balance(a.id) as calculated_balance,
         r.month as last_reconciled_month,
         r.statement_balance as last_statement_balance,
         r.difference as last_difference
  from public.accounts a
  left join lateral (
    select * from public.reconciliations rc where rc.account_id = a.id and rc.status = 'closed'
    order by rc.month desc limit 1) r on true
  where app.is_finance();

create view public.director_balances with (security_barrier) as
  select d.id, d.full_name, app.director_balance(d.id) as balance,   -- + company owes director
         (select min(l.entry_date) from public.ledger_entries l
          where l.director_id = d.id and l.source_type = 'receipt'
            and app.director_balance(d.id) < 0) as oldest_client_money_held
  from public.directors d
  where app.is_finance() and (d.id = app.my_director_id() or app.area_visible('other_director_accounts'));

-- -----------------------------------------------------------------------------
-- Receivables
-- -----------------------------------------------------------------------------

-- Per-invoice ageing (finance; Admin chases from the invoices list itself).
create view public.receivables_ageing with (security_barrier) as
  select i.id, i.invoice_number, i.client_id, c.name as client_name, i.job_id, i.invoice_date, i.due_date,
         i.status, i.outstanding, app.today() - i.invoice_date as days_outstanding,
         case when app.today() - i.invoice_date <= 30 then '0-30'
              when app.today() - i.invoice_date <= 60 then '31-60'
              when app.today() - i.invoice_date <= 90 then '61-90' else '90+' end as bucket
  from public.invoices i join public.clients c on c.id = i.client_id
  where app.is_finance() and i.status in ('approved', 'sent', 'part_paid', 'disputed') and i.outstanding > 0;

-- Chase list for Admin: days relative to due, no totals (brief §9 chase dates).
create view public.invoices_to_chase with (security_barrier) as
  select i.id, i.invoice_number, c.name as client_name, c.phone, c.email, i.due_date, i.outstanding,
         app.today() - i.due_date as days_overdue,
         case app.today() - i.due_date when -7 then 'due_in_7' when 0 then 'due_today'
              when 14 then 'overdue_14' when 30 then 'overdue_30' when 60 then 'overdue_60' end as chase_step
  from public.invoices i join public.clients c on c.id = i.client_id
  where app.has_role('owner', 'director', 'accountant', 'admin')
    and i.status in ('sent', 'part_paid') and i.outstanding > 0;

-- Ready to invoice: milestones reached and rechargeable expenses not yet billed.
create view public.ready_to_invoice with (security_barrier) as
  select 'milestone'::text as item_type, m.id as item_id, j.id as job_id, j.job_number, j.title as job_title,
         m.name as description, m.amount, m.reached_on as ready_since
  from public.billing_milestones m join public.jobs j on j.id = m.job_id
  where app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead')
    and m.status = 'reached'
    and not exists (select 1 from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
                    where l.billing_milestone_id = m.id and i.status <> 'draft')
  union all
  select 'rechargeable_expense', e.id, j.id, j.job_number, j.title, e.description,
         round((case when e.input_vat_claimable > 0 then e.net_amount else e.amount end) * (1 + e.recharge_markup_pct / 100), 2),
         e.expense_date
  from public.expenses e join public.jobs j on j.id = e.job_id
  where app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead')
    and e.rechargeable and e.entry_status = 'confirmed'
    and not exists (select 1 from public.invoice_lines l where l.expense_id = e.id);

-- Retention held by clients, per job (brief §7.4; acceptance 9).
create view public.retention_by_job with (security_barrier) as
  select j.id as job_id, j.job_number, j.title, c.id as client_id, c.name as client_name,
         j.retention_pct, j.retention_release_terms, j.retention_release_date,
         app.job_retention_held(j.id) as retention_held
  from public.jobs j join public.clients c on c.id = j.client_id
  where app.has_role('owner', 'director', 'accountant', 'admin')
    and app.job_retention_held(j.id) > 0;

-- Money status is derived, never set by hand (brief §7.3).
create view public.job_money_status with (security_barrier) as
  select j.id as job_id, j.job_number, j.fee,
         coalesce(sum(i.net_total) filter (where i.status <> 'draft'), 0) as invoiced_net,
         coalesce(sum(i.gross_total - i.retention_amount - i.credited_total) filter (where i.status <> 'draft'), 0) as billed_due,
         coalesce(sum(i.settled_total) filter (where i.status <> 'draft'), 0) as settled,
         case
           when count(i.id) filter (where i.status <> 'draft') = 0 then 'not_invoiced'
           when coalesce(sum(i.outstanding) filter (where i.status <> 'draft'), 0) = 0
                and coalesce(sum(i.net_total) filter (where i.status <> 'draft'), 0) >= coalesce(j.fee, 0) then 'paid'
           when coalesce(sum(i.settled_total) filter (where i.status <> 'draft'), 0) > 0 then 'part_paid'
           when coalesce(sum(i.net_total) filter (where i.status <> 'draft'), 0) >= coalesce(j.fee, 0) then 'fully_invoiced'
           else 'part_invoiced' end as money_status
  from public.jobs j left join public.invoices i on i.job_id = j.id
  where app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead')
  group by j.id;

-- Milestones that don't add up to the fee (brief §7.3 warning).
create view public.job_milestone_check with (security_barrier) as
  select j.id as job_id, j.job_number, j.fee, coalesce(sum(m.amount), 0) as milestones_total,
         coalesce(j.fee, 0) - coalesce(sum(m.amount), 0) as difference
  from public.jobs j left join public.billing_milestones m on m.job_id = j.id
  where app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead') and j.contract_mode = 'consultancy'
  group by j.id
  having abs(coalesce(j.fee, 0) - coalesce(sum(m.amount), 0)) > 0.005;

-- -----------------------------------------------------------------------------
-- Delivery (brief §6 Panel 3, §12 Phase A)
-- -----------------------------------------------------------------------------
create view public.job_hours_vs_budget with (security_barrier) as
  select j.id as job_id, j.job_number, j.title, br.id as budget_role_id, br.name as budget_role,
         coalesce(b.hours, 0) as budget_hours,
         coalesce(t.hours, 0) as logged_hours,
         coalesce(t.approved_hours, 0) as approved_hours,
         b.hours is not null and coalesce(t.hours, 0) > b.hours as over_budget
  from public.jobs j
  cross join public.budget_roles br
  left join public.job_hour_budgets b on b.job_id = j.id and b.budget_role_id = br.id
  left join lateral (
    select sum(te.hours) as hours, sum(te.hours) filter (where te.status = 'approved') as approved_hours
    from public.timesheet_entries te where te.job_id = j.id and te.budget_role_id = br.id) t on true
  where app.has_role('owner', 'director', 'accountant', 'project_lead')
    and (b.hours is not null or t.hours is not null);

create view public.jobs_flagged with (security_barrier) as
  select j.id as job_id, j.job_number, j.title, j.due_date, j.delivery_status,
         j.due_date < app.today() as past_due,
         exists (select 1 from public.job_hours_vs_budget h where h.job_id = j.id and h.over_budget) as over_hours_budget
  from public.jobs j
  where app.has_role('owner', 'director', 'accountant', 'project_lead')
    and j.delivery_status not in ('completed', 'closed')
    and (j.due_date < app.today()
         or exists (select 1 from public.job_hours_vs_budget h where h.job_id = j.id and h.over_budget));

-- Utilisation: billable hours as a % of the monthly target, reduced pro-rata
-- for approved leave and public holidays (brief §6). Includes the Owner.
create or replace function public.utilisation(p_from date, p_to date)
returns table (staff_id uuid, full_name text, month date, billable_hours numeric, target_hours numeric, utilisation_pct numeric)
language sql stable security definer set search_path = '' as $$
  with months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as m),
  base as (
    select st.id, st.full_name, mo.m, st.monthly_billable_target,
           (select count(*) from generate_series(mo.m, (mo.m + interval '1 month' - interval '1 day')::date, interval '1 day') g(d)
            where extract(isodow from g.d) < 6) as weekdays,
           app.working_days_in(greatest(mo.m, st.start_date),
                               least((mo.m + interval '1 month' - interval '1 day')::date, coalesce(st.end_date, '9999-12-31'))) as working_days,
           (select count(*) from public.timesheet_entries te
            where te.staff_id = st.id and te.category = 'leave'
              and te.work_date >= mo.m and te.work_date < mo.m + interval '1 month') as leave_days,
           (select coalesce(sum(te.hours), 0) from public.timesheet_entries te
            where te.staff_id = st.id and te.billable
              and te.work_date >= mo.m and te.work_date < mo.m + interval '1 month') as billable
    from public.staff st cross join months mo
    where st.start_date < mo.m + interval '1 month' and (st.end_date is null or st.end_date >= mo.m))
  select id, full_name, m, billable,
         round(monthly_billable_target * greatest(working_days - leave_days, 0) / nullif(weekdays, 0), 1),
         round(100 * billable / nullif(monthly_billable_target * greatest(working_days - leave_days, 0) / nullif(weekdays, 0), 0), 1)
  from base
  where app.has_role('owner', 'director', 'accountant', 'project_lead')
     or id = app.my_staff_id()
  order by full_name, m
$$;

-- Days a person should have logged but didn't (for reminders and the
-- Delivery panel). Approved leave and public holidays are exempt.
create or replace function public.missing_timesheet_days(p_from date, p_to date default null)
returns table (staff_id uuid, full_name text, work_date date, working_days_elapsed int)
language sql stable security definer set search_path = '' as $$
  select st.id, st.full_name, g.d::date, app.timesheet_days_elapsed(g.d::date)
  from public.staff st
  cross join generate_series(p_from, coalesce(p_to, app.today()), interval '1 day') g(d)
  where st.is_active and g.d::date >= st.start_date and (st.end_date is null or g.d::date <= st.end_date)
    and app.is_working_day(g.d::date)
    and not exists (select 1 from public.timesheet_entries te where te.staff_id = st.id and te.work_date = g.d::date)
    and (app.has_role('owner', 'director', 'accountant')
         or st.id = app.my_staff_id()
         or (app.has_role('project_lead') and app.can_approve_for(st.id)))
$$;

-- Timesheet compliance: % of working days logged on time (brief §4).
create or replace function public.timesheet_compliance(p_from date, p_to date default null)
returns table (staff_id uuid, full_name text, working_days int, on_time_days int, late_days int, missing_days int, on_time_pct numeric)
language sql stable security definer set search_path = '' as $$
  with days as (
    select st.id, st.full_name, g.d::date as d,
           exists (select 1 from public.timesheet_entries te where te.staff_id = st.id and te.work_date = g.d::date and te.category = 'leave') as on_leave,
           exists (select 1 from public.timesheet_entries te where te.staff_id = st.id and te.work_date = g.d::date and te.category <> 'leave' and not te.is_late_entry) as on_time,
           exists (select 1 from public.timesheet_entries te where te.staff_id = st.id and te.work_date = g.d::date and te.is_late_entry) as late
    from public.staff st
    cross join generate_series(p_from, coalesce(p_to, app.today()), interval '1 day') g(d)
    where st.is_active and g.d::date >= st.start_date and (st.end_date is null or g.d::date <= st.end_date)
      and app.is_working_day(g.d::date)
      and not app.staff_is_owner(st.id))
  select id, full_name,
         count(*) filter (where not on_leave)::int,
         count(*) filter (where not on_leave and on_time)::int,
         count(*) filter (where not on_leave and late and not on_time)::int,
         count(*) filter (where not on_leave and not on_time and not late)::int,
         round(100.0 * count(*) filter (where not on_leave and on_time) / nullif(count(*) filter (where not on_leave), 0), 1)
  from days
  where app.has_role('owner', 'director', 'accountant', 'project_lead') or id = app.my_staff_id()
  group by id, full_name
  order by full_name
$$;

-- Leave balances (brief §7.3): the person, their approver, Owner, Directors, Accountant.
create view public.leave_balances with (security_barrier) as
  select e.staff_id, st.full_name, e.leave_type_id, lt.name as leave_type, e.leave_year,
         b.entitled, b.carried_over, b.taken, b.booked, b.available
  from public.leave_entitlements e
  join public.staff st on st.id = e.staff_id
  join public.leave_types lt on lt.id = e.leave_type_id
  cross join lateral app.leave_balance(e.staff_id, e.leave_type_id, e.leave_year) b
  where app.has_role('owner', 'director', 'accountant')
     or e.staff_id = app.my_staff_id()
     or (app.has_role('project_lead') and app.can_approve_for(e.staff_id));

-- Staff loans ending after the person leaves (brief §7.5 warning).
create view public.staff_loan_warnings with (security_barrier) as
  select l.id as loan_id, st.full_name, st.end_date, app.loan_balance(l.id) as balance,
         ceil(app.loan_balance(l.id) / l.monthly_instalment)::int as months_to_clear
  from public.staff_loans l join public.staff st on st.id = l.staff_id
  where app.is_finance() and l.status = 'paid' and l.cleared_at is null and st.end_date is not null
    and (date_trunc('month', app.today()) + (ceil(app.loan_balance(l.id) / l.monthly_instalment) || ' months')::interval)::date > st.end_date;

-- -----------------------------------------------------------------------------
-- Money panel (brief §6 Panel 1). Finance roles only.
-- -----------------------------------------------------------------------------

-- Monthly running cost = latest payroll total + monthly equivalent of recurring
-- expenses + monthly share of prepayments (0 until Phase C, A-010).
create or replace function public.running_cost(p_as_of date default null,
  out payroll numeric, out recurring numeric, out prepayments numeric, out calculated numeric, out override numeric)
language plpgsql stable security definer set search_path = '' as $$
declare d date := coalesce(p_as_of, app.today());
begin
  if not app.is_finance() then return; end if;
  select coalesce(sum(l.full_cost_to_company), 0) into payroll
    from public.payroll_lines l
   where l.run_id = (select r.id from public.payroll_runs r
                     where r.run_kind = 'regular' and r.status in ('approved', 'issued') and r.period_month <= d
                     order by r.period_month desc limit 1);
  select coalesce(sum(app.monthly_equivalent(expected_amount, frequency)), 0) into recurring
    from public.recurring_expenses where is_active;
  prepayments := 0;
  calculated := payroll + recurring + prepayments;
  override := (app.settings_at(d)).running_cost_override;
end $$;

create or replace function public.money_panel(p_as_of date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d date := coalesce(p_as_of, app.today());
  m date := date_trunc('month', coalesce(p_as_of, app.today()))::date;
  s public.settings_versions := app.settings_at(coalesce(p_as_of, app.today()));
  rc record;
  operating_cash numeric; reserved numeric := 0; committed numeric; available numeric; monthly numeric;
  result jsonb;
begin
  if not app.is_finance() then return null; end if;
  rc := public.running_cost(d);
  monthly := coalesce(rc.override, rc.calculated);

  select coalesce(sum(app.account_balance(id, d)), 0) into operating_cash
    from public.accounts where is_active and purpose <> 'reserve';

  committed :=
      coalesce((select sum(amount) from public.expenses
                where payment_source = 'staff_out_of_pocket' and reimbursement_status in ('owed', 'approved')), 0)
    + coalesce((select sum(app.bill_outstanding(id)) from public.expenses
                where payment_source = 'supplier_payable' and entry_status = 'confirmed'), 0)
    + coalesce((select sum(amount) from public.staff_payments where status = 'approved'), 0)
    + coalesce((select sum(net_amount) from public.director_payments where status = 'approved'), 0)
    + coalesce((select sum(amount) from public.statutory_payments where status = 'approved'), 0);
  available := operating_cash - reserved - committed;

  result := jsonb_build_object(
    'as_of', d,
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'purpose', purpose,
                   'balance', calculated_balance, 'last_reconciled_month', last_reconciled_month,
                   'difference', last_difference) order by purpose = 'reserve', name), '[]')
                 from public.account_balances where is_active),
    'reserved_for_commitments', reserved,
    'committed_cash', committed,
    'available_cash', available,
    'monthly_running_cost', jsonb_build_object('calculated', rc.calculated, 'override', rc.override,
                              'payroll', rc.payroll, 'recurring', rc.recurring, 'prepayments', rc.prepayments),
    'weeks_of_cover', case when monthly > 0 then round(available / (monthly / 4.33), 1) end,
    'receivables', jsonb_build_object(
      'total', (select coalesce(sum(outstanding), 0) from public.receivables_ageing),
      'ageing', (select coalesce(jsonb_object_agg(bucket, amt), '{}') from
                  (select bucket, sum(outstanding) amt from public.receivables_ageing group by bucket) b),
      'top_debtors', (select coalesce(jsonb_agg(x order by x.amt desc), '[]') from
                  (select client_name as name, sum(outstanding) amt from public.receivables_ageing
                   group by client_name order by sum(outstanding) desc limit 5) x),
      'reported_unconfirmed', (select coalesce(sum(cash_amount), 0) from public.receipts where status = 'reported'),
      'retention_held', (select coalesce(sum(app.job_retention_held(id)), 0) from public.jobs)),
    'statutory', jsonb_build_object(
      'due_next_30_days', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'due_date', due_date,
                             'outstanding', outstanding) order by due_date), '[]')
                           from public.statutory_ledger where status <> 'paid' and not is_opening_arrears
                             and due_date between d and d + 30),
      'arrears_by_type', (select coalesce(jsonb_object_agg(label, amt), '{}') from
                           (select label, sum(outstanding) amt from public.statutory_ledger
                            where status = 'overdue' group by label) a)),
    'vat_this_month', (select coalesce(sum(net_payable), 0) from public.vat_workings(m)),
    'wht_credits_this_year', jsonb_build_object(
      'total', (select coalesce(sum(wht_amount), 0) from public.receipts
                where status = 'confirmed' and extract(year from receipt_date) = extract(year from d)),
      'certificates_to_collect', (select count(*) from public.wht_certificates where status = 'expected')),
    'ready_to_invoice_count', (select count(*) from public.ready_to_invoice),
    'awaiting_owner_approval', jsonb_build_object(
      'invoices', (select count(*) from public.invoices where status = 'draft' and ready_for_approval),
      'payments_out', (select count(*) from public.payments_out where status = 'prepared')
                    + (select count(*) from public.staff_payments where status = 'prepared')
                    + (select count(*) from public.director_payments where status = 'prepared')
                    + (select count(*) from public.statutory_payments where status = 'prepared')),
    'fees_this_month', jsonb_build_object(
      'invoiced', (select coalesce(sum(net_total), 0) from public.invoices
                   where status <> 'draft' and not is_imported and invoice_date >= m and invoice_date < m + interval '1 month'),
      'received', (select coalesce(sum(cash_amount + wht_amount + vat_withheld_amount), 0) from public.receipts
                   where status = 'confirmed' and receipt_date >= m and receipt_date < m + interval '1 month'),
      'target', s.monthly_fee_target)
  );
  return result;
end $$;

-- Directors' monthly summary (/reports/monthly, A-014).
create or replace function public.monthly_summary(p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  m date := date_trunc('month', p_month)::date;
  e date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not app.is_finance() then return null; end if;
  return jsonb_build_object(
    'month', m,
    'fees_invoiced', (select coalesce(sum(net_total), 0) from public.invoices
                      where status <> 'draft' and not is_imported and invoice_date >= m and invoice_date < e),
    'fees_received', (select coalesce(sum(cash_amount), 0) from public.receipts
                      where status = 'confirmed' and receipt_date >= m and receipt_date < e),
    'costs', jsonb_build_object(
      'expenses', (select coalesce(sum(net_amount), 0) from public.expenses
                   where entry_status = 'confirmed' and expense_date >= m and expense_date < e),
      'payroll', (select coalesce(sum(l.full_cost_to_company), 0) from public.payroll_lines l
                  join public.payroll_runs r on r.id = l.run_id
                  where r.period_month = m and r.status in ('approved', 'issued')),
      'directors_fees', (select coalesce(sum(gross_amount), 0) from public.director_payments
                         where status = 'paid' and payment_type in ('fee_or_allowance', 'sitting_allowance')
                           and payment_date >= m and payment_date < e)),
    'cash_at_month_end', (select coalesce(sum(app.account_balance(id, (e - 1))), 0) from public.accounts where is_active),
    'vat_payable', (select coalesce(sum(net_payable), 0) from public.vat_workings(m)),
    'statutory_outstanding', (select coalesce(sum(outstanding), 0) from public.statutory_ledger where status <> 'paid'),
    'month_status', coalesce((select status from public.month_closes where month = m), 'open'),
    'closed_at', (select closed_at from public.month_closes where month = m));
end $$;

-- Accountant home: counts to work through (brief §6).
create or replace function public.accountant_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  n int := 0; oldest date; c int; o date;
  t text; col text;
begin
  if not app.has_role('owner', 'director', 'accountant') then return null; end if;
  for t, col in values ('expenses', 'expense_date'), ('payments_out', 'payment_date'),
      ('staff_payments', 'payment_date'), ('transfers', 'transfer_date'), ('staff_loans', 'payment_date'),
      ('staff_loan_repayments', 'repayment_date'), ('director_transactions', 'txn_date'),
      ('director_payments', 'payment_date'), ('statutory_payments', 'payment_date') loop
    execute format('select count(*), min(%I) from public.%I where review_status = ''recorded''', col, t) into c, o;
    n := n + c;
    oldest := least(oldest, o);
  end loop;
  return jsonb_build_object(
    'entries_to_review', n,
    'oldest_entry', oldest,
    'payments_to_confirm', (select count(*) from public.receipts where status = 'reported'),
    'unreconciled_accounts', (select count(*) from public.accounts a where a.is_active and not exists (
        select 1 from public.reconciliations r where r.account_id = a.id and r.status = 'closed'
          and r.month = (date_trunc('month', app.today()) - interval '1 month')::date)),
    'last_closed_month', (select max(month) from public.month_closes where status = 'closed'));
end $$;
