-- =============================================================================
-- 0200 Setup and reference data (brief §7.1, §7.2 minimal): settings (dated),
-- public holidays, accounts, tax codes, WHT rates, expense categories, job
-- types, budget roles, staff, staff cost history, clients, referrers, suppliers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Settings: dated versions, so past records keep the values in force at the
-- time (brief §7.1). Blank = "set in the setup wizard, never guessed" (§11).
-- -----------------------------------------------------------------------------
create table public.settings_versions (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,

  -- Company details printed on tax invoices
  registered_name text not null default 'MeLiNS Associates Limited',
  tin text,
  vat_number text,
  address text,
  accounts_email text not null default 'accounts@themelins.com',
  invoice_payment_details text,          -- bank / MoMo instructions printed on invoices
  financial_year_end_month int not null default 12 check (financial_year_end_month between 1 and 12),
  tier2_trustee text,

  -- Targets and pricing (brief §8)
  monthly_fee_target numeric(14,2) not null default 62500,
  fee_target_mode text not null default 'fixed' check (fee_target_mode in ('fixed', 'calculated')),
  desired_cash_buffer numeric(14,2) not null default 0,
  overhead_share numeric(6,4) not null default 0.25 check (overhead_share >= 0),
  target_margin numeric(6,4) not null default 0.20 check (target_margin >= 0),
  default_billable_hours numeric(6,2) not null default 100 check (default_billable_hours > 0),
  running_cost_override numeric(14,2),

  -- Money in
  invoice_terms_days int not null default 30 check (invoice_terms_days >= 0),
  client_wht_base text not null default 'net' check (client_wht_base in ('net', 'gross')),     -- D-019
  accountant_may_approve_invoices boolean not null default false,
  reported_payment_flag_days int not null default 14,
  wht_certificate_flag_days int not null default 30,
  director_receipt_flag_days int not null default 7,

  -- Money out
  max_open_advances int not null default 1,

  -- Timesheets and leave (brief §4)
  timesheet_self_days int not null default 3 check (timesheet_self_days >= 0),
  timesheet_lead_days int not null default 10,
  leave_year_start_month int not null default 1 check (leave_year_start_month between 1 and 12),
  max_carry_over_days numeric(5,1),
  check (timesheet_lead_days > timesheet_self_days),

  -- Bonus rule (§7.7). Base and eligibility are left for the wizard.
  bonus_base text check (bonus_base in ('basic', 'gross')),
  bonus_eligibility text,
  bonus_payment_month int not null default 12 check (bonus_payment_month between 1 and 12),
  bonus_prorated boolean not null default true,

  -- Payroll statutory rates (D-023, D-024)
  ssnit_employee_rate numeric(6,4) not null default 0.055,
  ssnit_employer_rate numeric(6,4) not null default 0.13,
  ssnit_tier1_rate numeric(6,4) not null default 0.135,
  ssnit_tier2_rate numeric(6,4) not null default 0.05,
  pf_employee_rate numeric(6,4) not null default 0,
  pf_employer_rate numeric(6,4) not null default 0,
  payroll_line_tolerance numeric(8,2) not null default 0.01,
  payroll_total_tolerance numeric(8,2) not null default 0.05,
  check (ssnit_tier1_rate + ssnit_tier2_rate = ssnit_employee_rate + ssnit_employer_rate),

  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- The settings in force on a date.
create or replace function app.settings_at(p_date date) returns public.settings_versions
language sql stable security definer set search_path = '' as $$
  select s.* from public.settings_versions s
  where s.effective_from <= p_date
  order by s.effective_from desc limit 1
$$;

-- Starting version. The setup wizard fills in the blanks.
insert into public.settings_versions (effective_from, notes)
values ('2026-01-01', 'Initial defaults from PROJECT_BRIEF §11; blanks are set in the setup wizard.');

-- Company details everybody may read (for invoice print, headers, terms).
create view public.company_profile with (security_barrier) as
  select s.registered_name, s.tin, s.vat_number, s.address, s.accounts_email,
         s.invoice_payment_details, s.invoice_terms_days, s.effective_from
  from public.settings_versions s
  where app.my_role() is not null
    and s.effective_from = (select max(effective_from) from public.settings_versions where effective_from <= app.today());

-- -----------------------------------------------------------------------------
-- Business calendar: Ghana public holidays (brief §4). Weekends are never
-- working days.
-- -----------------------------------------------------------------------------
create table public.public_holidays (
  holiday_date date primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create or replace function app.is_working_day(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_date) < 6
     and not exists (select 1 from public.public_holidays h where h.holiday_date = p_date)
$$;

-- Working days strictly after p_from, up to and including p_to.
create or replace function app.working_days_between(p_from date, p_to date) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from generate_series(p_from + 1, p_to, interval '1 day') g(d)
  where app.is_working_day(g.d::date)
$$;

-- Working days in [p_start, p_end] inclusive (leave requests).
create or replace function app.working_days_in(p_start date, p_end date) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from generate_series(p_start, p_end, interval '1 day') g(d)
  where app.is_working_day(g.d::date)
$$;

create or replace function app.next_working_day(p_date date) returns date
language sql stable security definer set search_path = '' as $$
  select min(g.d)::date
  from generate_series(p_date, p_date + 30, interval '1 day') g(d)
  where app.is_working_day(g.d::date)
$$;

-- -----------------------------------------------------------------------------
-- MeLiNS accounts (brief §7.1). Only the last 4 digits are ever stored.
-- -----------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null check (type in ('bank', 'mobile_money', 'petty_cash', 'other')),
  institution text,
  last4 text check (last4 ~ '^\d{4}$'),
  purpose text not null check (purpose in ('operating', 'collections', 'payroll', 'reserve', 'petty_cash')),
  currency char(3) not null default 'GHS',
  opening_balance numeric(14,2) not null default 0,
  opening_date date not null,
  admin_may_post boolean not null default false,
  is_active boolean not null default true,
  notes text,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin never reads accounts directly (A-003). This picker gives Admin the name
-- only, and only for accounts Admin may post to.
create view public.account_picker with (security_barrier) as
  select a.id, a.name, a.type
  from public.accounts a
  where a.is_active
    and (app.has_role('owner', 'accountant')
         or (app.has_role('admin') and a.admin_may_post));

-- Called by money-entry triggers: Admin may only post to accounts flagged for it.
create or replace function app.assert_account_postable(p_account uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_account is null then return; end if;
  if app.my_role() = 'admin'
     and not exists (select 1 from public.accounts where id = p_account and admin_may_post and is_active) then
    raise exception 'Admin may not post to this account' using errcode = '42501';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Tax codes (brief §7.1; D-018, D-019). Never hardcode rates.
-- A code (e.g. "Standard") has dated versions; each version has ordered
-- components (VAT, NHIL, GETFund, ...) with a rate and a stacking basis:
--   net            -> component = net x rate
--   net_plus_prior -> component = (net + all earlier components) x rate
-- -----------------------------------------------------------------------------
create table public.tax_codes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('standard', 'zero_rated', 'exempt', 'no_vat', 'other')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.tax_code_versions (
  id uuid primary key default gen_random_uuid(),
  tax_code_id uuid not null references public.tax_codes (id),
  effective_from date not null,
  -- share of the VAT components withheld by a VAT withholding agent (D-019)
  vat_withholding_rate numeric(6,4) not null default 0 check (vat_withholding_rate between 0 and 1),
  confirmed_by uuid references public.profiles (user_id),   -- Accountant confirms at setup
  confirmed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (tax_code_id, effective_from)
);

create table public.tax_code_components (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.tax_code_versions (id) on delete cascade,
  seq int not null check (seq > 0),
  name text not null,
  rate numeric(7,5) not null check (rate >= 0 and rate < 1),
  basis text not null default 'net' check (basis in ('net', 'net_plus_prior')),
  recoverable boolean not null default true,   -- claimable as input tax
  is_vat boolean not null default false,       -- the component a VAT withholding agent withholds
  unique (version_id, seq),
  unique (version_id, name)
);

create or replace function app.tax_version_at(p_tax_code uuid, p_date date) returns uuid
language sql stable security definer set search_path = '' as $$
  select v.id from public.tax_code_versions v
  where v.tax_code_id = p_tax_code and v.effective_from <= p_date
  order by v.effective_from desc limit 1
$$;

-- Components of a tax code on a date, applied to a net amount, in order.
create or replace function app.compute_taxes(p_tax_code uuid, p_date date, p_net numeric)
returns table (component_id uuid, seq int, name text, rate numeric, basis text,
               recoverable boolean, is_vat boolean, base numeric, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := app.tax_version_at(p_tax_code, p_date);
  running numeric := p_net;
  c record;
begin
  if p_tax_code is null then return; end if;
  if v is null then
    raise exception 'No version of this tax code is in force on %', p_date;
  end if;
  for c in select * from public.tax_code_components where version_id = v order by seq loop
    component_id := c.id; seq := c.seq; name := c.name; rate := c.rate; basis := c.basis;
    recoverable := c.recoverable; is_vat := c.is_vat;
    base := case when c.basis = 'net' then p_net else running end;
    amount := round(base * c.rate, 2);
    running := running + amount;
    return next;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- WHT rates by category (clients deduct; MeLiNS deducts from suppliers and on
-- directors' fees / dividends). Dated; rates entered at setup.
-- -----------------------------------------------------------------------------
create table public.wht_rates (
  id uuid primary key default gen_random_uuid(),
  applies_to text not null check (applies_to in ('client', 'supplier', 'director_fee', 'dividend')),
  category text not null,
  rate numeric(6,4) not null check (rate between 0 and 1),
  effective_from date not null,
  created_at timestamptz not null default now(),
  unique (applies_to, category, effective_from)
);

create or replace function app.wht_rate_at(p_applies_to text, p_category text, p_date date) returns numeric
language sql stable security definer set search_path = '' as $$
  select r.rate from public.wht_rates r
  where r.applies_to = p_applies_to and r.category = p_category and r.effective_from <= p_date
  order by r.effective_from desc limit 1
$$;

-- -----------------------------------------------------------------------------
-- Chart of expense categories: one list, two levels (brief §7.1).
-- Can be renamed but not deleted once used (FKs are RESTRICT).
-- -----------------------------------------------------------------------------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.expense_categories (id),
  name text not null,
  requires_job boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique nulls not distinct (parent_id, name)
);

-- Only two levels: a category's parent must itself be top-level.
create or replace function app.check_category_depth() returns trigger
language plpgsql as $$
begin
  if new.parent_id is not null
     and exists (select 1 from public.expense_categories where id = new.parent_id and parent_id is not null) then
    raise exception 'Expense categories have two levels only';
  end if;
  return new;
end $$;
create trigger depth before insert or update on public.expense_categories
  for each row execute function app.check_category_depth();

create table public.job_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true
);

-- Budget roles: timesheet hours roll up by these (D-014).
create table public.budget_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  billable_default boolean not null default true,
  sort_order int not null default 0
);

-- -----------------------------------------------------------------------------
-- Staff (brief §7.1; D-013..D-015)
-- -----------------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  job_title text not null,
  budget_role_id uuid not null references public.budget_roles (id),
  email text unique,
  billable_default boolean not null default true,
  monthly_billable_target numeric(6,2) not null default 100 check (monthly_billable_target >= 0),
  -- Who approves this person's timesheets and leave (D-015). NULL = the Owner's
  -- own record: auto-approved, no window.
  approver_staff_id uuid references public.staff (id),
  is_national_service boolean not null default false,
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (approver_staff_id is distinct from id)
);

alter table public.profiles
  add constraint profiles_staff_fk foreign key (staff_id) references public.staff (id),
  add constraint profiles_staff_unique unique (staff_id);

-- Personal identifiers printed on payslips. Finance roles and the person only.
create table public.staff_private (
  staff_id uuid primary key references public.staff (id),
  ssnit_number text,
  tin text,
  updated_at timestamptz not null default now()
);

-- Never overwritten: a change adds a new dated row (brief §7.1, §8).
create table public.staff_cost_history (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  effective_from date not null,
  monthly_cost numeric(14,2) not null check (monthly_cost >= 0),
  basic_pay numeric(14,2) check (basic_pay >= 0),
  source text not null default 'manual' check (source in ('manual', 'seed', 'payroll')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (staff_id, effective_from)
);

create or replace function app.staff_cost_at(p_staff uuid, p_date date) returns public.staff_cost_history
language sql stable security definer set search_path = '' as $$
  select h.* from public.staff_cost_history h
  where h.staff_id = p_staff and h.effective_from <= p_date
  order by h.effective_from desc limit 1
$$;

-- Rates in force on a date (brief §8). Cost rate carries the overhead share;
-- charge-out rate adds the target margin on top (A-017).
create or replace function app.staff_rates_at(p_staff uuid, p_date date,
  out cost_rate numeric, out charge_out_rate numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.staff_cost_history := app.staff_cost_at(p_staff, p_date);
  s public.settings_versions := app.settings_at(p_date);
begin
  if c.id is null or s.id is null then
    cost_rate := null; charge_out_rate := null; return;
  end if;
  cost_rate := round(c.monthly_cost * (1 + s.overhead_share) / s.default_billable_hours, 2);
  charge_out_rate := round(cost_rate * (1 + s.target_margin), 2);
end $$;

-- -----------------------------------------------------------------------------
-- Clients (brief §7.2)
-- -----------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organisation text,
  type text not null default 'corporate'
    check (type in ('government', 'corporate', 'private_individual', 'other')),
  phone text,
  email text,
  tin text,
  vat_number text,
  deducts_wht boolean not null default false,
  wht_category text,
  is_vat_withholding_agent boolean not null default false,
  payment_terms_days int check (payment_terms_days >= 0),
  notes text,
  is_active boolean not null default true,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (not deducts_wht or wht_category is not null)
);
create index clients_name on public.clients (lower(name));

-- Referrers (minimal in Phase A, D-012). Contact log and BD fees are Phase B.
create table public.referrers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organisation text,
  relationship text not null default 'other'
    check (relationship in ('mentor', 'consultant', 'contractor', 'architect', 'past_client', 'other')),
  phone text,
  email text,
  last_contact_date date,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

-- Suppliers (minimal in Phase A, D-011).
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'other' check (type in (
    'freelance_cad', 'freelance_engineer', 'equipment_hire', 'vehicle_hire',
    'materials', 'other')),
  wht_category text,
  notes text,
  is_active boolean not null default true,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

-- Supplier TIN / Ghana Card are finance-restricted (brief §3). Admin can enter
-- them (insert/update) but not read them back.
create table public.supplier_identifiers (
  supplier_id uuid primary key references public.suppliers (id),
  tin text,
  ghana_card text,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.settings_versions enable row level security;
alter table public.public_holidays enable row level security;
alter table public.accounts enable row level security;
alter table public.tax_codes enable row level security;
alter table public.tax_code_versions enable row level security;
alter table public.tax_code_components enable row level security;
alter table public.wht_rates enable row level security;
alter table public.expense_categories enable row level security;
alter table public.job_types enable row level security;
alter table public.budget_roles enable row level security;
alter table public.staff enable row level security;
alter table public.staff_private enable row level security;
alter table public.staff_cost_history enable row level security;
alter table public.clients enable row level security;
alter table public.referrers enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_identifiers enable row level security;

-- Settings: the rate build-up is finance-restricted; only the Owner edits.
create policy settings_read on public.settings_versions for select to authenticated using (app.is_finance());
create policy settings_owner_insert on public.settings_versions for insert to authenticated with check (app.has_role('owner'));
create policy settings_owner_update on public.settings_versions for update to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));

create policy holidays_read on public.public_holidays for select to authenticated using (app.my_role() is not null);
create policy holidays_write on public.public_holidays for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));

-- Accounts: balances and details are finance-restricted; Admin uses account_picker.
create policy accounts_read on public.accounts for select to authenticated using (app.is_finance());
create policy accounts_write on public.accounts for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));

-- Tax codes and WHT rates: everyone who drafts invoices or expenses reads them;
-- Owner and Accountant maintain them.
create policy tax_codes_read on public.tax_codes for select to authenticated using (app.my_role() is not null);
create policy tax_codes_write on public.tax_codes for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));
create policy tax_versions_read on public.tax_code_versions for select to authenticated using (app.my_role() is not null);
create policy tax_versions_write on public.tax_code_versions for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));
create policy tax_components_read on public.tax_code_components for select to authenticated using (app.my_role() is not null);
create policy tax_components_write on public.tax_code_components for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));
create policy wht_rates_read on public.wht_rates for select to authenticated using (app.my_role() is not null);
create policy wht_rates_write on public.wht_rates for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));

create policy categories_read on public.expense_categories for select to authenticated using (app.my_role() is not null);
create policy categories_write on public.expense_categories for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));
create policy job_types_read on public.job_types for select to authenticated using (app.my_role() is not null);
create policy job_types_write on public.job_types for all to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));
create policy budget_roles_read on public.budget_roles for select to authenticated using (app.my_role() is not null);
create policy budget_roles_write on public.budget_roles for all to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));

-- Staff: names, roles and dates are visible to everyone signed in (leave
-- calendar, approvals). Costs live in staff_cost_history.
create policy staff_read on public.staff for select to authenticated using (app.my_role() is not null);
create policy staff_owner_write on public.staff for all to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));

create policy staff_private_read on public.staff_private for select to authenticated
  using ((app.is_finance() and app.area_visible('salaries')) or staff_id = app.my_staff_id());
create policy staff_private_owner_write on public.staff_private for all to authenticated
  using (app.has_role('owner')) with check (app.has_role('owner'));

-- Staff costs: finance-restricted, hideable from Directors (D-017). Only the
-- Owner changes them, and only by adding rows (no update / delete policy).
create policy staff_cost_read on public.staff_cost_history for select to authenticated
  using (app.is_finance() and app.area_visible('staff_costs'));
create policy staff_cost_owner_insert on public.staff_cost_history for insert to authenticated
  with check (app.has_role('owner'));

create policy clients_read on public.clients for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead'));
create policy clients_write on public.clients for insert to authenticated
  with check (app.has_role('owner', 'accountant', 'admin', 'project_lead'));
create policy clients_update on public.clients for update to authenticated
  using (app.has_role('owner', 'accountant', 'admin', 'project_lead'))
  with check (app.has_role('owner', 'accountant', 'admin', 'project_lead'));

create policy referrers_read on public.referrers for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead'));
create policy referrers_insert on public.referrers for insert to authenticated
  with check (app.has_role('owner', 'accountant', 'admin', 'project_lead'));
create policy referrers_update on public.referrers for update to authenticated
  using (app.has_role('owner', 'accountant', 'admin', 'project_lead'))
  with check (app.has_role('owner', 'accountant', 'admin', 'project_lead'));

create policy suppliers_read on public.suppliers for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin', 'project_lead'));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (app.has_role('owner', 'accountant', 'admin'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (app.has_role('owner', 'accountant', 'admin'))
  with check (app.has_role('owner', 'accountant', 'admin'));

create policy supplier_ids_read on public.supplier_identifiers for select to authenticated
  using (app.is_finance());
create policy supplier_ids_insert on public.supplier_identifiers for insert to authenticated
  with check (app.has_role('owner', 'accountant', 'admin'));
create policy supplier_ids_update on public.supplier_identifiers for update to authenticated
  using (app.has_role('owner', 'accountant', 'admin'))
  with check (app.has_role('owner', 'accountant', 'admin'));

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create trigger touch before update on public.accounts for each row execute function app.touch();
create trigger touch before update on public.staff for each row execute function app.touch();
create trigger touch before update on public.staff_private for each row execute function app.touch();
create trigger touch before update on public.clients for each row execute function app.touch();
create trigger touch before update on public.referrers for each row execute function app.touch();
create trigger touch before update on public.suppliers for each row execute function app.touch();
create trigger touch before update on public.supplier_identifiers for each row execute function app.touch();

select app.enable_audit(t) from unnest(array[
  'public.settings_versions', 'public.public_holidays', 'public.accounts',
  'public.tax_codes', 'public.tax_code_versions', 'public.tax_code_components',
  'public.wht_rates', 'public.expense_categories', 'public.staff', 'public.staff_private',
  'public.staff_cost_history', 'public.clients', 'public.suppliers',
  'public.supplier_identifiers']::regclass[]) t;
