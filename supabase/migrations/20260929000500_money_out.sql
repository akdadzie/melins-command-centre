-- =============================================================================
-- 0500 Money out (brief §7.5; D-010, D-011): expenses, recurring expenses,
-- supplier payments, staff reimbursement payments, transfers, staff loans,
-- directors' current accounts and payments to directors.
-- =============================================================================

create or replace function app.category_requires_job(p_category uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(c.requires_job, false) or coalesce(p.requires_job, false)
  from public.expense_categories c left join public.expense_categories p on p.id = c.parent_id
  where c.id = p_category
$$;

-- -----------------------------------------------------------------------------
-- Expenses (brief §7.5)
-- amount = what was paid (VAT-inclusive). With a tax code, the net and each
-- tax component are split out; input VAT is claimable only with a valid VAT
-- invoice, and only for recoverable components.
-- -----------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category_id uuid not null references public.expense_categories (id),
  job_id uuid references public.jobs (id),
  supplier_id uuid references public.suppliers (id),
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  tax_code_id uuid references public.tax_codes (id),
  has_valid_vat_invoice boolean not null default false,
  net_amount numeric(14,2) not null default 0,              -- set by trigger
  tax_amount numeric(14,2) not null default 0,              -- set by trigger
  input_vat_claimable numeric(14,2) not null default 0,     -- set by trigger
  payment_source text not null check (payment_source in
    ('company_account', 'petty_cash', 'staff_out_of_pocket', 'supplier_payable')),
  account_id uuid references public.accounts (id),
  receipt_path text,

  -- Out of pocket (brief §7.5): Owed -> Approved -> Reimbursed
  staff_id uuid references public.staff (id),
  reimbursement_status text check (reimbursement_status in ('owed', 'approved', 'rejected', 'reimbursed')),
  claim_decided_by uuid references public.profiles (user_id),
  claim_decided_at timestamptz,
  claim_note text,
  staff_payment_id uuid,                                    -- FK below

  -- Rechargeable to the client (invoiced via invoice_lines.expense_id, once only)
  rechargeable boolean not null default false,
  recharge_markup_pct numeric(6,2) not null default 0 check (recharge_markup_pct >= 0),

  -- Recurring drafts wait for Admin to confirm (brief §7.5)
  entry_status text not null default 'confirmed' check (entry_status in ('draft', 'confirmed')),
  recurring_expense_id uuid,                                -- FK below

  review_status public.review_status not null default 'recorded',
  reviewed_by uuid references public.profiles (user_id),
  reviewed_at timestamptz,
  query_note text,
  notes text,
  currency char(3) not null default 'GHS',
  fx_rate numeric(12,6) not null default 1,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check ((payment_source in ('company_account', 'petty_cash')) = (account_id is not null)),
  check ((payment_source = 'staff_out_of_pocket') = (staff_id is not null and reimbursement_status is not null)),
  check (payment_source <> 'supplier_payable' or supplier_id is not null),
  check (not rechargeable or job_id is not null)
);
create index expenses_date on public.expenses (expense_date);
create index expenses_job on public.expenses (job_id) where job_id is not null;
create index expenses_staff on public.expenses (staff_id) where staff_id is not null;

alter table public.invoice_lines
  add constraint invoice_lines_expense_fk foreign key (expense_id) references public.expenses (id);

create table public.expense_taxes (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  seq int not null,
  name text not null,
  rate numeric(7,5) not null,
  is_vat boolean not null,
  recoverable boolean not null,
  amount numeric(14,2) not null,
  primary key (expense_id, seq)
);

-- Recurring expenses (brief §7.5): each due date creates a draft for Admin.
create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid not null references public.expense_categories (id),
  supplier_id uuid references public.suppliers (id),
  job_id uuid references public.jobs (id),
  expected_amount numeric(14,2) not null check (expected_amount > 0),
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due_date date not null,
  account_id uuid references public.accounts (id),
  payment_source text not null default 'company_account' check (payment_source in
    ('company_account', 'petty_cash', 'supplier_payable')),
  tax_code_id uuid references public.tax_codes (id),
  is_fixed_amount boolean not null default true,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check ((payment_source in ('company_account', 'petty_cash')) = (account_id is not null)),
  check (payment_source <> 'supplier_payable' or supplier_id is not null)
);

alter table public.expenses
  add constraint expenses_recurring_fk foreign key (recurring_expense_id) references public.recurring_expenses (id);

-- Monthly equivalent of a recurring expense (for the running cost, brief §7.1).
create or replace function app.monthly_equivalent(p_amount numeric, p_frequency text) returns numeric
language sql immutable as $$
  select round(p_amount * case p_frequency when 'weekly' then 52.0 / 12 when 'monthly' then 1
                                           when 'quarterly' then 1.0 / 3 when 'yearly' then 1.0 / 12 end, 2)
$$;

-- -----------------------------------------------------------------------------
-- Supplier payments (brief §7.5): settle supplier bills (expenses with
-- payment source "supplier_payable"). WHT from the supplier's category.
-- -----------------------------------------------------------------------------
create table public.payments_out (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id),
  job_id uuid references public.jobs (id),
  description text,
  gross_amount numeric(14,2) not null default 0,            -- sum of items (trigger)
  wht_rate numeric(6,4) not null default 0,
  wht_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
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

create table public.payment_out_items (
  id uuid primary key default gen_random_uuid(),
  payment_out_id uuid not null references public.payments_out (id) on delete cascade,
  expense_id uuid not null references public.expenses (id),
  amount numeric(14,2) not null check (amount > 0),
  unique (payment_out_id, expense_id)
);

-- What is still owed on a supplier bill (Admin may see this per bill, brief §4).
create or replace function app.bill_outstanding(p_expense uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select e.amount - coalesce((
    select sum(i.amount) from public.payment_out_items i
    join public.payments_out p on p.id = i.payment_out_id
    where i.expense_id = e.id and p.status <> 'cancelled'), 0)
  from public.expenses e where e.id = p_expense
$$;

-- -----------------------------------------------------------------------------
-- Staff payments (reimbursements; per diems join in Phase B)
-- -----------------------------------------------------------------------------
create table public.staff_payments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  kind text not null default 'reimbursement' check (kind in ('reimbursement')),
  amount numeric(14,2) not null default 0,                  -- sum of linked expenses (trigger)
  is_to_owner boolean not null default false,               -- D-010
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

alter table public.expenses
  add constraint expenses_staff_payment_fk foreign key (staff_payment_id) references public.staff_payments (id);

-- -----------------------------------------------------------------------------
-- Account transfers (brief §7.5). Also how a director hands over client money
-- they received personally (from_director_id), which clears their balance.
-- -----------------------------------------------------------------------------
create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_date date not null,
  from_account_id uuid references public.accounts (id),
  from_director_id uuid references public.directors (id),
  to_account_id uuid not null references public.accounts (id),
  amount numeric(14,2) not null check (amount > 0),
  reference text,
  reason text,
  attachment_path text,
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
  updated_by uuid,
  check ((from_account_id is null) <> (from_director_id is null)),
  check (from_account_id is distinct from to_account_id)
);

-- -----------------------------------------------------------------------------
-- Staff loans (minimal in Phase A, D-011). Issuing a loan is money out.
-- -----------------------------------------------------------------------------
create table public.staff_loans (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  amount numeric(14,2) not null check (amount > 0),
  purpose text,
  monthly_instalment numeric(14,2) not null check (monthly_instalment > 0),
  first_deduction_month date check (first_deduction_month is null or extract(day from first_deduction_month) = 1),
  cleared_at date,
  status public.payout_status not null default 'prepared',
  prepared_by uuid references public.profiles (user_id),
  approved_by uuid references public.profiles (user_id),
  approved_at timestamptz,
  paid_by uuid references public.profiles (user_id),
  paid_at timestamptz,
  payment_date date,                                        -- the loan date
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
  updated_by uuid,
  check (monthly_instalment <= amount)
);

create table public.staff_loan_repayments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.staff_loans (id),
  repayment_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  method text not null check (method in ('salary_deduction', 'cash')),
  account_id uuid references public.accounts (id),          -- cash repayments only
  payroll_line_id uuid,                                     -- FK added in 0600
  reference text,
  review_status public.review_status not null default 'recorded',
  reviewed_by uuid references public.profiles (user_id),
  reviewed_at timestamptz,
  query_note text,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check ((method = 'cash') = (account_id is not null)),
  check (method = 'salary_deduction' or payroll_line_id is null)
);

create or replace function app.loan_balance(p_loan uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select l.amount - coalesce((select sum(r.amount) from public.staff_loan_repayments r where r.loan_id = l.id), 0)
  from public.staff_loans l where l.id = p_loan
$$;

-- -----------------------------------------------------------------------------
-- Directors' current accounts (brief §7.4) and payments to directors (§7.5)
-- -----------------------------------------------------------------------------
create table public.director_transactions (
  id uuid primary key default gen_random_uuid(),
  director_id uuid not null references public.directors (id),
  txn_date date not null,
  type text not null check (type in
    ('loan_in', 'capital_introduced', 'personal_item_paid_by_company', 'other_in', 'other_out')),
  amount numeric(14,2) not null check (amount > 0),
  account_id uuid not null references public.accounts (id),
  description text,
  reference text,
  attachment_path text,
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

create table public.director_payments (
  id uuid primary key default gen_random_uuid(),
  director_id uuid not null references public.directors (id),
  payment_type text not null check (payment_type in
    ('fee_or_allowance', 'sitting_allowance', 'expense_reimbursement', 'loan_repayment', 'dividend', 'other')),
  category_id uuid references public.expense_categories (id),
  gross_amount numeric(14,2) not null check (gross_amount > 0),
  tax_rate numeric(6,4) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  board_resolution_path text,                               -- dividends
  is_to_owner boolean not null default false,               -- D-010
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

-- =============================================================================
-- Logic
-- =============================================================================

-- Expenses -------------------------------------------------------------------
create or replace function app.expenses_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  role public.app_role := app.my_role();
  me uuid := app.my_staff_id();
  factor numeric;
  taxes numeric;
  claim numeric;
  tx record;
  sp public.staff_payments;
  fixed_keys text[] := array['review_status', 'reviewed_by', 'reviewed_at', 'query_note', 'updated_at',
    'updated_by', 'notes', 'receipt_path', 'reimbursement_status', 'staff_payment_id', 'claim_decided_by',
    'claim_decided_at', 'claim_note'];
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.invoice_lines where expense_id = old.id)
       or exists (select 1 from public.payment_out_items where expense_id = old.id)
       or old.staff_payment_id is not null then
      raise exception 'This expense has been paid, reimbursed or recharged and cannot be deleted' using errcode = '42501';
    end if;
    if role not in ('owner', 'accountant', 'admin') and not (old.staff_id = me and old.reimbursement_status = 'owed') then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    return old;
  end if;
  if app.in_system() then return new; end if;

  -- Staff and the Project lead may only claim their own out-of-pocket expenses.
  if role in ('staff', 'project_lead') and tg_op = 'INSERT'
     and not (new.payment_source = 'staff_out_of_pocket' and new.staff_id = me) then
    raise exception 'You can only claim your own out-of-pocket expenses' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and role in ('staff', 'project_lead') and old.staff_id = me
     and old.reimbursement_status <> 'owed' then
    raise exception 'This claim has been decided and can no longer be changed' using errcode = '42501';
  end if;

  perform app.assert_account_postable(new.account_id);
  if app.category_requires_job(new.category_id) and new.job_id is null then
    raise exception 'Job direct costs need a job';
  end if;

  -- Locked once reimbursed, recharged on an issued invoice, or paid to a supplier.
  if tg_op = 'UPDATE' and (old.reimbursement_status = 'reimbursed'
       or exists (select 1 from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
                  where l.expense_id = old.id and i.status <> 'draft')
       or exists (select 1 from public.payment_out_items t join public.payments_out p on p.id = t.payment_out_id
                  where t.expense_id = old.id and p.status in ('approved', 'paid')))
     and (to_jsonb(new) - fixed_keys) is distinct from (to_jsonb(old) - fixed_keys) then
    raise exception 'This expense has been reimbursed, recharged or paid and is locked' using errcode = '42501';
  end if;

  -- Split VAT and levies out of the amount paid.
  new.net_amount := new.amount; new.tax_amount := 0; new.input_vat_claimable := 0;
  if new.tax_code_id is not null then
    select sum(t.amount) into factor from app.compute_taxes(new.tax_code_id, new.expense_date, 1000000) t;
    new.net_amount := round(new.amount / (1 + coalesce(factor, 0) / 1000000), 2);
    select coalesce(sum(t.amount), 0), coalesce(sum(t.amount) filter (where t.recoverable), 0)
      into taxes, claim from app.compute_taxes(new.tax_code_id, new.expense_date, new.net_amount) t;
    new.net_amount := new.amount - taxes;              -- absorb rounding in the net
    new.tax_amount := taxes;
    new.input_vat_claimable := case when new.has_valid_vat_invoice then claim else 0 end;
  end if;

  -- Out-of-pocket claims
  if new.payment_source = 'staff_out_of_pocket' then
    if tg_op = 'INSERT' then
      new.reimbursement_status := 'owed'; new.staff_payment_id := null;
      new.claim_decided_by := null; new.claim_decided_at := null;
    elsif new.reimbursement_status is distinct from old.reimbursement_status then
      if old.reimbursement_status = 'owed' and new.reimbursement_status in ('approved', 'rejected') then
        if not app.can_approve_for(new.staff_id) or (new.staff_id = me and role <> 'owner') then
          raise exception 'You are not this person''s approver' using errcode = '42501';
        end if;
        new.claim_decided_by := auth.uid(); new.claim_decided_at := now();
      elsif old.reimbursement_status = 'approved' and new.reimbursement_status = 'owed' and app.has_role('owner') then
        new.claim_decided_by := null; new.claim_decided_at := null;
      else
        raise exception 'Reimbursement status is set by the payment';
      end if;
    end if;
    if new.staff_payment_id is distinct from coalesce(old.staff_payment_id, null) and tg_op = 'UPDATE' then
      if new.staff_payment_id is not null then
        select * into sp from public.staff_payments where id = new.staff_payment_id;
        if sp.status <> 'prepared' or sp.staff_id <> new.staff_id or new.reimbursement_status <> 'approved' then
          raise exception 'Only an approved claim can go on a prepared payment to the same person';
        end if;
      end if;
      if old.staff_payment_id is not null
         and (select status from public.staff_payments where id = old.staff_payment_id) <> 'prepared' then
        raise exception 'The reimbursement is already approved or paid' using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.rechargeable and not new.rechargeable
     and exists (select 1 from public.invoice_lines where expense_id = old.id) then
    raise exception 'This expense is already on an invoice';
  end if;
  return new;
end $$;
create trigger b_rules before insert or update or delete on public.expenses
  for each row execute function app.expenses_before_write();

create or replace function app.expenses_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.expenses := coalesce(new, old);
begin
  perform app.post('expense', e.id, case
    when tg_op <> 'DELETE' and new.entry_status = 'confirmed' and new.payment_source in ('company_account', 'petty_cash') then
      jsonb_build_array(jsonb_build_object('date', new.expense_date, 'account_id', new.account_id,
        'amount', -new.amount, 'description', new.description))
    else '[]'::jsonb end);

  if tg_op = 'DELETE' then
    if old.staff_payment_id is not null then perform app.refresh_staff_payment(old.staff_payment_id); end if;
    return null;
  end if;

  delete from public.expense_taxes where expense_id = new.id;
  if new.tax_code_id is not null then
    insert into public.expense_taxes (expense_id, seq, name, rate, is_vat, recoverable, amount)
    select new.id, t.seq, t.name, t.rate, t.is_vat, t.recoverable, t.amount
    from app.compute_taxes(new.tax_code_id, new.expense_date, new.net_amount) t;
  end if;

  if new.staff_payment_id is not null then perform app.refresh_staff_payment(new.staff_payment_id); end if;
  if tg_op = 'UPDATE' and old.staff_payment_id is not null and old.staff_payment_id is distinct from new.staff_payment_id then
    perform app.refresh_staff_payment(old.staff_payment_id);
  end if;

  if new.payment_source = 'staff_out_of_pocket' and tg_op = 'INSERT' then
    perform app.notify(
      coalesce(app.staff_profile((select approver_staff_id from public.staff where id = new.staff_id)),
               (select user_id from public.profiles where role = 'owner' and is_active limit 1)),
      'approval_needed', 'Expense claim to approve', format('/expenses?id=%s', new.id), 'expense', new.id);
  end if;
  if new.entry_status = 'draft' then
    perform app.open_action('confirm_recurring_draft', 'Confirm recurring expense: ' || new.description,
      format('/expenses?id=%s', new.id), 'admin', 'expense', new.id);
  elsif tg_op = 'UPDATE' and old.entry_status = 'draft' then
    perform app.close_action('confirm_recurring_draft', new.id);
  end if;
  return null;
end $$;

-- Staff payment amount = its linked claims.
create or replace function app.refresh_staff_payment(p_payment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.enter_system();
  update public.staff_payments sp
     set amount = coalesce((select sum(amount) from public.expenses where staff_payment_id = sp.id), 0)
   where sp.id = p_payment;
  perform app.leave_system();
end $$;

create trigger after_write after insert or update or delete on public.expenses
  for each row execute function app.expenses_after_write();

-- Recharge lines on invoices: price the expense and check it's rechargeable.
create or replace function app.recharge_line_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e public.expenses;
  inv public.invoices;
begin
  if new.line_type <> 'rechargeable_expense' then return new; end if;
  select * into e from public.expenses where id = new.expense_id;
  select * into inv from public.invoices where id = new.invoice_id;
  if not e.rechargeable or e.entry_status <> 'confirmed' then raise exception 'That expense is not rechargeable'; end if;
  if e.job_id <> inv.job_id then raise exception 'That expense belongs to another job'; end if;
  -- Recharged at cost plus markup; cost excludes VAT we can claim back.
  new.net_amount := coalesce(new.net_amount,
    round((case when e.input_vat_claimable > 0 then e.net_amount else e.amount end) * (1 + e.recharge_markup_pct / 100), 2));
  return new;
end $$;
create trigger a_recharge before insert or update on public.invoice_lines
  for each row execute function app.recharge_line_check();

-- Recurring expense drafts (run daily by the scheduler; safe to re-run).
create or replace function app.generate_recurring_drafts(p_as_of date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  r public.recurring_expenses;
  n int := 0;
  d date := coalesce(p_as_of, app.today());
begin
  perform app.enter_system();
  for r in select * from public.recurring_expenses where is_active and next_due_date <= d for update loop
    while r.next_due_date <= d loop
      insert into public.expenses (expense_date, category_id, job_id, supplier_id, description, amount,
        tax_code_id, payment_source, account_id, entry_status, recurring_expense_id, review_status, created_by)
      values (r.next_due_date, r.category_id, r.job_id, r.supplier_id, r.name, r.expected_amount,
        r.tax_code_id, r.payment_source, r.account_id, 'draft', r.id, 'recorded', null);
      n := n + 1;
      r.next_due_date := (r.next_due_date + case r.frequency when 'weekly' then interval '7 days'
        when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
        else interval '1 year' end)::date;
    end loop;
    update public.recurring_expenses set next_due_date = r.next_due_date where id = r.id;
  end loop;
  perform app.leave_system();
  return n;
end $$;

-- Supplier payments ----------------------------------------------------------
create or replace function app.payments_out_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.suppliers;
begin
  if tg_op = 'DELETE' then return old; end if;
  perform app.assert_account_postable(new.account_id);
  if new.status = 'prepared' then
    -- WHT from the supplier's category and the rate in force (brief §7.5).
    select * into s from public.suppliers where id = new.supplier_id;
    new.wht_rate := coalesce(app.wht_rate_at('supplier', s.wht_category, coalesce(new.payment_date, app.today())), 0);
    new.wht_amount := round(new.gross_amount * new.wht_rate, 2);
    new.net_amount := new.gross_amount - new.wht_amount;
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status = 'prepared' and new.gross_amount <= 0 then
    raise exception 'Add the bills this payment settles before approving it';
  end if;
  return new;
end $$;
create trigger c_rules before insert or update or delete on public.payments_out
  for each row execute function app.payments_out_rules();

create or replace function app.payments_out_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.payments_out := coalesce(new, old);
begin
  perform app.post('payment_out', p.id, case
    when tg_op <> 'DELETE' and new.status = 'paid' then
      jsonb_build_array(jsonb_build_object('date', new.payment_date, 'account_id', new.account_id,
        'amount', -new.net_amount, 'description', 'Supplier payment'))
    else '[]'::jsonb end);
  return null;
end $$;
create trigger after_write after insert or update or delete on public.payments_out
  for each row execute function app.payments_out_after();

create or replace function app.payment_items_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.payments_out;
  e public.expenses;
begin
  select * into p from public.payments_out where id = coalesce(new.payment_out_id, old.payment_out_id);
  if p.status <> 'prepared' and not app.in_system() then
    raise exception 'The payment is % and its bills are fixed', p.status using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select * into e from public.expenses where id = new.expense_id;
  if e.payment_source <> 'supplier_payable' or e.supplier_id <> p.supplier_id or e.entry_status <> 'confirmed' then
    raise exception 'Only a confirmed bill from this supplier can be paid here';
  end if;
  -- Can't pay more than is owed on the bill (brief §7.5).
  if new.amount > app.bill_outstanding(e.id) + coalesce(case when tg_op = 'UPDATE' then old.amount end, 0) + 0.005 then
    raise exception 'That is more than is owed on the bill';
  end if;
  return new;
end $$;
create trigger before_write before insert or update or delete on public.payment_out_items
  for each row execute function app.payment_items_before();

create or replace function app.payment_items_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare pid uuid := coalesce(new.payment_out_id, old.payment_out_id);
begin
  update public.payments_out
     set gross_amount = coalesce((select sum(amount) from public.payment_out_items where payment_out_id = pid), 0)
   where id = pid and status = 'prepared';
  return null;
end $$;
create trigger after_write after insert or update or delete on public.payment_out_items
  for each row execute function app.payment_items_after();

-- Staff payments -------------------------------------------------------------
create or replace function app.staff_payments_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  perform app.assert_account_postable(new.account_id);
  new.is_to_owner := app.staff_is_owner(new.staff_id);
  if new.is_to_owner then new.review_status := case when tg_op = 'INSERT' or old.review_status <> 'reviewed' then 'recorded' else new.review_status end; end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status = 'prepared' and new.amount <= 0 then
    raise exception 'Add the approved claims this payment reimburses';
  end if;
  return new;
end $$;
create trigger c_rules before insert or update or delete on public.staff_payments
  for each row execute function app.staff_payments_rules();

create or replace function app.staff_payments_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.staff_payments := coalesce(new, old);
begin
  perform app.post('staff_payment', p.id, case
    when tg_op <> 'DELETE' and new.status = 'paid' then
      jsonb_build_array(jsonb_build_object('date', new.payment_date, 'account_id', new.account_id,
        'amount', -new.amount, 'description', 'Staff reimbursement'))
    else '[]'::jsonb end);
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform app.enter_system();
    if new.status = 'paid' then
      update public.expenses set reimbursement_status = 'reimbursed' where staff_payment_id = new.id;
    elsif new.status = 'cancelled' then
      update public.expenses set staff_payment_id = null where staff_payment_id = new.id;
    end if;
    perform app.leave_system();
    if new.status = 'approved' and new.is_to_owner then
      perform app.flag_payment_to_owner('staff_payments', new.id, format('/staff-payments/%s', new.id),
        format('reimbursement of GHS %s', to_char(new.amount, 'FM999,999,990.00')));
    end if;
  end if;
  return null;
end $$;
create trigger after_write after insert or update or delete on public.staff_payments
  for each row execute function app.staff_payments_after();

-- Transfers ------------------------------------------------------------------
create or replace function app.transfers_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  perform app.assert_account_postable(new.from_account_id);
  perform app.assert_account_postable(new.to_account_id);
  if new.from_director_id is not null and app.my_role() = 'admin' then
    raise exception 'Only the Owner or Accountant records a director handing over client money' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger c_rules before insert or update or delete on public.transfers
  for each row execute function app.transfers_rules();

create or replace function app.transfers_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.transfers := coalesce(new, old);
begin
  perform app.post('transfer', t.id, case when tg_op = 'DELETE' then '[]'::jsonb else
    jsonb_build_array(
      case when new.from_account_id is not null
           then jsonb_build_object('date', new.transfer_date, 'account_id', new.from_account_id, 'amount', -new.amount, 'description', 'Transfer out')
           else jsonb_build_object('date', new.transfer_date, 'director_id', new.from_director_id, 'amount', new.amount, 'description', 'Handed client money to company') end,
      jsonb_build_object('date', new.transfer_date, 'account_id', new.to_account_id, 'amount', new.amount, 'description', 'Transfer in'))
  end);
  return null;
end $$;
create trigger after_write after insert or update or delete on public.transfers
  for each row execute function app.transfers_after();

-- Staff loans ----------------------------------------------------------------
create or replace function app.staff_loans_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.staff_loans := coalesce(new, old);
begin
  perform app.post('staff_loan', l.id, case
    when tg_op <> 'DELETE' and new.status = 'paid' then
      jsonb_build_array(jsonb_build_object('date', new.payment_date, 'account_id', new.account_id,
        'amount', -new.amount, 'description', 'Staff loan issued'))
    else '[]'::jsonb end);
  return null;
end $$;
create trigger after_write after insert or update or delete on public.staff_loans
  for each row execute function app.staff_loans_after();

create or replace function app.loan_repayments_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.staff_loans;
begin
  if tg_op = 'DELETE' then return old; end if;
  perform app.assert_account_postable(new.account_id);
  select * into l from public.staff_loans where id = new.loan_id;
  if l.status <> 'paid' then raise exception 'The loan has not been issued'; end if;
  if new.amount > app.loan_balance(l.id) + coalesce(case when tg_op = 'UPDATE' then old.amount end, 0) + 0.005 then
    raise exception 'The repayment is more than the loan balance';
  end if;
  return new;
end $$;
create trigger c_rules before insert or update or delete on public.staff_loan_repayments
  for each row execute function app.loan_repayments_before();

create or replace function app.loan_repayments_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.staff_loan_repayments := coalesce(new, old);
begin
  perform app.post('loan_repayment', r.id, case
    when tg_op <> 'DELETE' and new.method = 'cash' then
      jsonb_build_array(jsonb_build_object('date', new.repayment_date, 'account_id', new.account_id,
        'amount', new.amount, 'description', 'Staff loan repayment'))
    else '[]'::jsonb end);
  perform app.enter_system();
  update public.staff_loans set cleared_at = case when app.loan_balance(id) <= 0 then coalesce(cleared_at, r.repayment_date) end
   where id = r.loan_id;
  perform app.leave_system();
  return null;
end $$;
create trigger after_write after insert or update or delete on public.staff_loan_repayments
  for each row execute function app.loan_repayments_after();

-- Directors ------------------------------------------------------------------
create or replace function app.director_txn_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.director_transactions := coalesce(new, old);
  sign int;
begin
  -- In: company gets cash and owes the director. Out: company pays for the
  -- director personally, so the director owes the company.
  sign := case when t.type in ('loan_in', 'capital_introduced', 'other_in') then 1 else -1 end;
  perform app.post('director_txn', t.id, case when tg_op = 'DELETE' then '[]'::jsonb else
    jsonb_build_array(
      jsonb_build_object('date', new.txn_date, 'account_id', new.account_id, 'amount', sign * new.amount, 'description', replace(new.type, '_', ' ')),
      jsonb_build_object('date', new.txn_date, 'director_id', new.director_id, 'amount', sign * new.amount, 'description', replace(new.type, '_', ' ')))
  end);
  return null;
end $$;
create trigger after_write after insert or update or delete on public.director_transactions
  for each row execute function app.director_txn_after();

create or replace function app.director_payments_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d public.directors;
begin
  if tg_op = 'DELETE' then return old; end if;
  perform app.assert_account_postable(new.account_id);
  select * into d from public.directors where id = new.director_id;
  new.is_to_owner := d.is_owner;
  -- D-010: the Accountant always reviews payments to the Owner.
  if new.is_to_owner and (tg_op = 'INSERT' or old.review_status not in ('reviewed', 'queried')) then
    new.review_status := 'recorded';
  end if;
  if new.status = 'prepared' then
    if new.payment_type in ('fee_or_allowance', 'sitting_allowance') then
      new.category_id := coalesce(new.category_id,
        (select id from public.expense_categories where name = 'Directors'' fees and allowances'));
      new.tax_rate := coalesce(app.wht_rate_at('director_fee', 'default', coalesce(new.payment_date, app.today())), 0);
    elsif new.payment_type = 'dividend' then
      new.tax_rate := coalesce(app.wht_rate_at('dividend', 'default', coalesce(new.payment_date, app.today())), 0);
    else
      new.tax_rate := 0;
    end if;
    new.tax_amount := round(new.gross_amount * new.tax_rate, 2);
    new.net_amount := new.gross_amount - new.tax_amount;
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status = 'prepared'
     and new.payment_type = 'dividend' and new.board_resolution_path is null then
    raise exception 'Attach the board resolution before approving a dividend';
  end if;
  return new;
end $$;
create trigger c_rules before insert or update or delete on public.director_payments
  for each row execute function app.director_payments_rules();

create or replace function app.director_payments_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.director_payments := coalesce(new, old);
  entries jsonb := '[]';
begin
  if tg_op <> 'DELETE' and new.status = 'paid' then
    entries := jsonb_build_array(jsonb_build_object('date', new.payment_date, 'account_id', new.account_id,
      'amount', -new.net_amount, 'description', 'Payment to director: ' || replace(new.payment_type, '_', ' ')));
    if new.payment_type = 'loan_repayment' then
      entries := entries || jsonb_build_array(jsonb_build_object('date', new.payment_date,
        'director_id', new.director_id, 'amount', -new.gross_amount, 'description', 'Loan repaid'));
    end if;
  end if;
  perform app.post('director_payment', p.id, entries);
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status = 'prepared' and new.is_to_owner then
    perform app.flag_payment_to_owner('director_payments', new.id, format('/directors/%s', new.director_id),
      format('%s of GHS %s', replace(new.payment_type, '_', ' '), to_char(new.gross_amount, 'FM999,999,990.00')));
  end if;
  return null;
end $$;
create trigger after_write after insert or update or delete on public.director_payments
  for each row execute function app.director_payments_after();

-- =============================================================================
-- Admin-safe pickers (A-003): what Admin needs, without balances or totals.
-- =============================================================================

-- Open supplier bills with what is still owed on each (brief §4).
create view public.supplier_bills_open with (security_barrier) as
  select e.id, e.expense_date, e.supplier_id, s.name as supplier_name, e.description, e.amount,
         app.bill_outstanding(e.id) as outstanding
  from public.expenses e join public.suppliers s on s.id = e.supplier_id
  where app.has_role('owner', 'director', 'accountant', 'admin')
    and e.payment_source = 'supplier_payable' and e.entry_status = 'confirmed'
    and app.bill_outstanding(e.id) > 0;

-- Loans Admin can record repayments against: no balances.
create view public.staff_loan_picker with (security_barrier) as
  select l.id, st.full_name, l.monthly_instalment, l.payment_date as loan_date
  from public.staff_loans l join public.staff st on st.id = l.staff_id
  where app.has_role('owner', 'accountant', 'admin') and l.status = 'paid' and l.cleared_at is null;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.expenses enable row level security;
alter table public.expense_taxes enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.payments_out enable row level security;
alter table public.payment_out_items enable row level security;
alter table public.staff_payments enable row level security;
alter table public.transfers enable row level security;
alter table public.staff_loans enable row level security;
alter table public.staff_loan_repayments enable row level security;
alter table public.director_transactions enable row level security;
alter table public.director_payments enable row level security;

create or replace function app.can_read_expense(p_staff uuid, p_created_by uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('owner', 'director', 'accountant', 'admin')
      or (p_staff is not null and p_staff = app.my_staff_id())
      or p_created_by = auth.uid()
      or (p_staff is not null and app.has_role('project_lead') and app.can_approve_for(p_staff))
$$;

create policy expenses_read on public.expenses for select to authenticated
  using (app.can_read_expense(staff_id, created_by));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (app.has_role('owner', 'accountant', 'admin', 'project_lead', 'staff'));
create policy expenses_update on public.expenses for update to authenticated
  using (app.has_role('owner', 'accountant', 'admin')
         or (staff_id = app.my_staff_id())
         or (app.has_role('project_lead') and app.can_approve_for(staff_id)))
  with check (app.my_role() is not null and app.my_role() <> 'director');
create policy expenses_delete on public.expenses for delete to authenticated
  using (app.has_role('owner', 'accountant', 'admin') or staff_id = app.my_staff_id());

create policy expense_taxes_read on public.expense_taxes for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id));

create policy recurring_read on public.recurring_expenses for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin'));
create policy recurring_write on public.recurring_expenses for all to authenticated
  using (app.has_role('owner', 'accountant', 'admin')) with check (app.has_role('owner', 'accountant', 'admin'));

create policy payments_out_read on public.payments_out for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin'));
create policy payments_out_write on public.payments_out for all to authenticated
  using (app.has_role('owner', 'accountant', 'admin')) with check (app.has_role('owner', 'accountant', 'admin'));
create policy payment_items_read on public.payment_out_items for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin'));
create policy payment_items_write on public.payment_out_items for all to authenticated
  using (app.has_role('owner', 'accountant', 'admin')) with check (app.has_role('owner', 'accountant', 'admin'));

create policy staff_payments_read on public.staff_payments for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin') or staff_id = app.my_staff_id());
create policy staff_payments_write on public.staff_payments for all to authenticated
  using (app.has_role('owner', 'accountant', 'admin')) with check (app.has_role('owner', 'accountant', 'admin'));

-- Transfers: Admin records only, and sees only what they recorded (brief §5).
create policy transfers_read on public.transfers for select to authenticated
  using (app.is_finance() or (app.has_role('admin') and created_by = auth.uid()));
create policy transfers_insert on public.transfers for insert to authenticated
  with check (app.has_role('owner', 'accountant', 'admin'));
create policy transfers_update on public.transfers for update to authenticated
  using (app.has_role('owner', 'accountant') or (app.has_role('admin') and created_by = auth.uid()))
  with check (app.has_role('owner', 'accountant', 'admin'));
create policy transfers_delete on public.transfers for delete to authenticated
  using (app.has_role('owner', 'accountant'));

create policy staff_loans_read on public.staff_loans for select to authenticated
  using (app.is_finance());
create policy staff_loans_write on public.staff_loans for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));

create policy loan_repayments_read on public.staff_loan_repayments for select to authenticated
  using (app.is_finance() or (app.has_role('admin') and created_by = auth.uid()));
create policy loan_repayments_insert on public.staff_loan_repayments for insert to authenticated
  with check (app.has_role('owner', 'accountant', 'admin'));
create policy loan_repayments_update on public.staff_loan_repayments for update to authenticated
  using (app.has_role('owner', 'accountant') or (app.has_role('admin') and created_by = auth.uid()))
  with check (app.has_role('owner', 'accountant', 'admin'));

-- Directors' accounts and payments: finance-restricted; another director's
-- can be hidden from a Director (D-017).
create policy director_txn_read on public.director_transactions for select to authenticated
  using (app.is_finance() and (director_id = app.my_director_id() or app.area_visible('other_director_accounts')));
create policy director_txn_write on public.director_transactions for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));
create policy director_payments_read on public.director_payments for select to authenticated
  using (app.is_finance() and (director_id = app.my_director_id() or app.area_visible('other_director_accounts')));
create policy director_payments_write on public.director_payments for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));

-- =============================================================================
-- Review, approval flow, locks, touch, audit
-- =============================================================================
select app.enable_review(t) from unnest(array[
  'public.expenses', 'public.payments_out', 'public.staff_payments', 'public.transfers',
  'public.staff_loans', 'public.staff_loan_repayments', 'public.director_transactions',
  'public.director_payments']::regclass[]) t;

select app.enable_payout('public.payments_out', '/payments-out');
select app.enable_payout('public.staff_payments', '/staff-payments');
select app.enable_payout('public.staff_loans', '/staff-loans');
select app.enable_payout('public.director_payments', '/directors/payments');

select app.enable_month_lock('public.expenses', 'expense_date');
select app.enable_month_lock('public.payments_out', 'payment_date');
select app.enable_month_lock('public.staff_payments', 'payment_date');
select app.enable_month_lock('public.transfers', 'transfer_date');
select app.enable_month_lock('public.staff_loans', 'payment_date');
select app.enable_month_lock('public.staff_loan_repayments', 'repayment_date');
select app.enable_month_lock('public.director_transactions', 'txn_date');
select app.enable_month_lock('public.director_payments', 'payment_date');

create trigger touch before update on public.expenses for each row execute function app.touch();
create trigger touch before update on public.recurring_expenses for each row execute function app.touch();
create trigger touch before update on public.payments_out for each row execute function app.touch();
create trigger touch before update on public.staff_payments for each row execute function app.touch();
create trigger touch before update on public.transfers for each row execute function app.touch();
create trigger touch before update on public.staff_loans for each row execute function app.touch();
create trigger touch before update on public.staff_loan_repayments for each row execute function app.touch();
create trigger touch before update on public.director_transactions for each row execute function app.touch();
create trigger touch before update on public.director_payments for each row execute function app.touch();

select app.enable_audit(t) from unnest(array[
  'public.expenses', 'public.recurring_expenses', 'public.payments_out', 'public.payment_out_items',
  'public.staff_payments', 'public.transfers', 'public.staff_loans', 'public.staff_loan_repayments',
  'public.director_transactions', 'public.director_payments']::regclass[]) t;
