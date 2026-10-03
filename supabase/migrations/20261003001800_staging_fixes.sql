-- =============================================================================
-- 1800 Fixes from the Owner's staging test, 3 Oct 2026 (DECISIONS D-032..D-036)
--  * Tax credits: GRA owes MeLiNS GHS 9,482.80 of VAT overpaid at 30 Sep 2026.
--    A credit offsets later VAT lines automatically, and can be applied to
--    another GRA liability when GRA approves an offset (D-032).
--  * Go-live is a setting: timesheet compliance, missing days and utilisation
--    start from it (D-034).
--  * Reconciliation is only asked for from each account's opening month (D-033).
--  * The Money panel shows each arrears line with its note (D-036) and the
--    credits held by GRA.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Go-live date (D-029, D-034). A table rather than a constant, so the date is
-- recorded in one place and can be checked or corrected.
-- -----------------------------------------------------------------------------
create table app.system_config (
  id boolean primary key default true check (id),
  go_live_date date not null
);
insert into app.system_config (go_live_date) values ('2026-10-01');

create or replace function app.go_live_date() returns date
language sql stable security definer set search_path = '' as $$
  select go_live_date from app.system_config
$$;

-- -----------------------------------------------------------------------------
-- Tax credits (D-032)
-- -----------------------------------------------------------------------------
create table public.tax_credits (
  id uuid primary key default gen_random_uuid(),
  authority text not null default 'GRA',
  tax_type text not null default 'vat' check (tax_type in ('vat', 'paye', 'wht', 'corporate_tax', 'other')),
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  as_at date not null,
  -- Offset automatically against later statutory lines of this type (VAT
  -- returns for a VAT credit). Null = only applied by hand, with GRA's approval.
  auto_offset_type text references public.statutory_due_rules (type),
  reference text,
  notes text,
  attachment_path text,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.tax_credit_applications (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references public.tax_credits (id),
  statutory_line_id uuid not null references public.statutory_lines (id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  applied_on date not null default app.today(),
  kind text not null check (kind in ('auto', 'gra_offset')),
  gra_reference text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (kind = 'auto' or length(trim(coalesce(gra_reference, ''))) > 0)
);
create index tax_credit_applications_line on public.tax_credit_applications (statutory_line_id);
create index tax_credit_applications_credit on public.tax_credit_applications (credit_id);

create or replace function app.tax_credit_remaining(p_credit uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select c.amount - coalesce((select sum(a.amount) from public.tax_credit_applications a where a.credit_id = c.id), 0)
  from public.tax_credits c where c.id = p_credit
$$;

create or replace function app.statutory_credit_applied(p_line uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.tax_credit_applications where statutory_line_id = p_line
$$;

create or replace function app.statutory_cash_paid(p_line uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.statutory_payments where statutory_line_id = p_line and status = 'paid'
$$;

-- Re-works the automatic offsets on one line: oldest credit first, never more
-- than the line still owes after cash and GRA-approved offsets.
create or replace function app.apply_auto_credits(p_line uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.statutory_lines;
  need numeric;
  c record;
  take numeric;
begin
  select * into l from public.statutory_lines where id = p_line;
  if not found or l.is_opening_arrears then return; end if;
  delete from public.tax_credit_applications where statutory_line_id = p_line and kind = 'auto';
  need := l.amount_due - app.statutory_cash_paid(p_line)
          - coalesce((select sum(amount) from public.tax_credit_applications where statutory_line_id = p_line), 0);
  for c in select tc.id from public.tax_credits tc
           where tc.auto_offset_type = l.type
             and coalesce(l.period_start, l.due_date) > tc.as_at
             and coalesce(l.payee, '') ilike tc.authority
           order by tc.as_at, tc.created_at loop
    exit when need <= 0.005;
    take := least(need, app.tax_credit_remaining(c.id));
    if take > 0.005 then
      insert into public.tax_credit_applications (credit_id, statutory_line_id, amount, kind, notes, created_by)
      values (c.id, p_line, take, 'auto', 'Offset automatically', null);
      need := need - take;
    end if;
  end loop;
end $$;

-- Re-works the automatic offsets on every line of a type from a date, in date
-- order, so credit freed by a lower return flows on to the next one.
create or replace function app.rebalance_auto_credits(p_type text, p_from date) returns void
language plpgsql security definer set search_path = '' as $$
declare lid uuid;
begin
  delete from public.tax_credit_applications a using public.statutory_lines l
   where a.statutory_line_id = l.id and a.kind = 'auto' and l.type = p_type
     and coalesce(l.period_start, l.due_date) >= p_from;
  for lid in select l.id from public.statutory_lines l
             where l.type = p_type and not l.is_opening_arrears and coalesce(l.period_start, l.due_date) >= p_from
             order by coalesce(l.period_start, l.due_date), l.created_at loop
    perform app.apply_auto_credits(lid);
  end loop;
end $$;

create or replace function app.statutory_lines_auto_credit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.tax_credits where auto_offset_type = new.type) then
    perform app.rebalance_auto_credits(new.type, least(coalesce(new.period_start, new.due_date),
      case when tg_op = 'UPDATE' then coalesce(old.period_start, old.due_date) end));
  end if;
  return null;
end $$;
create trigger auto_credit after insert or update of amount_due, period_start, payee on public.statutory_lines
  for each row execute function app.statutory_lines_auto_credit();

-- A new credit is applied straight away to lines already waiting for it.
create or replace function app.tax_credits_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.auto_offset_type is not null then
    perform app.rebalance_auto_credits(new.auto_offset_type, new.as_at);
  end if;
  if tg_op = 'UPDATE' and old.auto_offset_type is not null and old.auto_offset_type is distinct from new.auto_offset_type then
    perform app.rebalance_auto_credits(old.auto_offset_type, old.as_at);
  end if;
  return null;
end $$;
create trigger after_write after insert or update on public.tax_credits
  for each row execute function app.tax_credits_after();

create or replace function app.tax_credits_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare applied numeric;
begin
  applied := coalesce((select sum(amount) from public.tax_credit_applications where credit_id = coalesce(new.id, old.id)), 0);
  if tg_op = 'DELETE' then
    if applied > 0 then raise exception 'This credit has been applied; remove its offsets first' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.amount < applied then
    raise exception 'GHS % of this credit is already applied', to_char(applied, 'FM999,999,990.00');
  end if;
  return new;
end $$;
create trigger before_write before update or delete on public.tax_credits
  for each row execute function app.tax_credits_before();

-- A GRA-approved offset against another liability, e.g. PAYE arrears (D-032).
create or replace function public.apply_tax_credit(p_credit uuid, p_line uuid, p_amount numeric,
  p_gra_reference text, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.tax_credits;
  l public.statutory_lines;
  outstanding numeric;
  v_id uuid;
begin
  if not app.has_role('owner', 'accountant') then
    raise exception 'Only the Owner or the Accountant applies a tax credit' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_gra_reference, ''))) = 0 then
    raise exception 'Give GRA''s reference for approving the offset';
  end if;
  select * into c from public.tax_credits where id = p_credit;
  select * into l from public.statutory_lines where id = p_line;
  if c.id is null or l.id is null then raise exception 'Choose the credit and the obligation'; end if;
  if coalesce(l.payee, '') not ilike c.authority then
    raise exception 'A % credit can only be set against an obligation payable to %', c.authority, c.authority;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount'; end if;
  if p_amount > app.tax_credit_remaining(c.id) + 0.005 then
    raise exception 'Only GHS % of the credit is left', to_char(app.tax_credit_remaining(c.id), 'FM999,999,990.00');
  end if;
  outstanding := l.amount_due - app.statutory_cash_paid(l.id) - app.statutory_credit_applied(l.id);
  if p_amount > outstanding + 0.005 then
    raise exception 'That is more than the obligation still owes (GHS %)', to_char(outstanding, 'FM999,999,990.00');
  end if;
  insert into public.tax_credit_applications (credit_id, statutory_line_id, amount, kind, gra_reference, notes)
  values (c.id, l.id, round(p_amount, 2), 'gra_offset', trim(p_gra_reference), p_notes)
  returning id into v_id;
  if app.has_role('accountant') then
    perform app.notify_role('owner', 'tax_credit_applied',
      format('The Accountant set GHS %s of the %s credit against %s (GRA ref %s)', to_char(p_amount, 'FM999,999,990.00'),
             c.authority, (select label from public.statutory_due_rules where type = l.type), trim(p_gra_reference)),
      '/tax/statutory', 'tax_credit', c.id);
  end if;
  return v_id;
end $$;
revoke execute on function public.apply_tax_credit(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.apply_tax_credit(uuid, uuid, numeric, text, text) to authenticated;

alter table public.tax_credits enable row level security;
alter table public.tax_credit_applications enable row level security;
create policy tax_credits_read on public.tax_credits for select to authenticated using (app.is_finance());
create policy tax_credits_write on public.tax_credits for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));
create policy tax_credit_apps_read on public.tax_credit_applications for select to authenticated using (app.is_finance());
-- Applications are made by the functions above; the Owner may undo a manual offset.
create policy tax_credit_apps_undo on public.tax_credit_applications for delete to authenticated
  using (app.has_role('owner') and kind = 'gra_offset');

select app.enable_director_block('public.tax_credits');
select app.enable_director_block('public.tax_credit_applications');
select app.enable_audit(t) from unnest(array['public.tax_credits', 'public.tax_credit_applications']::regclass[]) t;
select app.enable_month_lock('public.tax_credit_applications', 'applied_on');
create trigger touch before update on public.tax_credits for each row execute function app.touch();

-- The statutory ledger counts credit applied as well as cash paid.
create or replace view public.statutory_ledger with (security_barrier) as
  select l.id, l.type, r.label, l.period_start, l.period_end, l.payee, l.amount_due, l.due_date,
         l.is_opening_arrears, l.notes,
         coalesce(p.paid, 0) as amount_paid,
         l.amount_due - coalesce(p.paid, 0) - coalesce(c.applied, 0) as outstanding,
         p.last_paid_on,
         case when l.amount_due - coalesce(p.paid, 0) - coalesce(c.applied, 0) <= 0.005 then 'paid'
              when l.is_opening_arrears or l.due_date < app.today() then 'overdue'
              when coalesce(p.paid, 0) + coalesce(c.applied, 0) > 0 then 'part_paid'
              else 'due' end as status,
         coalesce(c.applied, 0) as credit_applied
  from public.statutory_lines l
  join public.statutory_due_rules r on r.type = l.type
  left join lateral (
    select sum(amount) as paid, max(payment_date) as last_paid_on
    from public.statutory_payments sp where sp.statutory_line_id = l.id and sp.status = 'paid') p on true
  left join lateral (
    select sum(amount) as applied from public.tax_credit_applications a where a.statutory_line_id = l.id) c on true
  where app.is_finance();

-- Credits held by the tax authorities, with what's left.
create view public.tax_credit_balances with (security_barrier) as
  select c.id, c.authority, c.tax_type, c.description, c.amount, c.as_at, c.auto_offset_type, c.reference, c.notes,
         c.amount - app.tax_credit_remaining(c.id) as applied,
         app.tax_credit_remaining(c.id) as remaining
  from public.tax_credits c
  where app.is_finance();

-- -----------------------------------------------------------------------------
-- Timesheets and utilisation from go-live (D-034). As 0800, with the floor.
-- -----------------------------------------------------------------------------
create or replace function public.utilisation(p_from date, p_to date)
returns table (staff_id uuid, full_name text, month date, billable_hours numeric, target_hours numeric, utilisation_pct numeric)
language sql stable security definer set search_path = '' as $$
  with months as (
    select generate_series(greatest(date_trunc('month', p_from), date_trunc('month', app.go_live_date())),
                           date_trunc('month', p_to), interval '1 month')::date as m),
  base as (
    select st.id, st.full_name, mo.m, st.monthly_billable_target,
           (select count(*) from generate_series(mo.m, (mo.m + interval '1 month' - interval '1 day')::date, interval '1 day') g(d)
            where extract(isodow from g.d) < 6) as weekdays,
           app.working_days_in(greatest(mo.m, st.start_date, app.go_live_date()),
                               least((mo.m + interval '1 month' - interval '1 day')::date, coalesce(st.end_date, '9999-12-31'))) as working_days,
           (select count(*) from public.timesheet_entries te
            where te.staff_id = st.id and te.category = 'leave'
              and te.work_date >= greatest(mo.m, app.go_live_date()) and te.work_date < mo.m + interval '1 month') as leave_days,
           (select coalesce(sum(te.hours), 0) from public.timesheet_entries te
            where te.staff_id = st.id and te.billable
              and te.work_date >= greatest(mo.m, app.go_live_date()) and te.work_date < mo.m + interval '1 month') as billable
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

create or replace function public.missing_timesheet_days(p_from date, p_to date default null)
returns table (staff_id uuid, full_name text, work_date date, working_days_elapsed int)
language sql stable security definer set search_path = '' as $$
  select st.id, st.full_name, g.d::date, app.timesheet_days_elapsed(g.d::date)
  from public.staff st
  cross join generate_series(greatest(p_from, app.go_live_date()), coalesce(p_to, app.today()), interval '1 day') g(d)
  where st.is_active and g.d::date >= st.start_date and (st.end_date is null or g.d::date <= st.end_date)
    and app.is_working_day(g.d::date)
    and not exists (select 1 from public.timesheet_entries te where te.staff_id = st.id and te.work_date = g.d::date)
    and (app.has_role('owner', 'director', 'accountant')
         or st.id = app.my_staff_id()
         or (app.has_role('project_lead') and app.can_approve_for(st.id)))
$$;

create or replace function public.timesheet_compliance(p_from date, p_to date default null)
returns table (staff_id uuid, full_name text, working_days int, on_time_days int, late_days int, missing_days int, on_time_pct numeric)
language sql stable security definer set search_path = '' as $$
  with days as (
    select st.id, st.full_name, g.d::date as d,
           exists (select 1 from public.timesheet_entries te where te.staff_id = st.id and te.work_date = g.d::date and te.category = 'leave') as on_leave,
           exists (select 1 from public.timesheet_entries te where te.staff_id = st.id and te.work_date = g.d::date and te.category <> 'leave' and not te.is_late_entry) as on_time,
           exists (select 1 from public.timesheet_entries te where te.staff_id = st.id and te.work_date = g.d::date and te.is_late_entry) as late
    from public.staff st
    cross join generate_series(greatest(p_from, app.go_live_date()), coalesce(p_to, app.today()), interval '1 day') g(d)
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

-- -----------------------------------------------------------------------------
-- Accountant home: as 1300, but an account is only due for last month's
-- reconciliation if it was open by the end of last month (D-033).
-- -----------------------------------------------------------------------------
create or replace function public.accountant_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  n int := 0; oldest date; c int; o date;
  t text; col text;
  last_month date := (date_trunc('month', app.today()) - interval '1 month')::date;
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
    'owner_confirmed_payments', (select count(*) from public.receipts where status = 'confirmed' and review_status = 'recorded'),
    'payments_to_confirm', (select count(*) from public.receipts where status = 'reported'),
    'unreconciled_accounts', (select count(*) from public.accounts a
        where a.is_active and a.opening_date < date_trunc('month', app.today())::date
          and not exists (select 1 from public.reconciliations r where r.account_id = a.id and r.status = 'closed'
                          and r.month = last_month)),
    'last_closed_month', (select max(month) from public.month_closes where status = 'closed'));
end $$;

-- -----------------------------------------------------------------------------
-- Money panel: as 0800, plus each account's opening date (so last month's
-- reconciliation is only flagged for accounts open then, D-033), overdue lines
-- with their notes (D-036) and credits held by GRA (D-032).
-- -----------------------------------------------------------------------------
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
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'purpose', b.purpose,
                   'balance', b.calculated_balance, 'last_reconciled_month', b.last_reconciled_month,
                   'difference', b.last_difference, 'opening_date', a.opening_date) order by b.purpose = 'reserve', b.name), '[]')
                 from public.account_balances b join public.accounts a on a.id = b.id where b.is_active),
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
                            where status = 'overdue' group by label) a),
      -- each overdue line with its note, e.g. "estimate, awaiting trustee statement" (D-036)
      'arrears', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'outstanding', outstanding,
                    'notes', notes, 'is_opening_arrears', is_opening_arrears, 'credit_applied', credit_applied)
                    order by label, due_date), '[]')
                  from public.statutory_ledger where status = 'overdue'),
      -- credits the tax authorities owe MeLiNS, not yet used (D-032)
      'credits', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'authority', authority, 'description', description,
                    'amount', amount, 'applied', applied, 'remaining', remaining, 'auto_offset_type', auto_offset_type)
                    order by as_at), '[]')
                  from public.tax_credit_balances where remaining > 0.005)),
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

-- -----------------------------------------------------------------------------
-- Daily reminders: as 1600, with credit applied counting towards a statutory
-- line (a VAT return fully covered by the credit isn't chased).
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
  for r in select l.id, l.due_date, ru.label, l.amount_due - coalesce(p.paid, 0) - app.statutory_credit_applied(l.id) as outstanding, l.period_start
           from public.statutory_lines l
           join public.statutory_due_rules ru on ru.type = l.type
           left join lateral (select sum(sp.amount) as paid from public.statutory_payments sp
                              where sp.statutory_line_id = l.id and sp.status = 'paid') p on true
           where not l.is_opening_arrears and l.due_date in (d + 7, d, d - 1)
             and l.amount_due - coalesce(p.paid, 0) - app.statutory_credit_applied(l.id) > 0.005 loop
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
revoke execute on function app.run_daily_reminders(date) from public, anon, authenticated;
