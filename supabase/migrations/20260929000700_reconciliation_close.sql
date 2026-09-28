-- =============================================================================
-- 0700 Statements, reconciliation and month close (brief §7.8, §9 month
-- close; acceptance 11, 13, 14, 25). Also attaches the Director write block
-- to every table (A-004).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Bank and mobile money statements. Uploaded by the Accountant only (Admin
-- never handles statements, since they show balances: brief §9).
-- -----------------------------------------------------------------------------
create table public.statement_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id),
  period_start date not null,
  period_end date not null,
  opening_balance numeric(14,2),
  closing_balance numeric(14,2) not null,
  file_path text,
  source_format text,                         -- e.g. 'gcb_csv', 'mtn_momo_csv' (parsers added with samples, D-025)
  uploaded_by uuid default auth.uid() references public.profiles (user_id),
  uploaded_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table public.statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.statement_imports (id) on delete cascade,
  line_date date not null,
  description text,
  reference text,
  amount numeric(14,2) not null check (amount <> 0),     -- + credit (money in), - debit
  running_balance numeric(14,2),
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'record_task', 'explained')),
  matched_source_type text,
  matched_source_id uuid,
  explanation text,
  matched_by uuid references public.profiles (user_id),
  matched_at timestamptz,
  check (status <> 'matched' or matched_source_id is not null),
  check (status <> 'explained' or length(trim(coalesce(explanation, ''))) > 0)
);
create index statement_lines_import on public.statement_lines (import_id, line_date);

-- An unmatched credit becomes a "Record this receipt" task for Admin (brief §7.4 rule 4).
create or replace function app.statement_lines_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'record_task' and (tg_op = 'INSERT' or old.status <> 'record_task') then
    if new.amount <= 0 then raise exception 'Only a credit can become a "Record this receipt" task'; end if;
    perform app.open_action('record_receipt',
      format('Record this receipt: GHS %s on %s (%s)', to_char(new.amount, 'FM999,999,990.00'),
             to_char(new.line_date, 'DD Mon YYYY'), coalesce(new.description, 'no description')),
      format('/receipts/new?statement_line=%s', new.id), 'admin', 'statement_line', new.id, new.line_date + 3);
  end if;
  if tg_op = 'UPDATE' and old.status = 'record_task' and new.status <> 'record_task' then
    perform app.close_action('record_receipt', new.id);
  end if;
  return null;
end $$;
create trigger after_write after insert or update on public.statement_lines
  for each row execute function app.statement_lines_after();

create or replace function app.statement_lines_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.matched_by := auth.uid(); new.matched_at := now();
  end if;
  return new;
end $$;
create trigger before_write before update on public.statement_lines
  for each row execute function app.statement_lines_before();

-- A receipt recorded from a statement line matches it (and closes the task).
alter table public.receipts add column statement_line_id uuid unique references public.statement_lines (id);

create or replace function app.receipt_matches_statement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.statement_line_id is not null
     and (tg_op = 'INSERT' or new.statement_line_id is distinct from old.statement_line_id) then
    update public.statement_lines
       set status = 'matched', matched_source_type = 'receipt', matched_source_id = new.id
     where id = new.statement_line_id;
  end if;
  return null;
end $$;
create trigger match_statement after insert or update on public.receipts
  for each row execute function app.receipt_matches_statement();

-- -----------------------------------------------------------------------------
-- Reconciliations (brief §9): one per account per month. Can't close with an
-- unexplained difference (acceptance 13).
-- -----------------------------------------------------------------------------
create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id),
  month date not null check (extract(day from month) = 1),
  statement_balance numeric(14,2) not null,
  calculated_balance numeric(14,2) not null default 0,   -- set by trigger from the ledger
  difference numeric(14,2) not null default 0,
  explanation text,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_by uuid references public.profiles (user_id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (account_id, month)
);

create or replace function app.reconciliations_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare month_end date := (new.month + interval '1 month' - interval '1 day')::date;
begin
  if tg_op = 'UPDATE' and old.status = 'closed' and not app.in_system() then
    raise exception 'This reconciliation is closed' using errcode = '42501';
  end if;
  new.calculated_balance := app.account_balance(new.account_id, month_end);
  new.difference := new.statement_balance - new.calculated_balance;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    if abs(new.difference) > 0.005 and length(trim(coalesce(new.explanation, ''))) = 0 then
      raise exception 'The statement and calculated balances differ by GHS %. Explain or adjust the difference first.',
        to_char(new.difference, 'FM999,999,990.00');
    end if;
    if exists (select 1 from public.statement_lines sl join public.statement_imports si on si.id = sl.import_id
               where si.account_id = new.account_id and sl.status in ('unmatched', 'record_task')
                 and sl.line_date <= month_end) then
      raise exception 'Match, explain or record every statement line first';
    end if;
    new.closed_by := auth.uid(); new.closed_at := now();
  end if;
  return new;
end $$;
create trigger before_write before insert or update on public.reconciliations
  for each row execute function app.reconciliations_before();

-- -----------------------------------------------------------------------------
-- Month close
-- -----------------------------------------------------------------------------

-- Everything that stops a month closing (brief §4, §9; acceptance 11, 14).
create or replace function public.month_close_blockers(p_month date)
returns table (kind text, record_type text, record_id uuid, description text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s date := date_trunc('month', p_month)::date;
  e date := (date_trunc('month', p_month) + interval '1 month')::date;
  t text;
  col text;
begin
  if not app.has_role('owner', 'director', 'accountant', 'admin') then return; end if;

  -- Money entries not reviewed, or queried.
  for t, col in values ('expenses', 'expense_date'), ('payments_out', 'payment_date'),
      ('staff_payments', 'payment_date'), ('transfers', 'transfer_date'), ('staff_loans', 'payment_date'),
      ('staff_loan_repayments', 'repayment_date'), ('director_transactions', 'txn_date'),
      ('director_payments', 'payment_date'), ('statutory_payments', 'payment_date') loop
    return query execute format(
      'select case when review_status = ''queried'' then ''queried_entry'' else ''unreviewed_entry'' end,
              %L, id, %L || '' dated '' || to_char(%I, ''DD Mon YYYY'')
       from public.%I where %I >= $1 and %I < $2 and review_status in (''recorded'', ''queried'')',
      t, replace(t, '_', ' '), col, t, col, col) using s, e;
  end loop;

  return query select 'unreviewed_entry', 'payroll_runs', r.id, 'Payroll run not reviewed'
    from public.payroll_runs r
    where r.period_month = s and r.status in ('approved', 'issued') and r.review_status in ('recorded', 'queried');

  return query select 'unconfirmed_receipt', 'receipts', r.id,
      'Payment reported on ' || to_char(r.receipt_date, 'DD Mon YYYY') || ' not confirmed'
    from public.receipts r where r.receipt_date >= s and r.receipt_date < e and r.status = 'reported';

  return query select 'recurring_draft', 'expenses', x.id, 'Recurring expense draft not confirmed: ' || x.description
    from public.expenses x where x.expense_date >= s and x.expense_date < e and x.entry_status = 'draft';

  return query select 'statement_line', 'statement_lines', sl.id,
      'Statement line not matched: GHS ' || to_char(sl.amount, 'FM999,999,990.00') || ' on ' || to_char(sl.line_date, 'DD Mon YYYY')
    from public.statement_lines sl where sl.line_date >= s and sl.line_date < e and sl.status in ('unmatched', 'record_task');

  return query select 'reconciliation', 'accounts', a.id, 'Account not reconciled: ' || a.name
    from public.accounts a
    where a.is_active and a.opening_date < e
      and not exists (select 1 from public.reconciliations r where r.account_id = a.id and r.month = s and r.status = 'closed');

  return query select 'payment_approved_unpaid', 'payments_out', p.id, 'Approved payment not yet recorded as paid'
    from public.payments_out p where p.status = 'approved' and p.approved_at < e;
end $$;

create or replace function public.close_month(p_month date) returns void
language plpgsql security definer set search_path = '' as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if not app.has_role('accountant', 'owner') then
    raise exception 'Only the Accountant (or Owner) closes a month' using errcode = '42501';
  end if;
  if exists (select 1 from public.month_close_blockers(m)) then
    raise exception 'The month can''t close yet: % item(s) outstanding', (select count(*) from public.month_close_blockers(m));
  end if;
  insert into public.month_closes (month, status, closed_at, closed_by)
  values (m, 'closed', now(), auth.uid())
  on conflict (month) do update set status = 'closed', closed_at = now(), closed_by = auth.uid();
  perform app.notify_role('owner', 'month_closed', format('%s is closed. Please review by the 12th.', to_char(m, 'Mon YYYY')),
    format('/close/%s', to_char(m, 'YYYY-MM')), 'month_close', null, null, true);
  perform app.notify_role('director', 'month_closed', format('Monthly summary: %s is closed', to_char(m, 'Mon YYYY')),
    format('/reports/monthly?month=%s', to_char(m, 'YYYY-MM')), 'month_close', null, null, false);
end $$;

-- Only the Owner reopens a month, with a reason, and it's logged (acceptance 25).
create or replace function public.reopen_month(p_month date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if not app.has_role('owner') then raise exception 'Only the Owner can reopen a month' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Give the reason for reopening'; end if;
  update public.month_closes set status = 'open' where month = m and status = 'closed';
  if not found then raise exception 'That month is not closed'; end if;
  insert into public.month_reopenings (month, reason) values (m, p_reason);
  perform app.notify_role('accountant', 'month_reopened', format('%s was reopened: %s', to_char(m, 'Mon YYYY'), p_reason),
    format('/close/%s', to_char(m, 'YYYY-MM')), 'month_close', null, null, true);
end $$;

-- Admin's and the Accountant's checklists (brief §9).
create or replace function public.save_close_checklist(p_month date, p_checklist jsonb, p_complete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if app.has_role('admin') then
    insert into public.month_closes (month, admin_checklist) values (m, p_checklist)
    on conflict (month) do update set admin_checklist = excluded.admin_checklist,
      admin_completed_at = case when p_complete then now() end,
      admin_completed_by = case when p_complete then auth.uid() end
    where public.month_closes.status = 'open';
  elsif app.has_role('accountant', 'owner') then
    insert into public.month_closes (month, accountant_checklist) values (m, p_checklist)
    on conflict (month) do update set accountant_checklist = excluded.accountant_checklist
    where public.month_closes.status = 'open';
  else
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end $$;

create or replace function public.mark_month_reviewed(p_month date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role('owner') then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.month_closes set owner_reviewed_at = now() where month = date_trunc('month', p_month)::date and status = 'closed';
end $$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.statement_imports enable row level security;
alter table public.statement_lines enable row level security;
alter table public.reconciliations enable row level security;

create policy statement_imports_read on public.statement_imports for select to authenticated using (app.is_finance());
create policy statement_imports_write on public.statement_imports for all to authenticated
  using (app.has_role('accountant', 'owner')) with check (app.has_role('accountant', 'owner'));
create policy statement_lines_read on public.statement_lines for select to authenticated using (app.is_finance());
create policy statement_lines_write on public.statement_lines for all to authenticated
  using (app.has_role('accountant', 'owner')) with check (app.has_role('accountant', 'owner'));
create policy reconciliations_read on public.reconciliations for select to authenticated using (app.is_finance());
create policy reconciliations_write on public.reconciliations for all to authenticated
  using (app.has_role('accountant', 'owner')) with check (app.has_role('accountant', 'owner'));

-- Admin sees the statement line behind a "Record this receipt" task: date,
-- amount, description only; never the running balance (A-003).
create view public.receipt_tasks with (security_barrier) as
  select a.id as action_id, a.status, sl.id as statement_line_id, sl.line_date, sl.amount, sl.description, sl.reference
  from public.action_items a join public.statement_lines sl on sl.id = a.record_id
  where a.kind = 'record_receipt' and app.has_role('owner', 'accountant', 'admin');

select app.enable_month_lock('public.statement_lines', 'line_date');
create trigger touch before update on public.reconciliations for each row execute function app.touch();
select app.enable_audit(t) from unnest(array[
  'public.statement_imports', 'public.statement_lines', 'public.reconciliations']::regclass[]) t;

-- -----------------------------------------------------------------------------
-- Director write block on every table (A-004), except notifications, where
-- marking a notification read is the Director's own UI state.
-- Any table added in a later migration must call app.enable_director_block().
-- -----------------------------------------------------------------------------
create or replace function app.enable_director_block(p_table regclass) returns void
language plpgsql as $$
begin
  execute format(
    'create trigger a0_block_director before insert or update or delete on %s for each row execute function app.block_director_writes()',
    p_table);
end $$;

do $$
declare t regclass;
begin
  for t in
    select c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('notifications')
  loop
    perform app.enable_director_block(t);
  end loop;
end $$;
