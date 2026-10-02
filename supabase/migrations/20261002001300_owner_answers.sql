-- =============================================================================
-- 1300 The Owner's answers of 2 Oct 2026 (DECISIONS D-027, D-028)
--  * Q-23: cost to company = gross + employer SSNIT + employer PF, the figure in
--    the sheet's "Total Cost To Company" column. Post-tax allowances are left out.
--  * Q-25: the Owner may confirm client payments as the Accountant's backup.
--    Each one is logged, the Accountant is told, and it stays an unreviewed
--    entry (blocking month close) until the Accountant reviews it or sends it
--    back to Reported.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Q-23: cost to company
-- -----------------------------------------------------------------------------
comment on column public.payroll_lines.full_cost_to_company is
  'Gross + employer SSNIT + employer PF (D-027). Drives staff cost history and the running cost.';

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
  new.full_cost_to_company := new.gross + new.ssnit_employer + new.pf_employer;   -- D-027
  return new;
end $$;

-- Lines of runs still open for checking pick up the new figure.
update public.payroll_lines l set gross = l.gross
  from public.payroll_runs r where r.id = l.run_id and r.status = 'imported';

-- Import checks: as 0600, plus a warning when the sheet's own cost-to-company
-- column disagrees (its formula is gross + employer SSF; it leaves out
-- employer PF, which is nil while the PF rate is 0%: F-002).
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

  return query
    select 'warning', st.id, st.full_name, 'sheet_cost_differs',
           format('The sheet''s cost to company is %s; gross + employer SSNIT + employer PF is %s. The sheet''s formula may be leaving out employer PF.',
                  l.sheet_cost_to_company, l.full_cost_to_company)
    from public.payroll_lines l join public.staff st on st.id = l.staff_id
    where l.run_id = p_run and l.sheet_cost_to_company is not null
      and abs(l.sheet_cost_to_company - l.full_cost_to_company) > tol;
end $$;

-- -----------------------------------------------------------------------------
-- Q-25: the Owner confirms client payments as the Accountant's backup
-- -----------------------------------------------------------------------------
alter table public.receipts
  add column review_status text not null default 'not_required'
    check (review_status in ('not_required', 'recorded', 'reviewed')),
  add column reviewed_by uuid references public.profiles (user_id),
  add column reviewed_at timestamptz,
  add column review_note text;
comment on column public.receipts.review_status is
  'recorded = confirmed by the Owner and waiting for the Accountant''s review (D-028); not_required when the Accountant confirmed it.';

create or replace function app.receipts_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  role public.app_role := app.my_role();
  alloc record;
  locked_keys text[] := array['attachment_path', 'notes', 'updated_at', 'updated_by'];
  review_keys text[] := array['review_status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at', 'updated_by'];
  return_keys text[] := review_keys || array['status', 'confirmed_by', 'confirmed_at'];
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
    new.review_status := 'not_required'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    new.created_by := auth.uid();
    if role = 'owner' and new.source is null then new.source := 'reported_by_owner'; end if;
    return new;
  end if;

  -- The Accountant reviews a payment the Owner confirmed (D-028) ...
  if old.status = 'confirmed' and new.status = 'confirmed'
     and (new.review_status, new.review_note) is distinct from (old.review_status, old.review_note) then
    if role is distinct from 'accountant' then
      raise exception 'Only the Accountant reviews a payment the Owner confirmed' using errcode = '42501';
    end if;
    if old.review_status <> 'recorded' or new.review_status <> 'reviewed' then
      raise exception 'This payment has no review waiting';
    end if;
    if (to_jsonb(new) - review_keys) is distinct from (to_jsonb(old) - review_keys) then
      raise exception 'Review a payment without changing it';
    end if;
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
    return new;
  end if;

  -- ... or sends it back to Reported when it doesn't match the statement.
  if old.status = 'confirmed' and new.status = 'reported' then
    if role is distinct from 'accountant' or old.review_status <> 'recorded' then
      raise exception 'Only the Accountant can send back a payment the Owner confirmed, while it awaits review'
        using errcode = '42501';
    end if;
    if length(trim(coalesce(new.review_note, ''))) = 0 then
      raise exception 'Say why the payment is going back to Reported';
    end if;
    if (to_jsonb(new) - return_keys) is distinct from (to_jsonb(old) - return_keys) then
      raise exception 'Send the payment back without changing it';
    end if;
    new.confirmed_by := null; new.confirmed_at := null;
    new.review_status := 'not_required'; new.reviewed_by := auth.uid(); new.reviewed_at := now();
    return new;
  end if;

  if old.status in ('confirmed', 'rejected')
     and (to_jsonb(new) - locked_keys) is distinct from (to_jsonb(old) - locked_keys) then
    raise exception 'This payment is % and locked', old.status using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'reported' and new.status = 'confirmed' then
      if role is null or role not in ('accountant', 'owner') then
        raise exception 'Only the Accountant (or the Owner as backup) confirms payments, against the statement'
          using errcode = '42501';
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
      new.review_status := case when role = 'owner' then 'recorded' else 'not_required' end;
      new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    elsif old.status = 'reported' and new.status = 'rejected' then
      if role not in ('owner', 'accountant') then raise exception 'Not allowed' using errcode = '42501'; end if;
      if length(trim(coalesce(new.rejection_reason, ''))) = 0 then raise exception 'Say why the payment is rejected'; end if;
    else
      raise exception 'A payment cannot move from % to %', old.status, new.status;
    end if;
  elsif (new.review_status, new.reviewed_by, new.review_note) is distinct from (old.review_status, old.reviewed_by, old.review_note) then
    raise exception 'Only a payment the Owner confirmed is reviewed';
  end if;
  return new;
end $$;

-- Tell the Accountant (and the Owner, when one is sent back).
create or replace function app.receipts_review_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cname text;
begin
  select name into cname from public.clients where id = new.client_id;
  if new.status = 'confirmed' and old.status = 'reported' and new.review_status = 'recorded' then
    perform app.notify_role('accountant', 'owner_confirmed_payment',
      format('The Owner confirmed a payment of GHS %s from %s. Please review it against the statement.',
             to_char(new.cash_amount, 'FM999,999,990.00'), cname),
      format('/receipts?id=%s', new.id), 'receipt', new.id, null, true);
  elsif new.status = 'reported' and old.status = 'confirmed' then
    perform app.notify(old.confirmed_by, 'payment_sent_back',
      format('The Accountant sent back the payment from %s: %s', cname, new.review_note),
      format('/receipts?id=%s', new.id), 'receipt', new.id, null, true);
  end if;
  return null;
end $$;
create trigger review_notice after update on public.receipts
  for each row execute function app.receipts_review_notice();

-- Month close: as 0700, plus payments the Owner confirmed and the Accountant
-- hasn't reviewed (D-028).
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

  return query select 'unreviewed_entry', 'receipts', r.id,
      'Payment confirmed by the Owner on ' || to_char(r.receipt_date, 'DD Mon YYYY') || ', not reviewed'
    from public.receipts r
    where r.receipt_date >= s and r.receipt_date < e and r.status = 'confirmed' and r.review_status = 'recorded';

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

-- Accountant home: as 0800, plus Owner-confirmed payments to review.
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
    'owner_confirmed_payments', (select count(*) from public.receipts where status = 'confirmed' and review_status = 'recorded'),
    'payments_to_confirm', (select count(*) from public.receipts where status = 'reported'),
    'unreconciled_accounts', (select count(*) from public.accounts a where a.is_active and not exists (
        select 1 from public.reconciliations r where r.account_id = a.id and r.status = 'closed'
          and r.month = (date_trunc('month', app.today()) - interval '1 month')::date)),
    'last_closed_month', (select max(month) from public.month_closes where status = 'closed'));
end $$;
