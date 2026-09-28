-- =============================================================================
-- 0600 Tax, statutory ledger and payroll (brief §7.5 payroll, §7.6; D-016,
-- D-022..D-024, A-012)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Statutory calendar (brief §9; defaults to be confirmed by the Accountant)
-- -----------------------------------------------------------------------------
create table public.statutory_due_rules (
  type text primary key check (type in ('paye', 'bonus_paye', 'wht_directors_dividends', 'ssnit_tier1',
    'ssnit_tier2', 'vat', 'wht_remittance', 'provisional_corporate_tax', 'corporate_tax_return', 'other')),
  label text not null,
  payee text,
  rule_kind text not null check (rule_kind in
    ('day_of_next_month', 'last_working_day_next_month', 'quarter_end', 'months_after_year_end', 'manual')),
  day_of_month int check (day_of_month between 1 and 31),
  months_after int,
  notes text,
  updated_at timestamptz not null default now()
);

insert into public.statutory_due_rules (type, label, payee, rule_kind, day_of_month, months_after, notes) values
  ('paye', 'PAYE', 'GRA', 'day_of_next_month', 15, null, null),
  ('bonus_paye', 'Bonus PAYE', 'GRA', 'day_of_next_month', 15, null, null),
  ('wht_directors_dividends', 'WHT on directors'' fees and dividends', 'GRA', 'day_of_next_month', 15, null, null),
  ('wht_remittance', 'WHT remittance (suppliers)', 'GRA', 'day_of_next_month', 15, null, null),
  ('ssnit_tier1', 'SSNIT Tier 1', 'SSNIT', 'day_of_next_month', 14, null, null),
  ('ssnit_tier2', 'SSNIT Tier 2', null, 'day_of_next_month', 14, null, 'Payee = the Tier 2 trustee; set the trustee''s deadline in the setup wizard'),
  ('vat', 'VAT return', 'GRA', 'last_working_day_next_month', null, null, null),
  ('provisional_corporate_tax', 'Provisional corporate tax', 'GRA', 'quarter_end', null, null, null),
  ('corporate_tax_return', 'Annual corporate tax return', 'GRA', 'months_after_year_end', null, 4, null),
  ('other', 'Other', null, 'manual', null, null, null);

-- Due date for an obligation whose period starts on p_period.
create or replace function app.statutory_due_date(p_type text, p_period date) returns date
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.statutory_due_rules;
  nxt date := (date_trunc('month', p_period) + interval '1 month')::date;
  last_day date;
  fye int := (app.settings_at(p_period)).financial_year_end_month;
begin
  select * into r from public.statutory_due_rules where type = p_type;
  if r.rule_kind = 'day_of_next_month' then
    return least(nxt + (r.day_of_month - 1), (nxt + interval '1 month' - interval '1 day')::date);
  elsif r.rule_kind = 'last_working_day_next_month' then
    last_day := (nxt + interval '1 month' - interval '1 day')::date;
    while not app.is_working_day(last_day) loop last_day := last_day - 1; end loop;
    return last_day;
  elsif r.rule_kind = 'quarter_end' then
    return (date_trunc('quarter', p_period) + interval '3 months' - interval '1 day')::date;
  elsif r.rule_kind = 'months_after_year_end' then
    -- period = any date in the financial year; due N months after that year's end.
    last_day := make_date(extract(year from p_period)::int + case when extract(month from p_period) > fye then 1 else 0 end, fye, 1);
    return (last_day + interval '1 month' * (1 + r.months_after) - interval '1 day')::date;
  end if;
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- Statutory ledger (brief §7.6): one line per obligation per period.
-- -----------------------------------------------------------------------------
create table public.statutory_lines (
  id uuid primary key default gen_random_uuid(),
  type text not null references public.statutory_due_rules (type),
  period_start date,
  period_end date,
  payee text,
  amount_due numeric(14,2) not null check (amount_due >= 0),
  due_date date,
  is_opening_arrears boolean not null default false,
  auto_key text unique,                   -- set when the system maintains the line
  source_type text,
  source_id uuid,
  notes text,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (is_opening_arrears or period_start is not null)
);
create index statutory_lines_type on public.statutory_lines (type, period_start);

-- Paying a statutory line is money out (D-016): Accountant prepares, Owner
-- approves, then it's marked paid.
create table public.statutory_payments (
  id uuid primary key default gen_random_uuid(),
  statutory_line_id uuid not null references public.statutory_lines (id),
  amount numeric(14,2) not null check (amount > 0),
  receipt_path text,
  status public.payout_status not null default 'prepared',
  prepared_by uuid references public.profiles (user_id),
  approved_by uuid references public.profiles (user_id),
  approved_at timestamptz,
  paid_by uuid references public.profiles (user_id),
  paid_at timestamptz,
  payment_date date,
  account_id uuid references public.accounts (id),
  method text check (method in ('bank_transfer', 'cheque', 'cash', 'mobile_money', 'other')),
  reference text,
  attachment_path text,
  notes text,
  review_status public.review_status not null default 'recorded',
  reviewed_by uuid references public.profiles (user_id),
  reviewed_at timestamptz,
  query_note text,
  currency char(3) not null default 'GHS',
  fx_rate numeric(12,6) not null default 1,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create or replace function app.statutory_lines_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.statutory_payments where statutory_line_id = old.id and status <> 'cancelled') then
      raise exception 'This line has payments against it' using errcode = '42501';
    end if;
    return old;
  end if;
  new.payee := coalesce(new.payee,
    case when new.type = 'ssnit_tier2' then (app.settings_at(coalesce(new.period_start, app.today()))).tier2_trustee end,
    (select payee from public.statutory_due_rules where type = new.type));
  if new.due_date is null and new.period_start is not null then
    new.due_date := app.statutory_due_date(new.type, new.period_start);
  end if;
  if new.period_start is not null and new.period_end is null then
    new.period_end := (date_trunc('month', new.period_start) + interval '1 month' - interval '1 day')::date;
  end if;
  if tg_op = 'UPDATE' and old.auto_key is not null and not app.in_system()
     and new.amount_due is distinct from old.amount_due then
    raise exception 'This line is calculated from its source records' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger before_write before insert or update or delete on public.statutory_lines
  for each row execute function app.statutory_lines_before();

create or replace function app.statutory_payments_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  perform app.assert_account_postable(new.account_id);
  return new;
end $$;
create trigger c_rules before insert or update or delete on public.statutory_payments
  for each row execute function app.statutory_payments_rules();

create or replace function app.statutory_payments_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.statutory_payments := coalesce(new, old);
begin
  perform app.post('statutory_payment', p.id, case
    when tg_op <> 'DELETE' and new.status = 'paid' then
      jsonb_build_array(jsonb_build_object('date', new.payment_date, 'account_id', new.account_id,
        'amount', -new.amount, 'description',
        'Statutory payment: ' || (select r.label from public.statutory_lines l join public.statutory_due_rules r on r.type = l.type
                                  where l.id = new.statutory_line_id)))
    else '[]'::jsonb end);
  return null;
end $$;
create trigger after_write after insert or update or delete on public.statutory_payments
  for each row execute function app.statutory_payments_after();

-- Maintains a system line (e.g. the month's WHT remittance) at an amount.
create or replace function app.upsert_statutory_line(p_key text, p_type text, p_period date, p_amount numeric,
  p_source_type text default null, p_source_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_system();
  insert into public.statutory_lines (type, period_start, amount_due, auto_key, source_type, source_id, created_by)
  values (p_type, date_trunc('month', p_period)::date, round(p_amount, 2), p_key, p_source_type, p_source_id, null)
  on conflict (auto_key) do update set amount_due = excluded.amount_due, updated_at = now();
  delete from public.statutory_lines l
   where l.auto_key = p_key and l.amount_due = 0
     and not exists (select 1 from public.statutory_payments where statutory_line_id = l.id);
  perform app.leave_system();
end $$;

-- WHT MeLiNS deducted from suppliers, and on directors' fees and dividends,
-- becomes that month's remittance line (brief §7.6).
create or replace function app.sync_withholding(p_month date) returns void
language plpgsql security definer set search_path = '' as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if m is null then return; end if;
  perform app.upsert_statutory_line('wht_remittance:' || to_char(m, 'YYYY-MM'), 'wht_remittance', m,
    coalesce((select sum(wht_amount) from public.payments_out
              where status = 'paid' and date_trunc('month', payment_date) = m), 0));
  perform app.upsert_statutory_line('wht_directors_dividends:' || to_char(m, 'YYYY-MM'), 'wht_directors_dividends', m,
    coalesce((select sum(tax_amount) from public.director_payments
              where status = 'paid' and date_trunc('month', payment_date) = m), 0));
end $$;

create or replace function app.withholding_sync_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'paid' then perform app.sync_withholding(old.payment_date); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'paid' then perform app.sync_withholding(new.payment_date); end if;
  return null;
end $$;
create trigger sync_withholding after insert or update or delete on public.payments_out
  for each row execute function app.withholding_sync_trigger();
create trigger sync_withholding after insert or update or delete on public.director_payments
  for each row execute function app.withholding_sync_trigger();

-- The statutory ledger with what's paid and outstanding; overdue lines show red.
create view public.statutory_ledger with (security_barrier) as
  select l.id, l.type, r.label, l.period_start, l.period_end, l.payee, l.amount_due, l.due_date,
         l.is_opening_arrears, l.notes,
         coalesce(p.paid, 0) as amount_paid,
         l.amount_due - coalesce(p.paid, 0) as outstanding,
         p.last_paid_on,
         case when l.amount_due - coalesce(p.paid, 0) <= 0.005 then 'paid'
              when l.is_opening_arrears or l.due_date < app.today() then 'overdue'
              when coalesce(p.paid, 0) > 0 then 'part_paid'
              else 'due' end as status
  from public.statutory_lines l
  join public.statutory_due_rules r on r.type = l.type
  left join lateral (
    select sum(amount) as paid, max(payment_date) as last_paid_on
    from public.statutory_payments sp where sp.statutory_line_id = l.id and sp.status = 'paid') p on true
  where app.is_finance();

-- -----------------------------------------------------------------------------
-- Payroll (brief §7.5). Calculated in the spreadsheet; imported and checked.
-- -----------------------------------------------------------------------------

-- Column mapping for each sheet (D-022), set once in Settings.
create table public.payroll_column_maps (
  id uuid primary key default gen_random_uuid(),
  sheet_kind text not null check (sheet_kind in ('staff', 'nsp')),
  effective_from date not null,
  sheet_name text not null,
  header_row int not null default 1,
  first_data_row int not null default 2,
  mapping jsonb not null,           -- { "basic": "E", "gross": "I", ... } field -> column
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (sheet_kind, effective_from)
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_month date not null check (extract(day from period_month) = 1),
  run_kind text not null default 'regular' check (run_kind in ('regular', 'supplementary')),
  status text not null default 'imported' check (status in ('imported', 'approved', 'issued', 'cancelled')),
  source_files jsonb not null default '[]',        -- storage paths of the uploaded sheets
  sheet_totals jsonb not null default '{}',        -- totals row from the sheet, per field
  approved_by uuid references public.profiles (user_id),
  approved_at timestamptz,
  issued_by uuid references public.profiles (user_id),
  issued_at timestamptz,
  paid_date date,                                  -- net pay leaves the account (A-012)
  account_id uuid references public.accounts (id),
  paid_recorded_by uuid references public.profiles (user_id),
  notes text,
  review_status public.review_status not null default 'recorded',
  reviewed_by uuid references public.profiles (user_id),
  reviewed_at timestamptz,
  query_note text,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index payroll_one_regular_run on public.payroll_runs (period_month)
  where run_kind = 'regular' and status <> 'cancelled';

-- One line per person per run. Columns follow the May 2026 workbook (D-023).
create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  source text not null default 'import' check (source in ('import', 'manual')),
  sheet_kind text not null default 'staff' check (sheet_kind in ('staff', 'nsp')),
  is_national_service boolean not null default false,
  basic numeric(14,2) not null default 0,
  taxable_allowances numeric(14,2) not null default 0,
  taxable_allowance_detail jsonb not null default '{}',
  bonus numeric(14,2) not null default 0,
  gross numeric(14,2) not null default 0,
  ssnit_employee numeric(14,2) not null default 0,
  pf_employee numeric(14,2) not null default 0,
  taxable_income numeric(14,2) not null default 0,
  paye numeric(14,2) not null default 0,
  bonus_paye numeric(14,2) not null default 0,
  post_tax_allowances numeric(14,2) not null default 0,     -- security, house help, refreshment, T&T, utilities
  post_tax_allowance_detail jsonb not null default '{}',
  net_pay numeric(14,2) not null default 0,
  loan_deduction numeric(14,2) not null default 0,
  advance_recovery numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  bank_amount numeric(14,2) not null default 0,
  ssnit_employer numeric(14,2) not null default 0,
  pf_employer numeric(14,2) not null default 0,
  tier1_amount numeric(14,2) not null default 0,            -- SSNIT split per settings (D-024)
  tier2_amount numeric(14,2) not null default 0,
  sheet_cost_to_company numeric(14,2),                      -- as the sheet states it (F-002)
  full_cost_to_company numeric(14,2) not null default 0,    -- gross + employer SSNIT + employer PF + post-tax allowances
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (run_id, staff_id)
);

alter table public.staff_loan_repayments
  add constraint loan_repayments_payroll_fk foreign key (payroll_line_id) references public.payroll_lines (id);

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_line_id uuid not null unique references public.payroll_lines (id),
  run_id uuid not null references public.payroll_runs (id),
  staff_id uuid not null references public.staff (id),
  period_month date not null,
  is_allowance_statement boolean not null default false,    -- national service persons
  ytd jsonb not null default '{}',
  pdf_path text,                                            -- rendered by the payslip Edge Function
  issued_at timestamptz not null default now(),
  first_viewed_at timestamptz
);
create index payslips_staff on public.payslips (staff_id, period_month desc);

create or replace function app.payroll_lines_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  run public.payroll_runs;
  s public.settings_versions;
begin
  select * into run from public.payroll_runs where id = coalesce(new.run_id, old.run_id);
  if run.status <> 'imported' and not app.in_system() then
    raise exception 'The payroll run is % and its lines are locked', run.status using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  s := app.settings_at(run.period_month);
  new.is_national_service := (select is_national_service from public.staff where id = new.staff_id);
  -- Split the SSNIT actually contributed (employee + employer) 13.5 : 5 (D-024).
  -- National service persons contribute nothing, so their tiers are nil.
  new.tier1_amount := round((new.ssnit_employee + new.ssnit_employer) * s.ssnit_tier1_rate
                            / (s.ssnit_tier1_rate + s.ssnit_tier2_rate), 2);
  new.tier2_amount := new.ssnit_employee + new.ssnit_employer - new.tier1_amount;
  new.full_cost_to_company := new.gross + new.ssnit_employer + new.pf_employer + new.post_tax_allowances;
  return new;
end $$;
create trigger before_write before insert or update or delete on public.payroll_lines
  for each row execute function app.payroll_lines_before();

-- Import checks before approval (brief §7.5; D-022, D-023). Blocking issues
-- stop approval; warnings are highlighted.
create or replace function public.payroll_checks(p_run uuid)
returns table (severity text, staff_id uuid, staff_name text, code text, message text)
language plpgsql stable security definer set search_path = '' as $$
declare
  run public.payroll_runs;
  s public.settings_versions;
  m_start date; m_end date;
  tol numeric; ttol numeric;
  f text; sheet numeric; ours numeric;
begin
  if not app.is_finance() then return; end if;
  select * into run from public.payroll_runs where id = p_run;
  if not found then return; end if;
  s := app.settings_at(run.period_month);
  tol := s.payroll_line_tolerance; ttol := s.payroll_total_tolerance;
  m_start := run.period_month; m_end := (m_start + interval '1 month' - interval '1 day')::date;

  if run.run_kind = 'regular' then
    -- Every active staff member present ...
    return query
      select 'blocking', st.id, st.full_name, 'missing_staff', 'Missing from the run'
      from public.staff st
      where st.is_active and st.start_date <= m_end and (st.end_date is null or st.end_date >= m_start)
        and not exists (select 1 from public.payroll_lines l where l.run_id = p_run and l.staff_id = st.id);
  end if;

  -- ... and nobody who has left.
  return query
    select 'blocking', st.id, st.full_name, 'not_employed', 'Not employed in this month'
    from public.payroll_lines l join public.staff st on st.id = l.staff_id
    where l.run_id = p_run and (st.start_date > m_end or (st.end_date is not null and st.end_date < m_start));

  -- Net = gross - SSF - PF - PAYE + post-tax allowances (D-023)
  return query
    select 'blocking', st.id, st.full_name, 'net_mismatch',
           format('Net pay %s does not equal gross - SSNIT - PF - PAYE + post-tax allowances = %s',
                  l.net_pay, l.gross - l.ssnit_employee - l.pf_employee - l.paye - l.bonus_paye + l.post_tax_allowances)
    from public.payroll_lines l join public.staff st on st.id = l.staff_id
    where l.run_id = p_run
      and abs(l.gross - l.ssnit_employee - l.pf_employee - l.paye - l.bonus_paye + l.post_tax_allowances - l.net_pay) > tol;

  -- Bank amount = net - loan - advance - other deductions
  return query
    select 'blocking', st.id, st.full_name, 'bank_mismatch',
           format('Bank amount %s does not equal net pay less deductions = %s',
                  l.bank_amount, l.net_pay - l.loan_deduction - l.advance_recovery - l.other_deductions)
    from public.payroll_lines l join public.staff st on st.id = l.staff_id
    where l.run_id = p_run
      and abs(l.net_pay - l.loan_deduction - l.advance_recovery - l.other_deductions - l.bank_amount) > tol;

  -- Staff loan instalments due this month appear as deductions.
  return query
    select 'blocking', st.id, st.full_name, 'loan_instalment_missing',
           format('Loan instalment of %s is due but %s was deducted', due.expected, coalesce(l.loan_deduction, 0))
    from (select ln.staff_id, sum(least(ln.monthly_instalment, app.loan_balance(ln.id))) as expected
          from public.staff_loans ln
          where ln.status = 'paid' and ln.cleared_at is null and ln.payment_date <= m_end
            and coalesce(ln.first_deduction_month, m_start) <= m_start
          group by ln.staff_id) due
    join public.staff st on st.id = due.staff_id
    left join public.payroll_lines l on l.run_id = p_run and l.staff_id = due.staff_id
    where run.run_kind = 'regular' and coalesce(l.loan_deduction, 0) + tol < due.expected;

  -- Totals match the sheet's totals row.
  for f in select jsonb_object_keys(run.sheet_totals) loop
    if f not in ('basic', 'gross', 'ssnit_employee', 'pf_employee', 'taxable_income', 'paye', 'net_pay',
                 'loan_deduction', 'bank_amount', 'ssnit_employer', 'pf_employer', 'post_tax_allowances') then
      continue;
    end if;
    sheet := (run.sheet_totals ->> f)::numeric;
    execute format('select coalesce(sum(%I), 0) from public.payroll_lines where run_id = $1', f) into ours using p_run;
    if abs(sheet - ours) > ttol then
      severity := 'blocking'; staff_id := null; staff_name := null; code := 'total_mismatch';
      message := format('Total %s: sheet %s, lines %s', f, sheet, ours);
      return next;
    end if;
  end loop;

  -- Warnings: gross changed since the last run; national service shown as allowances.
  return query
    select 'warning', st.id, st.full_name, 'gross_changed',
           format('Gross changed from %s to %s', prev.gross, l.gross)
    from public.payroll_lines l join public.staff st on st.id = l.staff_id
    join lateral (
      select pl.gross from public.payroll_lines pl join public.payroll_runs pr on pr.id = pl.run_id
      where pl.staff_id = l.staff_id and pr.run_kind = 'regular' and pr.status in ('approved', 'issued')
        and pr.period_month < run.period_month
      order by pr.period_month desc limit 1) prev on true
    where l.run_id = p_run and prev.gross <> l.gross;

  return query
    select 'warning', st.id, st.full_name, 'national_service', 'National service person: allowance statement, no SSNIT'
    from public.payroll_lines l join public.staff st on st.id = l.staff_id
    where l.run_id = p_run and l.is_national_service and (l.ssnit_employee > 0 or l.ssnit_employer > 0);
end $$;

create or replace function app.payroll_runs_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  role public.app_role := app.my_role();
begin
  if tg_op = 'DELETE' then
    if old.status <> 'imported' then raise exception 'Only an imported run can be deleted' using errcode = '42501'; end if;
    return old;
  end if;
  if app.in_system() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'imported'; new.approved_by := null; new.approved_at := null; new.issued_at := null;
    if app.is_month_closed(new.period_month) then raise exception 'That month is closed'; end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'imported' and new.status = 'approved' then
      if role is distinct from 'owner' then
        raise exception 'Only the Owner approves payroll' using errcode = '42501';
      end if;
      if exists (select 1 from public.payroll_checks(new.id) c where c.severity = 'blocking') then
        raise exception 'The payroll run fails its checks and cannot be approved';
      end if;
      if not exists (select 1 from public.payroll_lines where run_id = new.id) then
        raise exception 'The run has no lines';
      end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    elsif old.status = 'approved' and new.status = 'issued' then
      if role not in ('owner', 'accountant') then raise exception 'Not allowed' using errcode = '42501'; end if;
      new.issued_by := auth.uid(); new.issued_at := now();
    elsif old.status = 'imported' and new.status = 'cancelled' then
      if role not in ('owner', 'accountant') then raise exception 'Not allowed' using errcode = '42501'; end if;
    else
      raise exception 'A payroll run cannot move from % to %', old.status, new.status;
    end if;
  end if;

  -- Recording net pay as paid (A-012): once, after approval.
  if (new.paid_date, new.account_id) is distinct from (old.paid_date, old.account_id) then
    if old.paid_date is not null then raise exception 'This run is already recorded as paid' using errcode = '42501'; end if;
    if new.status not in ('approved', 'issued') then raise exception 'Approve the run before recording it as paid'; end if;
    if new.paid_date is null or new.account_id is null then raise exception 'Record the date paid and the account'; end if;
    if role not in ('owner', 'accountant') then raise exception 'Not allowed' using errcode = '42501'; end if;
    if app.is_month_closed(new.paid_date) then raise exception 'That month is closed'; end if;
    new.paid_recorded_by := auth.uid();
  end if;
  return new;
end $$;
create trigger b_rules before insert or update or delete on public.payroll_runs
  for each row execute function app.payroll_runs_before();

create or replace function app.payroll_runs_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l record;
  ln record;
  left_to_apply numeric;
  take numeric;
  s public.settings_versions;
  mk text;
begin
  if tg_op = 'DELETE' then return null; end if;
  s := app.settings_at(new.period_month);
  mk := new.id::text;

  if new.status = 'approved' and old.status = 'imported' then
    -- Statutory lines for the month (brief §7.5 "On approval").
    perform app.upsert_statutory_line('paye:' || mk, 'paye', new.period_month,
      (select sum(paye) from public.payroll_lines where run_id = new.id), 'payroll_run', new.id);
    perform app.upsert_statutory_line('ssnit_tier1:' || mk, 'ssnit_tier1', new.period_month,
      (select sum(tier1_amount) from public.payroll_lines where run_id = new.id), 'payroll_run', new.id);
    perform app.upsert_statutory_line('ssnit_tier2:' || mk, 'ssnit_tier2', new.period_month,
      (select sum(tier2_amount) from public.payroll_lines where run_id = new.id), 'payroll_run', new.id);
    perform app.upsert_statutory_line('bonus_paye:' || mk, 'bonus_paye', new.period_month,
      (select sum(bonus_paye) from public.payroll_lines where run_id = new.id), 'payroll_run', new.id);

    -- Loan repayments from the deduction column, oldest loan first.
    perform app.enter_system();
    for l in select * from public.payroll_lines where run_id = new.id and loan_deduction > 0 loop
      left_to_apply := l.loan_deduction;
      for ln in select * from public.staff_loans
                where staff_id = l.staff_id and status = 'paid' and cleared_at is null
                order by payment_date, created_at loop
        exit when left_to_apply <= 0;
        take := least(left_to_apply, app.loan_balance(ln.id));
        if take > 0 then
          insert into public.staff_loan_repayments (loan_id, repayment_date, amount, method, payroll_line_id,
                                                    review_status, created_by)
          values (ln.id, (new.period_month + interval '1 month' - interval '1 day')::date, take,
                  'salary_deduction', l.id, 'not_required', auth.uid());
          left_to_apply := left_to_apply - take;
        end if;
      end loop;
    end loop;
    perform app.leave_system();

    perform app.notify_role('accountant', 'payroll_approved',
      format('Payroll for %s approved', to_char(new.period_month, 'Mon YYYY')),
      format('/payroll/%s', to_char(new.period_month, 'YYYY-MM')), 'payroll_run', new.id);
  end if;

  if new.status = 'issued' and old.status = 'approved' then
    insert into public.payslips (payroll_line_id, run_id, staff_id, period_month, is_allowance_statement, ytd)
    select pl.id, new.id, pl.staff_id, new.period_month, pl.is_national_service,
           (select jsonb_build_object(
              'gross', sum(y.gross), 'paye', sum(y.paye), 'ssnit_employee', sum(y.ssnit_employee),
              'net_pay', sum(y.net_pay), 'ssnit_employer', sum(y.ssnit_employer))
            from public.payroll_lines y join public.payroll_runs yr on yr.id = y.run_id
            where y.staff_id = pl.staff_id and yr.status in ('approved', 'issued')
              and extract(year from yr.period_month) = extract(year from new.period_month)
              and yr.period_month <= new.period_month)
    from public.payroll_lines pl where pl.run_id = new.id;

    insert into public.notifications (recipient_id, kind, title, link, record_type, record_id, send_email)
    select app.staff_profile(p.staff_id), 'payslip_ready',
           format('Your payslip for %s is ready', to_char(new.period_month, 'Mon YYYY')),
           format('/me/payslips/%s', p.id), 'payslip', p.id, true
    from public.payslips p where p.run_id = new.id and app.staff_profile(p.staff_id) is not null;
  end if;

  -- Net pay leaves the account when the run is recorded as paid (A-012).
  perform app.post('payroll_run', new.id, case when new.paid_date is not null then
    jsonb_build_array(jsonb_build_object('date', new.paid_date, 'account_id', new.account_id,
      'amount', -(select sum(bank_amount) from public.payroll_lines where run_id = new.id),
      'description', 'Net pay ' || to_char(new.period_month, 'Mon YYYY')))
    else '[]'::jsonb end);
  return null;
end $$;
create trigger after_write after update on public.payroll_runs
  for each row execute function app.payroll_runs_after();

-- Cost changes the Owner is asked to confirm after approval (brief §7.5).
create view public.payroll_cost_changes with (security_barrier) as
  select r.id as run_id, r.period_month, l.staff_id, st.full_name,
         (app.staff_cost_at(l.staff_id, r.period_month)).monthly_cost as current_cost,
         l.full_cost_to_company as payroll_cost, l.basic
  from public.payroll_runs r
  join public.payroll_lines l on l.run_id = r.id
  join public.staff st on st.id = l.staff_id
  where app.has_role('owner') and r.run_kind = 'regular' and r.status in ('approved', 'issued')
    and (app.staff_cost_at(l.staff_id, r.period_month)).monthly_cost is distinct from l.full_cost_to_company;

create or replace function public.apply_payroll_cost_changes(p_run uuid, p_staff uuid[]) returns int
language plpgsql security invoker set search_path = '' as $$
declare n int;
begin
  insert into public.staff_cost_history (staff_id, effective_from, monthly_cost, basic_pay, source, notes)
  select c.staff_id, c.period_month, c.payroll_cost, c.basic, 'payroll', 'Confirmed from payroll run'
  from public.payroll_cost_changes c
  where c.run_id = p_run and c.staff_id = any (p_staff)
  on conflict (staff_id, effective_from) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- VAT workings (brief §7.6): a monthly summary for the Accountant.
-- output - credit notes - claimable input - withheld by clients = payable
-- -----------------------------------------------------------------------------
create or replace function public.vat_workings(p_month date)
returns table (component text, is_vat boolean, output_tax numeric, credit_notes numeric,
               input_claimable numeric, withheld_by_clients numeric, net_payable numeric)
language sql stable security definer set search_path = '' as $$
  with m as (select date_trunc('month', p_month)::date as s,
                    (date_trunc('month', p_month) + interval '1 month')::date as e),
  outp as (
    select t.name, t.is_vat, sum(t.amount) amt
    from public.invoice_line_taxes t
    join public.invoice_lines l on l.id = t.line_id
    join public.invoices i on i.id = l.invoice_id, m
    where i.status <> 'draft' and not i.is_imported and i.invoice_date >= m.s and i.invoice_date < m.e
    group by t.name, t.is_vat),
  cn as (
    select t.name, t.is_vat, sum(t.amount) amt
    from public.credit_note_taxes t join public.credit_notes c on c.id = t.credit_note_id, m
    where c.status = 'approved' and c.cn_date >= m.s and c.cn_date < m.e
    group by t.name, t.is_vat),
  inp as (
    select t.name, t.is_vat, sum(t.amount) amt
    from public.expense_taxes t join public.expenses x on x.id = t.expense_id, m
    where t.recoverable and x.has_valid_vat_invoice and x.entry_status = 'confirmed'
      and x.expense_date >= m.s and x.expense_date < m.e
    group by t.name, t.is_vat),
  wh as (
    select sum(r.vat_withheld_amount) amt
    from public.receipts r, m
    where r.status = 'confirmed' and r.receipt_date >= m.s and r.receipt_date < m.e),
  names as (select name, is_vat from outp union select name, is_vat from cn union select name, is_vat from inp)
  select n.name, n.is_vat,
         coalesce(o.amt, 0), coalesce(c.amt, 0), coalesce(i.amt, 0),
         case when n.is_vat then coalesce((select amt from wh), 0) else 0 end,
         coalesce(o.amt, 0) - coalesce(c.amt, 0) - coalesce(i.amt, 0)
           - case when n.is_vat then coalesce((select amt from wh), 0) else 0 end
  from names n
  left join outp o on o.name = n.name and o.is_vat = n.is_vat
  left join cn c on c.name = n.name and c.is_vat = n.is_vat
  left join inp i on i.name = n.name and i.is_vat = n.is_vat
  where app.is_finance()
  order by n.is_vat desc, n.name
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.statutory_due_rules enable row level security;
alter table public.statutory_lines enable row level security;
alter table public.statutory_payments enable row level security;
alter table public.payroll_column_maps enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;
alter table public.payslips enable row level security;

create policy due_rules_read on public.statutory_due_rules for select to authenticated using (app.is_finance());
create policy due_rules_write on public.statutory_due_rules for update to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));

create policy statutory_lines_read on public.statutory_lines for select to authenticated using (app.is_finance());
create policy statutory_lines_write on public.statutory_lines for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));
create policy statutory_payments_read on public.statutory_payments for select to authenticated using (app.is_finance());
create policy statutory_payments_write on public.statutory_payments for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));

create policy column_maps_read on public.payroll_column_maps for select to authenticated using (app.is_finance());
create policy column_maps_write on public.payroll_column_maps for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));

-- Payroll: finance-restricted (brief §5). Run totals stay visible to Directors;
-- individual lines and payslips can be hidden (D-017). Everyone sees their
-- own line and payslip once the run is issued.
create policy payroll_runs_read on public.payroll_runs for select to authenticated using (app.is_finance());
create policy payroll_runs_write on public.payroll_runs for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));

create or replace function app.payroll_run_issued(p_run uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payroll_runs r where r.id = p_run and r.status = 'issued')
$$;

create policy payroll_lines_read on public.payroll_lines for select to authenticated
  using ((app.is_finance() and app.area_visible('salaries'))
         or (staff_id = app.my_staff_id() and app.payroll_run_issued(run_id)));
create policy payroll_lines_write on public.payroll_lines for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));

create policy payslips_read on public.payslips for select to authenticated
  using ((app.is_finance() and app.area_visible('salaries')) or staff_id = app.my_staff_id());
-- Payslips are created by the issue trigger; the only update is recording
-- the rendered PDF (Edge Function, service role). No user write policies.

create or replace function app.payslips_locked() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - array['pdf_path', 'first_viewed_at']) <> (to_jsonb(old) - array['pdf_path', 'first_viewed_at']) then
    raise exception 'Issued payslips are locked; issue a supplementary run to correct one' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger locked before update or delete on public.payslips
  for each row execute function app.payslips_locked();

-- -----------------------------------------------------------------------------
-- Review, approval flow, locks, touch, audit
-- -----------------------------------------------------------------------------
select app.enable_review('public.statutory_payments');
select app.enable_review('public.payroll_runs');
select app.enable_payout('public.statutory_payments', '/tax/statutory');
select app.enable_month_lock('public.statutory_payments', 'payment_date');

create trigger touch before update on public.statutory_lines for each row execute function app.touch();
create trigger touch before update on public.statutory_payments for each row execute function app.touch();
create trigger touch before update on public.payroll_runs for each row execute function app.touch();
create trigger touch before update on public.statutory_due_rules for each row execute function app.touch();

select app.enable_audit(t) from unnest(array[
  'public.statutory_due_rules', 'public.statutory_lines', 'public.statutory_payments',
  'public.payroll_column_maps', 'public.payroll_runs', 'public.payroll_lines', 'public.payslips']::regclass[]) t;
