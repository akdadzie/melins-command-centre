-- =============================================================================
-- 0400 Ledger, shared money machinery, and money in (brief §7.4; A-002,
-- A-011; D-019..D-021).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ledger (A-002): the single source of every balance. Written only by source
-- triggers through app.post(); nobody writes it directly.
--   account_id set  -> money in (+) / out (-) of a MeLiNS account
--   director_id set -> director's current account: + company owes director,
--                                                  - director owes company
-- -----------------------------------------------------------------------------
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  entry_date date not null,
  account_id uuid references public.accounts (id),
  director_id uuid references public.directors (id),
  amount numeric(14,2) not null check (amount <> 0),
  source_type text not null,
  source_id uuid not null,
  description text,
  currency char(3) not null default 'GHS',
  fx_rate numeric(12,6) not null default 1,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  check ((account_id is null) <> (director_id is null))
);
create index ledger_account on public.ledger_entries (account_id, entry_date) where account_id is not null;
create index ledger_director on public.ledger_entries (director_id, entry_date) where director_id is not null;
create index ledger_source on public.ledger_entries (source_type, source_id);

-- Replaces all ledger rows of one source record. p_entries is a JSON array of
-- {date, account_id | director_id, amount, description}; empty = unposted.
create or replace function app.post(p_source_type text, p_source_id uuid, p_entries jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.ledger_entries where source_type = p_source_type and source_id = p_source_id;
  insert into public.ledger_entries (entry_date, account_id, director_id, amount, source_type, source_id, description)
  select (e ->> 'date')::date, (e ->> 'account_id')::uuid, (e ->> 'director_id')::uuid,
         (e ->> 'amount')::numeric, p_source_type, p_source_id, e ->> 'description'
  from jsonb_array_elements(coalesce(p_entries, '[]')) e
  where (e ->> 'amount')::numeric <> 0;
end $$;

create or replace function app.account_balance(p_account uuid, p_as_of date default null) returns numeric
language sql stable security definer set search_path = '' as $$
  select a.opening_balance + coalesce((
    select sum(l.amount) from public.ledger_entries l
    where l.account_id = a.id and l.entry_date >= a.opening_date
      and l.entry_date <= coalesce(p_as_of, app.today())), 0)
  from public.accounts a where a.id = p_account
$$;

create or replace function app.director_balance(p_director uuid, p_as_of date default null) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.amount), 0) from public.ledger_entries l
  where l.director_id = p_director and l.entry_date <= coalesce(p_as_of, app.today())
$$;

-- -----------------------------------------------------------------------------
-- Accountant review (brief §4, A-011). Tables that use it have columns
-- review_status, reviewed_by, reviewed_at, query_note, created_by.
--  * On insert: Recorded, unless the Accountant entered it (not required).
--  * Only the Accountant sets Reviewed / Queried; a query needs a note and
--    gives the creator a task.
--  * Any other change to a reviewed or queried entry sends it back to Recorded.
-- -----------------------------------------------------------------------------
create or replace function app.review_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  review_keys text[] := array['review_status', 'reviewed_by', 'reviewed_at', 'query_note', 'updated_at', 'updated_by'];
begin
  if app.in_system() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.review_status := case when app.my_role() = 'accountant' then 'not_required' else 'recorded' end;
    new.reviewed_by := null; new.reviewed_at := null; new.query_note := null;
    return new;
  end if;

  if (new.review_status, new.reviewed_by, new.query_note) is distinct from (old.review_status, old.reviewed_by, old.query_note) then
    if app.my_role() is distinct from 'accountant' then
      raise exception 'Only the Accountant reviews entries' using errcode = '42501';
    end if;
    if new.review_status = 'queried' and length(trim(coalesce(new.query_note, ''))) = 0 then
      raise exception 'Add a note saying what needs fixing';
    end if;
    if new.review_status in ('reviewed', 'queried') then
      new.reviewed_by := auth.uid(); new.reviewed_at := now();
    end if;
    if (to_jsonb(new) - review_keys) is distinct from (to_jsonb(old) - review_keys) then
      raise exception 'Review an entry without changing it';
    end if;
    return new;
  end if;

  -- Someone changed the entry itself: it needs reviewing again.
  if old.review_status in ('reviewed', 'queried') and app.my_role() is distinct from 'accountant' then
    new.review_status := 'recorded'; new.reviewed_by := null; new.reviewed_at := null;
  end if;
  return new;
end $$;

create or replace function app.review_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.review_status = 'queried' and old.review_status is distinct from 'queried' then
    insert into public.action_items (kind, title, link, assigned_to, assigned_role, record_type, record_id)
    values ('fix_queried_entry', 'The Accountant queried an entry: ' || coalesce(new.query_note, ''),
            format('/%s/%s', replace(tg_table_name, '_', '-'), new.id),
            new.created_by, case when new.created_by is null then 'admin'::public.app_role end,
            tg_table_name, new.id)
    on conflict (kind, record_id) where status = 'open' and record_id is not null do nothing;
  elsif old.review_status = 'queried' and new.review_status <> 'queried' then
    perform app.close_action('fix_queried_entry', new.id);
  end if;
  return null;
end $$;

create or replace function app.enable_review(p_table regclass) returns void
language plpgsql as $$
begin
  execute format('create trigger a_review before insert or update on %s for each row execute function app.review_before_write()', p_table);
  execute format('create trigger z_review_after after update on %s for each row execute function app.review_after_write()', p_table);
end $$;

-- -----------------------------------------------------------------------------
-- Money-out approval (brief §4): Prepared (Admin) -> Approved (Owner, the bank
-- signatory) -> Paid (date, account, reference). Tables that use it have
-- status payout_status, prepared_by, approved_by, approved_at, paid_by,
-- paid_at, payment_date, account_id.
-- After approval the amounts are frozen; after payment the record is locked.
-- -----------------------------------------------------------------------------
create or replace function app.payout_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pay_keys text[] := array['status', 'paid_by', 'paid_at', 'payment_date', 'account_id', 'method',
    'reference', 'attachment_path', 'notes', 'review_status', 'reviewed_by', 'reviewed_at',
    'query_note', 'updated_at', 'updated_by', 'approved_by', 'approved_at'];
  review_keys text[] := array['review_status', 'reviewed_by', 'reviewed_at', 'query_note',
    'attachment_path', 'notes', 'updated_at', 'updated_by'];
  role public.app_role := app.my_role();
begin
  if app.in_system() then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    if old.status <> 'prepared' then
      raise exception 'Only a prepared payment can be deleted; cancel it instead' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'prepared';
    new.prepared_by := auth.uid();
    new.approved_by := null; new.approved_at := null; new.paid_by := null; new.paid_at := null;
    return new;
  end if;

  if old.status = 'paid' then
    if (to_jsonb(new) - review_keys) is distinct from (to_jsonb(old) - review_keys) then
      raise exception 'A paid payment is locked. Record a correcting entry instead.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status = 'cancelled' then
    raise exception 'A cancelled payment cannot be changed' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'prepared' and new.status = 'approved' then
      if role is distinct from 'owner' then
        raise exception 'Only the Owner approves payments out' using errcode = '42501';
      end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    elsif old.status = 'approved' and new.status = 'paid' then
      if role not in ('owner', 'accountant', 'admin') then
        raise exception 'Not allowed to record this payment as paid' using errcode = '42501';
      end if;
      if new.account_id is null or new.payment_date is null then
        raise exception 'Record the date paid and the account it was paid from';
      end if;
      perform app.assert_account_postable(new.account_id);
      new.paid_by := auth.uid(); new.paid_at := now();
    elsif new.status = 'cancelled' then
      if not (role = 'owner' or (old.status = 'prepared' and old.prepared_by = auth.uid())) then
        raise exception 'Only the Owner can cancel this payment' using errcode = '42501';
      end if;
    elsif old.status = 'approved' and new.status = 'prepared' then
      -- Sent back for changes: the approval is withdrawn.
      if role not in ('owner', 'accountant', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
      new.approved_by := null; new.approved_at := null;
    else
      raise exception 'A payment cannot move from % to %', old.status, new.status;
    end if;
  end if;

  -- Once approved, only payment details may change (brief §7.5: can't exceed the approved amount).
  if old.status = 'approved' and new.status in ('approved', 'paid')
     and (to_jsonb(new) - pay_keys) is distinct from (to_jsonb(old) - pay_keys) then
    raise exception 'An approved payment''s amounts are fixed. Send it back to Prepared to change them.'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- Notifications and Admin tasks for the approval flow. TG_ARGV[0] = route.
create or replace function app.payout_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare link text := format('%s/%s', tg_argv[0], new.id);
begin
  if tg_op = 'INSERT' or (new.status = 'prepared' and old.status <> 'prepared') then
    perform app.notify_role('owner', 'approval_needed', 'A payment is waiting for your approval',
      link, tg_table_name, new.id, null, true);
  elsif new.status = 'approved' and old.status <> 'approved' then
    perform app.open_action('pay_approved', 'Approved payment ready to pay', link, 'admin', tg_table_name, new.id);
  elsif new.status in ('paid', 'cancelled') and old.status <> new.status then
    perform app.close_action('pay_approved', new.id);
  end if;
  return null;
end $$;

create or replace function app.enable_payout(p_table regclass, p_route text) returns void
language plpgsql as $$
begin
  execute format('create trigger b_payout before insert or update or delete on %s for each row execute function app.payout_before_write()', p_table);
  execute format('create trigger y_payout_after after insert or update on %s for each row execute function app.payout_after_write(%L)', p_table, p_route);
end $$;

-- Payments to the Owner (D-010): the Owner may approve them, but each one is
-- flagged, both Directors are notified, and the Accountant must review it.
create or replace function app.flag_payment_to_owner(p_table text, p_id uuid, p_link text, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.notify_role('director', 'payment_to_owner', 'Payment to the Owner approved: ' || p_what,
    p_link, p_table, p_id, null, true);
  perform app.notify_role('accountant', 'payment_to_owner', 'Review needed: payment to the Owner: ' || p_what,
    p_link, p_table, p_id, null, true);
end $$;

-- -----------------------------------------------------------------------------
-- Invoices (brief §7.4)
-- -----------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique,              -- allocated on approval (INV-YYYY-NNN)
  draft_ref text not null default 'DRAFT-' || substr(md5(gen_random_uuid()::text), 1, 4),
  job_id uuid not null references public.jobs (id),
  client_id uuid not null references public.clients (id),
  invoice_date date not null default app.today(),
  due_date date,
  status text not null default 'draft' check (status in
    ('draft', 'approved', 'sent', 'part_paid', 'paid', 'disputed', 'written_off')),
  ready_for_approval boolean not null default false,

  -- Snapshots taken from the job / client / settings (so later changes don't alter it)
  retention_pct numeric(5,2) not null default 0,
  retention_basis text not null default 'net' check (retention_basis in ('net', 'gross')),
  wht_rate numeric(6,4) not null default 0,
  wht_base text not null default 'net' check (wht_base in ('net', 'gross')),
  client_is_vat_agent boolean not null default false,

  -- Totals, maintained by app.refresh_invoice()
  net_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  gross_total numeric(14,2) not null default 0,
  retention_amount numeric(14,2) not null default 0,
  expected_wht numeric(14,2) not null default 0,
  expected_vat_withheld numeric(14,2) not null default 0,
  expected_net_receipt numeric(14,2) not null default 0,
  credited_total numeric(14,2) not null default 0,
  settled_total numeric(14,2) not null default 0,          -- cash + WHT + VAT withheld, reported or confirmed
  confirmed_settled_total numeric(14,2) not null default 0,
  outstanding numeric(14,2) not null default 0,

  approved_by uuid references public.profiles (user_id),
  approved_at timestamptz,
  sent_at timestamptz,
  sent_by uuid references public.profiles (user_id),
  gra_einvoice_ref text,
  dispute_reason text,
  dispute_date date,
  dispute_next_step text,
  written_off_at timestamptz,
  written_off_by uuid references public.profiles (user_id),
  write_off_reason text,
  write_off_amount numeric(14,2),
  notes text,
  is_imported boolean not null default false,               -- opening receivable (D-021)
  currency char(3) not null default 'GHS',
  fx_rate numeric(12,6) not null default 1,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or invoice_number is not null)
);
create index invoices_job on public.invoices (job_id);
create index invoices_client_status on public.invoices (client_id, status);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  seq int not null default 1,
  line_type text not null default 'fee' check (line_type in
    ('fee', 'milestone', 'rechargeable_expense', 'retention_release', 'other')),
  description text not null,
  billing_milestone_id uuid unique references public.billing_milestones (id),
  expense_id uuid unique,                                   -- FK added in 0500; unique = never recharged twice
  tax_code_id uuid references public.tax_codes (id),
  net_amount numeric(14,2) not null,
  tax_amount numeric(14,2) not null default 0,
  gross_amount numeric(14,2) not null default 0,
  vat_withholding_rate numeric(6,4) not null default 0,     -- snapshot from the tax code version
  created_at timestamptz not null default now(),
  check ((line_type = 'milestone') = (billing_milestone_id is not null)),
  check ((line_type = 'rechargeable_expense') = (expense_id is not null)),
  check (line_type <> 'retention_release' or tax_code_id is null)
);
create index invoice_lines_invoice on public.invoice_lines (invoice_id, seq);

create table public.invoice_line_taxes (
  line_id uuid not null references public.invoice_lines (id) on delete cascade,
  seq int not null,
  name text not null,
  rate numeric(7,5) not null,
  basis text not null,
  is_vat boolean not null,
  base numeric(14,2) not null,
  amount numeric(14,2) not null,
  primary key (line_id, seq)
);

-- -----------------------------------------------------------------------------
-- Credit notes (brief §7.4). VAT is reversed at the rates on the invoice date.
-- -----------------------------------------------------------------------------
create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  cn_number text unique,
  draft_ref text not null default 'DRAFT-' || substr(md5(gen_random_uuid()::text), 1, 4),
  invoice_id uuid not null references public.invoices (id),
  cn_date date not null default app.today(),
  reason text not null,
  tax_code_id uuid references public.tax_codes (id),
  net_amount numeric(14,2) not null check (net_amount > 0),
  tax_amount numeric(14,2) not null default 0,
  gross_amount numeric(14,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by uuid references public.profiles (user_id),
  approved_at timestamptz,
  currency char(3) not null default 'GHS',
  fx_rate numeric(12,6) not null default 1,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or cn_number is not null)
);

create table public.credit_note_taxes (
  credit_note_id uuid not null references public.credit_notes (id) on delete cascade,
  seq int not null,
  name text not null,
  rate numeric(7,5) not null,
  is_vat boolean not null,
  recoverable boolean not null,
  amount numeric(14,2) not null,
  primary key (credit_note_id, seq)
);

-- -----------------------------------------------------------------------------
-- Payments received (brief §7.4). Reported -> Confirmed (Accountant). Only
-- confirmed payments count as cash.
-- -----------------------------------------------------------------------------
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  receipt_date date not null,
  cash_amount numeric(14,2) not null default 0 check (cash_amount >= 0),
  wht_amount numeric(14,2) not null default 0 check (wht_amount >= 0),
  vat_withheld_amount numeric(14,2) not null default 0 check (vat_withheld_amount >= 0),
  account_id uuid references public.accounts (id),                -- where the cash went
  received_by_director_id uuid references public.directors (id),  -- ... or which director holds it
  method text check (method in ('bank_transfer', 'cheque', 'cash', 'mobile_money', 'other')),
  reference text,
  source text not null check (source in
    ('office_cash_cheque', 'remittance_advice', 'reported_by_owner', 'found_on_statement', 'received_by_director')),
  status text not null default 'reported' check (status in ('reported', 'confirmed', 'rejected')),
  confirmed_by uuid references public.profiles (user_id),
  confirmed_at timestamptz,
  rejection_reason text,
  attachment_path text,
  notes text,
  currency char(3) not null default 'GHS',
  fx_rate numeric(12,6) not null default 1,
  company_id uuid not null default app.default_company() references public.companies (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (cash_amount + wht_amount + vat_withheld_amount > 0),
  check ((source = 'received_by_director') = (received_by_director_id is not null)),
  check (received_by_director_id is null or account_id is null)
);
create index receipts_status on public.receipts (status, receipt_date);

create table public.receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id),
  cash_amount numeric(14,2) not null default 0 check (cash_amount >= 0),
  wht_amount numeric(14,2) not null default 0 check (wht_amount >= 0),
  vat_withheld_amount numeric(14,2) not null default 0 check (vat_withheld_amount >= 0),
  unique (receipt_id, invoice_id)
);
create index receipt_allocations_invoice on public.receipt_allocations (invoice_id);

-- WHT credit certificates (brief §7.4). Expected -> Received -> Claimed.
create table public.wht_certificates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  amount numeric(14,2) not null check (amount >= 0),
  certificate_number text,
  expected_by date,
  date_received date,
  status text not null default 'expected' check (status in ('expected', 'received', 'claimed', 'cancelled')),
  scan_path text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (status not in ('received', 'claimed') or date_received is not null)
);

create table public.wht_certificate_receipts (
  certificate_id uuid not null references public.wht_certificates (id) on delete cascade,
  receipt_id uuid not null unique references public.receipts (id),
  primary key (certificate_id, receipt_id)
);

-- -----------------------------------------------------------------------------
-- Invoice logic
-- -----------------------------------------------------------------------------

-- Retention a job still holds (deducted on invoices less released).
create or replace function app.job_retention_held(p_job uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(i.retention_amount) from public.invoices i
                   where i.job_id = p_job and i.status <> 'draft'), 0)
       - coalesce((select sum(l.net_amount) from public.invoice_lines l
                   join public.invoices i on i.id = l.invoice_id
                   where i.job_id = p_job and l.line_type = 'retention_release' and i.status <> 'draft'), 0)
$$;

-- Recomputes an invoice's totals and payment status from its lines, credit
-- notes and allocations.
create or replace function app.refresh_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
  v_net numeric; v_tax numeric; v_gross numeric; v_ret_base numeric; v_vat numeric;
  v_ret numeric; v_wht numeric; v_vatw numeric; v_cred numeric; v_set numeric; v_conf numeric;
  v_due numeric; v_status text;
begin
  select * into i from public.invoices where id = p_invoice for update;
  if not found then return; end if;

  if i.is_imported and not exists (select 1 from public.invoice_lines where invoice_id = i.id) then
    v_net := i.net_total; v_tax := i.tax_total; v_gross := i.gross_total;
    v_ret := i.retention_amount; v_wht := i.expected_wht; v_vatw := i.expected_vat_withheld;
  else
    select coalesce(sum(net_amount), 0), coalesce(sum(tax_amount), 0), coalesce(sum(gross_amount), 0),
           coalesce(sum(case when i.retention_basis = 'net' then net_amount else gross_amount end)
                    filter (where line_type in ('fee', 'milestone', 'other')), 0)
      into v_net, v_tax, v_gross, v_ret_base
      from public.invoice_lines where invoice_id = i.id;
    select coalesce(sum(t.amount * l.vat_withholding_rate), 0) into v_vat
      from public.invoice_line_taxes t join public.invoice_lines l on l.id = t.line_id
     where l.invoice_id = i.id and t.is_vat;
    v_ret := round(v_ret_base * i.retention_pct / 100, 2);
    v_wht := round(case when i.wht_base = 'net' then v_net else v_gross end * i.wht_rate, 2);
    v_vatw := case when i.client_is_vat_agent then round(v_vat, 2) else 0 end;
  end if;

  select coalesce(sum(gross_amount), 0) into v_cred
    from public.credit_notes where invoice_id = i.id and status = 'approved';
  select coalesce(sum(a.cash_amount + a.wht_amount + a.vat_withheld_amount), 0),
         coalesce(sum(a.cash_amount + a.wht_amount + a.vat_withheld_amount) filter (where r.status = 'confirmed'), 0)
    into v_set, v_conf
    from public.receipt_allocations a join public.receipts r on r.id = a.receipt_id
   where a.invoice_id = i.id and r.status in ('reported', 'confirmed');

  -- Fully settled when total settled = gross less retention (and credit notes).
  v_due := v_gross - v_ret - v_cred;
  v_status := i.status;
  if i.status in ('approved', 'sent', 'part_paid', 'paid', 'disputed') then
    if v_set >= v_due - 0.005 and v_due >= 0 and (v_set > 0 or v_cred > 0) then
      v_status := 'paid';
    elsif i.status = 'disputed' then
      v_status := 'disputed';
    elsif v_set > 0 then
      v_status := 'part_paid';
    else
      v_status := case when i.sent_at is not null then 'sent' else 'approved' end;
    end if;
  end if;

  perform app.enter_system();
  update public.invoices set
    net_total = v_net, tax_total = v_tax, gross_total = v_gross, retention_amount = v_ret,
    expected_wht = v_wht, expected_vat_withheld = v_vatw,
    expected_net_receipt = v_gross - v_ret - v_wht - v_vatw,
    credited_total = v_cred, settled_total = v_set, confirmed_settled_total = v_conf,
    outstanding = case when i.status = 'written_off' then 0 else greatest(v_due - v_set, 0) end,
    status = v_status
  where id = i.id;

  -- Milestones follow their invoice.
  update public.billing_milestones m set status = case when v_status = 'paid' then 'paid' else 'invoiced' end
   where m.id in (select billing_milestone_id from public.invoice_lines where invoice_id = i.id and billing_milestone_id is not null)
     and v_status <> 'draft'
     and m.status is distinct from case when v_status = 'paid' then 'paid' else 'invoiced' end;
  perform app.leave_system();
end $$;

create or replace function app.invoices_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  c public.clients;
  s public.settings_versions;
  role public.app_role := app.my_role();
  n int; y int;
  free_keys text[] := array['status', 'sent_at', 'sent_by', 'gra_einvoice_ref', 'dispute_reason', 'dispute_date',
    'dispute_next_step', 'written_off_at', 'written_off_by', 'write_off_reason', 'write_off_amount', 'notes',
    'updated_at', 'updated_by', 'approved_by', 'approved_at', 'invoice_number', 'ready_for_approval'];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and not app.in_system() then
      raise exception 'Only a draft invoice can be deleted. Use a credit note instead.' using errcode = '42501';
    end if;
    return old;
  end if;

  if app.in_system() then return new; end if;

  if tg_op = 'INSERT' then
    select * into j from public.jobs where id = new.job_id;
    new.client_id := coalesce(new.client_id, j.client_id);
    if new.client_id <> j.client_id then raise exception 'The invoice client must be the job''s client'; end if;
    if role = 'project_lead' and not app.on_my_job(new.job_id) then
      raise exception 'You can only draft invoices for your own jobs' using errcode = '42501';
    end if;
    select * into c from public.clients where id = new.client_id;
    s := app.settings_at(new.invoice_date);
    new.retention_pct := j.retention_pct;
    new.retention_basis := j.retention_basis;
    new.wht_rate := case when c.deducts_wht then coalesce(app.wht_rate_at('client', c.wht_category, new.invoice_date), 0) else 0 end;
    new.wht_base := s.client_wht_base;
    new.client_is_vat_agent := c.is_vat_withholding_agent;
    new.due_date := coalesce(new.due_date, new.invoice_date + coalesce(c.payment_terms_days, s.invoice_terms_days));
    new.created_by := auth.uid();

    if new.is_imported then
      -- Opening receivable: keeps its number and status (D-021).
      if new.invoice_number is null or new.status = 'draft' then
        raise exception 'An imported invoice needs its existing number and status';
      end if;
      select p.year, p.seq into y, n from app.parse_number(new.invoice_number) p;
      perform app.bump_number('INV', y, n);
    else
      new.status := 'draft'; new.invoice_number := null;
      new.approved_by := null; new.approved_at := null; new.sent_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status <> 'draft' and (to_jsonb(new) - free_keys) is distinct from (to_jsonb(old) - free_keys) then
    raise exception 'Invoice % is issued and locked. Use a credit note to correct it.', old.invoice_number
      using errcode = '42501';
  end if;
  if new.invoice_number is distinct from old.invoice_number and old.invoice_number is not null then
    raise exception 'An invoice number cannot be changed';
  end if;

  if old.status = 'draft' and new.invoice_date is distinct from old.invoice_date then
    -- Rates and terms follow the invoice date (brief §7.4).
    select * into c from public.clients where id = new.client_id;
    new.wht_rate := case when c.deducts_wht then coalesce(app.wht_rate_at('client', c.wht_category, new.invoice_date), 0) else 0 end;
    new.wht_base := (app.settings_at(new.invoice_date)).client_wht_base;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'approved' then
      if not (role = 'owner'
              or (role = 'accountant' and (app.settings_at(app.today())).accountant_may_approve_invoices)) then
        raise exception 'Only the Owner approves invoices for sending' using errcode = '42501';
      end if;
      if app.is_month_closed(new.invoice_date) then
        raise exception 'The invoice date falls in a closed month';
      end if;
      if not exists (select 1 from public.invoice_lines where invoice_id = new.id) then
        raise exception 'An invoice needs at least one line';
      end if;
      y := extract(year from new.invoice_date)::int;
      n := app.next_number('INV', y);
      new.invoice_number := format('INV-%s-%s', y, lpad(n::text, 3, '0'));
      new.approved_by := auth.uid(); new.approved_at := now();
      new.ready_for_approval := false;
    elsif old.status = 'approved' and new.status = 'sent' then
      if role not in ('owner', 'accountant', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
      new.sent_at := now(); new.sent_by := auth.uid();
    elsif new.status = 'disputed' and old.status in ('approved', 'sent', 'part_paid') then
      if role not in ('owner', 'accountant', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
      if length(trim(coalesce(new.dispute_reason, ''))) = 0 then raise exception 'Give the reason for the dispute'; end if;
      new.dispute_date := coalesce(new.dispute_date, app.today());
    elsif old.status = 'disputed' and new.status in ('sent', 'part_paid', 'approved') then
      if role not in ('owner', 'accountant', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
      new.status := 'sent';   -- refresh_invoice settles the exact status
    elsif new.status = 'written_off' and old.status in ('approved', 'sent', 'part_paid', 'disputed') then
      if role is distinct from 'owner' then
        raise exception 'Only the Owner can write off an invoice' using errcode = '42501';
      end if;
      if length(trim(coalesce(new.write_off_reason, ''))) = 0 then raise exception 'Give the reason for the write-off'; end if;
      new.written_off_at := now(); new.written_off_by := auth.uid(); new.write_off_amount := old.outstanding;
    else
      raise exception 'An invoice cannot move from % to %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;
create trigger before_write before insert or update or delete on public.invoices
  for each row execute function app.invoices_before_write();

create or replace function app.invoices_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare link text;
begin
  link := format('/invoices/%s', coalesce(new.invoice_number, new.draft_ref));
  if tg_op = 'UPDATE' and new.status = 'draft' and new.invoice_date is distinct from old.invoice_date then
    -- Recompute every line at the rates in force on the new date.
    update public.invoice_lines set net_amount = net_amount where invoice_id = new.id;
  end if;
  if tg_op = 'UPDATE' and new.status = 'draft' and new.ready_for_approval and not old.ready_for_approval then
    perform app.notify_role('owner', 'approval_needed', 'Invoice draft ready for approval', link, 'invoice', new.id, null, true);
    if (app.settings_at(app.today())).accountant_may_approve_invoices then
      perform app.notify_role('accountant', 'approval_needed', 'Invoice draft ready for approval', link, 'invoice', new.id, null, true);
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status = 'draft' then
    perform app.refresh_invoice(new.id);
    perform app.open_action('send_invoice', format('Send invoice %s to the client', new.invoice_number),
      link, 'admin', 'invoice', new.id);
  end if;
  if tg_op = 'UPDATE' and new.status <> 'approved' and old.status = 'approved' then
    perform app.close_action('send_invoice', new.id);
  end if;
  if tg_op = 'INSERT' and new.is_imported then
    perform app.refresh_invoice(new.id);
  end if;
  if tg_op = 'UPDATE' and new.status = 'written_off' and old.status <> 'written_off' then
    perform app.refresh_invoice(new.id);
  end if;
  return null;
end $$;
create trigger after_write after insert or update on public.invoices
  for each row execute function app.invoices_after_write();

create or replace function app.invoice_lines_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
  m public.billing_milestones;
  v uuid;
  tx record;
begin
  select * into i from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if i.status <> 'draft' and not app.in_system() then
    raise exception 'Invoice % is issued and locked', i.invoice_number using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if new.line_type = 'milestone' then
    select * into m from public.billing_milestones where id = new.billing_milestone_id;
    if m.job_id <> i.job_id then raise exception 'That milestone belongs to another job'; end if;
    if m.status not in ('pending', 'reached') then raise exception 'That milestone is already invoiced'; end if;
    new.net_amount := coalesce(new.net_amount, m.amount);
  elsif new.line_type = 'retention_release' then
    if new.net_amount > app.job_retention_held(i.job_id) + 0.005 then
      raise exception 'The release is more than the retention held on this job';
    end if;
  end if;

  -- Taxes at the rates in force on the invoice date (brief §7.4, acceptance 7).
  new.tax_amount := 0; new.vat_withholding_rate := 0;
  if new.tax_code_id is not null then
    for tx in select * from app.compute_taxes(new.tax_code_id, i.invoice_date, new.net_amount) loop
      new.tax_amount := new.tax_amount + tx.amount;
    end loop;
    v := app.tax_version_at(new.tax_code_id, i.invoice_date);
    new.vat_withholding_rate := (select vat_withholding_rate from public.tax_code_versions where id = v);
  end if;
  new.gross_amount := new.net_amount + new.tax_amount;
  return new;
end $$;
create trigger before_write before insert or update or delete on public.invoice_lines
  for each row execute function app.invoice_lines_before_write();

create or replace function app.invoice_lines_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i public.invoices;
begin
  if tg_op <> 'DELETE' then
    select * into i from public.invoices where id = new.invoice_id;
    delete from public.invoice_line_taxes where line_id = new.id;
    if new.tax_code_id is not null then
      insert into public.invoice_line_taxes (line_id, seq, name, rate, basis, is_vat, base, amount)
      select new.id, t.seq, t.name, t.rate, t.basis, t.is_vat, t.base, t.amount
      from app.compute_taxes(new.tax_code_id, i.invoice_date, new.net_amount) t;
    end if;
  end if;
  perform app.refresh_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;
create trigger after_write after insert or update or delete on public.invoice_lines
  for each row execute function app.invoice_lines_after_write();

-- -----------------------------------------------------------------------------
-- Credit note logic: Owner approves; number CN-YYYY-NNN on approval.
-- -----------------------------------------------------------------------------
create or replace function app.credit_notes_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  i public.invoices;
  tx record;
  n int; y int;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'An approved credit note cannot be deleted' using errcode = '42501'; end if;
    return old;
  end if;
  select * into i from public.invoices where id = new.invoice_id;
  if i.status in ('draft', 'written_off') then
    raise exception 'A credit note needs an issued, open invoice';
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then
    raise exception 'An approved credit note is locked' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.cn_number := null; new.created_by := auth.uid();
  end if;

  -- Reverse tax at the rates that applied on the invoice date.
  new.tax_amount := 0;
  if new.tax_code_id is not null then
    for tx in select * from app.compute_taxes(new.tax_code_id, i.invoice_date, new.net_amount) loop
      new.tax_amount := new.tax_amount + tx.amount;
    end loop;
  end if;
  new.gross_amount := new.net_amount + new.tax_amount;

  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'approved' then
    if app.my_role() is distinct from 'owner' then
      raise exception 'Only the Owner approves credit notes' using errcode = '42501';
    end if;
    if new.gross_amount > i.outstanding + 0.005 then
      raise exception 'The credit note is more than the amount outstanding on %', i.invoice_number;
    end if;
    if app.is_month_closed(new.cn_date) then raise exception 'The credit note date falls in a closed month'; end if;
    y := extract(year from new.cn_date)::int;
    n := app.next_number('CN', y);
    new.cn_number := format('CN-%s-%s', y, lpad(n::text, 3, '0'));
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  return new;
end $$;
create trigger before_write before insert or update or delete on public.credit_notes
  for each row execute function app.credit_notes_before_write();

create or replace function app.credit_notes_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i public.invoices;
begin
  select * into i from public.invoices where id = new.invoice_id;
  delete from public.credit_note_taxes where credit_note_id = new.id;
  if new.tax_code_id is not null then
    insert into public.credit_note_taxes (credit_note_id, seq, name, rate, is_vat, recoverable, amount)
    select new.id, t.seq, t.name, t.rate, t.is_vat, t.recoverable, t.amount
    from app.compute_taxes(new.tax_code_id, i.invoice_date, new.net_amount) t;
  end if;
  if new.status = 'approved' then
    perform app.refresh_invoice(new.invoice_id);
  elsif tg_op = 'INSERT' then
    perform app.notify_role('owner', 'approval_needed', 'Credit note waiting for your approval',
      '/invoices/adjustments', 'credit_note', new.id, null, true);
  end if;
  return null;
end $$;
create trigger after_write after insert or update on public.credit_notes
  for each row execute function app.credit_notes_after_write();

-- -----------------------------------------------------------------------------
-- Receipt logic
-- -----------------------------------------------------------------------------
create or replace function app.receipts_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  role public.app_role := app.my_role();
  alloc record;
  locked_keys text[] := array['attachment_path', 'notes', 'updated_at', 'updated_by'];
begin
  if tg_op = 'DELETE' then
    if old.status = 'confirmed' then raise exception 'A confirmed payment cannot be deleted' using errcode = '42501'; end if;
    if role not in ('owner', 'accountant') and old.created_by is distinct from auth.uid() then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    return old;
  end if;
  if app.in_system() then return new; end if;

  perform app.assert_account_postable(new.account_id);

  if tg_op = 'INSERT' then
    new.status := 'reported'; new.confirmed_by := null; new.confirmed_at := null;
    new.created_by := auth.uid();
    if role = 'owner' and new.source is null then new.source := 'reported_by_owner'; end if;
    return new;
  end if;

  if old.status in ('confirmed', 'rejected')
     and (to_jsonb(new) - locked_keys) is distinct from (to_jsonb(old) - locked_keys) then
    raise exception 'This payment is % and locked', old.status using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'reported' and new.status = 'confirmed' then
      if role is distinct from 'accountant' then
        raise exception 'Only the Accountant confirms payments, against the statement' using errcode = '42501';
      end if;
      if new.account_id is null and new.received_by_director_id is null then
        raise exception 'Record which account the money went into';
      end if;
      if new.method is null then raise exception 'Record how the client paid'; end if;
      select coalesce(sum(cash_amount), 0) c, coalesce(sum(wht_amount), 0) w, coalesce(sum(vat_withheld_amount), 0) v
        into alloc from public.receipt_allocations where receipt_id = new.id;
      if abs(alloc.c - new.cash_amount) > 0.005 or abs(alloc.w - new.wht_amount) > 0.005
         or abs(alloc.v - new.vat_withheld_amount) > 0.005 then
        raise exception 'Allocate the whole payment to invoices before confirming it';
      end if;
      new.confirmed_by := auth.uid(); new.confirmed_at := now();
    elsif old.status = 'reported' and new.status = 'rejected' then
      if role not in ('owner', 'accountant') then raise exception 'Not allowed' using errcode = '42501'; end if;
      if length(trim(coalesce(new.rejection_reason, ''))) = 0 then raise exception 'Say why the payment is rejected'; end if;
    else
      raise exception 'A payment cannot move from % to %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;
create trigger before_write before insert or update or delete on public.receipts
  for each row execute function app.receipts_before_write();

-- Logging rule (brief §7.4): a Reported payment missing its details is a task for Admin.
create or replace function app.receipt_details_task(p_receipt uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.receipts;
  cname text;
begin
  select * into r from public.receipts where id = p_receipt;
  if r.status = 'reported' and (r.method is null
      or (r.account_id is null and r.received_by_director_id is null)
      or not exists (select 1 from public.receipt_allocations where receipt_id = r.id)) then
    select name into cname from public.clients where id = r.client_id;
    perform app.open_action('complete_reported_payment',
      format('Complete the details of a payment reported from %s', cname),
      format('/receipts?id=%s', r.id), 'admin', 'receipt', r.id);
  else
    perform app.close_action('complete_reported_payment', r.id);
  end if;
end $$;

create or replace function app.receipts_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.receipts := coalesce(new, old);
  inv uuid;
  cert uuid;
begin
  -- Ledger: only confirmed payments count as cash (brief §7.4). Money a
  -- director received personally goes to that director's current account.
  perform app.post('receipt', r.id, case
    when tg_op <> 'DELETE' and new.status = 'confirmed' and new.received_by_director_id is not null then
      jsonb_build_array(jsonb_build_object('date', new.receipt_date, 'director_id', new.received_by_director_id,
        'amount', -new.cash_amount, 'description', 'Client payment received personally'))
    when tg_op <> 'DELETE' and new.status = 'confirmed' then
      jsonb_build_array(jsonb_build_object('date', new.receipt_date, 'account_id', new.account_id,
        'amount', new.cash_amount, 'description', 'Client payment'))
    else '[]'::jsonb end);

  for inv in select invoice_id from public.receipt_allocations where receipt_id = r.id loop
    perform app.refresh_invoice(inv);
  end loop;

  if tg_op = 'DELETE' then return null; end if;

  -- An Expected WHT certificate for every payment with WHT (brief §7.4).
  if new.wht_amount > 0 and new.status <> 'rejected'
     and not exists (select 1 from public.wht_certificate_receipts where receipt_id = new.id) then
    insert into public.wht_certificates (client_id, amount, expected_by, created_by)
    values (new.client_id, new.wht_amount,
            new.receipt_date + (app.settings_at(new.receipt_date)).wht_certificate_flag_days, null)
    returning id into cert;
    insert into public.wht_certificate_receipts (certificate_id, receipt_id) values (cert, new.id);
  elsif new.status = 'rejected' then
    update public.wht_certificates c set status = 'cancelled'
     where c.status = 'expected' and c.id in (select certificate_id from public.wht_certificate_receipts where receipt_id = new.id);
  end if;

  perform app.receipt_details_task(new.id);
  if new.status <> 'reported' then
    perform app.close_action('record_receipt', new.id);
  end if;
  return null;
end $$;
create trigger after_write after insert or update or delete on public.receipts
  for each row execute function app.receipts_after_write();

create or replace function app.allocations_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.receipts;
  i public.invoices;
  tot record;
begin
  select * into r from public.receipts where id = coalesce(new.receipt_id, old.receipt_id);
  if r.status <> 'reported' and not app.in_system() then
    raise exception 'The payment is % and its allocations are locked', r.status using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select * into i from public.invoices where id = new.invoice_id;
  if i.client_id <> r.client_id then raise exception 'That invoice belongs to another client'; end if;
  if i.status in ('draft', 'written_off') then raise exception 'That invoice is not open for payment'; end if;
  select coalesce(sum(cash_amount), 0) + new.cash_amount c, coalesce(sum(wht_amount), 0) + new.wht_amount w,
         coalesce(sum(vat_withheld_amount), 0) + new.vat_withheld_amount v
    into tot from public.receipt_allocations where receipt_id = r.id and id <> new.id;
  if tot.c > r.cash_amount + 0.005 or tot.w > r.wht_amount + 0.005 or tot.v > r.vat_withheld_amount + 0.005 then
    raise exception 'The allocations add up to more than the payment';
  end if;
  -- Can't settle more than the invoice still has due.
  if new.cash_amount + new.wht_amount + new.vat_withheld_amount
     > i.outstanding + coalesce(case when tg_op = 'UPDATE' and old.invoice_id = new.invoice_id
                                     then old.cash_amount + old.wht_amount + old.vat_withheld_amount end, 0) + 0.005 then
    raise exception 'That is more than invoice % still has due (GHS %)', i.invoice_number, i.outstanding;
  end if;
  return new;
end $$;
create trigger before_write before insert or update or delete on public.receipt_allocations
  for each row execute function app.allocations_before_write();

create or replace function app.allocations_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.refresh_invoice(coalesce(new.invoice_id, old.invoice_id));
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    perform app.refresh_invoice(old.invoice_id);
  end if;
  perform app.receipt_details_task(coalesce(new.receipt_id, old.receipt_id));
  return null;
end $$;
create trigger after_write after insert or update or delete on public.receipt_allocations
  for each row execute function app.allocations_after_write();

-- The Owner's "+ Payment received" quick-log (brief §7.4): client or invoice,
-- amount, date. Saved as Reported with a task for Admin to complete.
create or replace function public.quick_log_payment(
  p_amount numeric, p_date date default null, p_invoice_id uuid default null, p_client_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_client uuid := p_client_id;
  v_id uuid;
begin
  if p_invoice_id is not null then
    select client_id into v_client from public.invoices where id = p_invoice_id;
  end if;
  if v_client is null then raise exception 'Choose a client or an invoice'; end if;
  insert into public.receipts (client_id, receipt_date, cash_amount, source)
  values (v_client, coalesce(p_date, app.today()), p_amount, 'reported_by_owner')
  returning id into v_id;
  if p_invoice_id is not null then
    insert into public.receipt_allocations (receipt_id, invoice_id, cash_amount) values (v_id, p_invoice_id, p_amount);
  end if;
  return v_id;
end $$;

-- WHT certificates: keep the dates consistent.
create or replace function app.wht_cert_before_write() returns trigger
language plpgsql as $$
begin
  if new.status = 'received' and new.date_received is null then new.date_received := app.today(); end if;
  return new;
end $$;
create trigger before_write before insert or update on public.wht_certificates
  for each row execute function app.wht_cert_before_write();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.ledger_entries enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_line_taxes enable row level security;
alter table public.credit_notes enable row level security;
alter table public.credit_note_taxes enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_allocations enable row level security;
alter table public.wht_certificates enable row level security;
alter table public.wht_certificate_receipts enable row level security;

-- Ledger: finance only; a Director's own current account is always visible,
-- other directors' accounts can be hidden (D-017). No write policies.
create policy ledger_read on public.ledger_entries for select to authenticated
  using (app.is_finance()
         and (director_id is null or director_id = app.my_director_id()
              or app.area_visible('other_director_accounts')));

-- Invoices: Admin sees every invoice with its outstanding amount (to chase)
-- but no balances or totals across invoices; the Project lead sees drafts for
-- their own jobs (brief §5).
create or replace function app.can_read_invoice(p_invoice uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('owner', 'director', 'accountant', 'admin')
      or (app.has_role('project_lead') and exists (
            select 1 from public.invoices i where i.id = p_invoice and i.status = 'draft' and app.on_my_job(i.job_id)))
$$;
create or replace function app.can_edit_invoice(p_invoice uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role('owner', 'accountant', 'admin')
      or (app.has_role('project_lead') and exists (
            select 1 from public.invoices i where i.id = p_invoice and i.status = 'draft' and app.on_my_job(i.job_id)))
$$;

create policy invoices_read on public.invoices for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin')
         or (app.has_role('project_lead') and status = 'draft' and app.on_my_job(job_id)));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (app.has_role('owner', 'accountant', 'admin', 'project_lead'));
create policy invoices_update on public.invoices for update to authenticated
  using (app.can_edit_invoice(id)) with check (app.my_role() is not null and app.my_role() <> 'director');
create policy invoices_delete on public.invoices for delete to authenticated
  using (app.can_edit_invoice(id));

create policy invoice_lines_read on public.invoice_lines for select to authenticated
  using (app.can_read_invoice(invoice_id));
create policy invoice_lines_write on public.invoice_lines for all to authenticated
  using (app.can_edit_invoice(invoice_id)) with check (app.can_edit_invoice(invoice_id));
create policy invoice_line_taxes_read on public.invoice_line_taxes for select to authenticated
  using (app.can_read_invoice((select invoice_id from public.invoice_lines l where l.id = line_id)));

create policy credit_notes_read on public.credit_notes for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin'));
create policy credit_notes_write on public.credit_notes for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));
create policy credit_note_taxes_read on public.credit_note_taxes for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin'));

-- Receipts: Owner (quick-log), Accountant and Admin record them.
create policy receipts_read on public.receipts for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin'));
create policy receipts_insert on public.receipts for insert to authenticated
  with check (app.has_role('owner', 'accountant', 'admin'));
create policy receipts_update on public.receipts for update to authenticated
  using (app.has_role('owner', 'accountant', 'admin')) with check (app.has_role('owner', 'accountant', 'admin'));
create policy receipts_delete on public.receipts for delete to authenticated
  using (app.has_role('owner', 'accountant', 'admin'));

create policy allocations_read on public.receipt_allocations for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin'));
create policy allocations_write on public.receipt_allocations for all to authenticated
  using (app.has_role('owner', 'accountant', 'admin')) with check (app.has_role('owner', 'accountant', 'admin'));

create policy wht_certs_read on public.wht_certificates for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin'));
create policy wht_certs_write on public.wht_certificates for all to authenticated
  using (app.has_role('owner', 'accountant', 'admin')) with check (app.has_role('owner', 'accountant', 'admin'));
create policy wht_cert_receipts_read on public.wht_certificate_receipts for select to authenticated
  using (app.has_role('owner', 'director', 'accountant', 'admin'));
create policy wht_cert_receipts_write on public.wht_certificate_receipts for all to authenticated
  using (app.has_role('owner', 'accountant', 'admin')) with check (app.has_role('owner', 'accountant', 'admin'));

-- -----------------------------------------------------------------------------
-- Locks, touch, audit
-- -----------------------------------------------------------------------------
select app.enable_month_lock('public.ledger_entries', 'entry_date');
select app.enable_month_lock('public.receipts', 'receipt_date');
select app.enable_month_lock('public.credit_notes', 'cn_date');
-- Invoices: approval checks the month itself (settlement updates on old
-- invoices must still be possible after their month closes).

create trigger touch before update on public.invoices for each row execute function app.touch();
create trigger touch before update on public.credit_notes for each row execute function app.touch();
create trigger touch before update on public.receipts for each row execute function app.touch();
create trigger touch before update on public.wht_certificates for each row execute function app.touch();

select app.enable_audit(t) from unnest(array[
  'public.invoices', 'public.invoice_lines', 'public.credit_notes', 'public.receipts',
  'public.receipt_allocations', 'public.wht_certificates']::regclass[]) t;
