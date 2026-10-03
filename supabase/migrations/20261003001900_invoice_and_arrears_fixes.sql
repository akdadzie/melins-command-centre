-- =============================================================================
-- 1900 Fixes from the Owner's staging test, 3 Oct 2026 (DECISIONS D-037..D-041)
--  * D-037 Allocations follow the payment: when a reported payment's amounts
--    change, its allocations are refitted (WHT, then VAT withheld, then cash,
--    each capped at what the invoice owes); the quick-log never allocates more
--    than the invoice owes. Existing payments are refitted here.
--  * D-039 Invoice letterhead and payment options: company phone, email and
--    website; bank and MTN mobile money details as separate settings; client
--    address and contact person for "Bill to".
--  * D-040 Payment plans for statutory lines: a planned payment date, or dated
--    instalments; missed dates are flagged and reminded.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- D-037: allocations follow the payment
-- -----------------------------------------------------------------------------
create or replace function app.refit_allocations(p_receipt uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.receipts;
  a record;
  left_w numeric; left_v numeric; left_c numeric;
  room numeric; w numeric; v numeric; c numeric;
  plan jsonb := '[]';
  item jsonb;
begin
  select * into r from public.receipts where id = p_receipt;
  if not found or r.status <> 'reported' then return; end if;
  left_w := r.wht_amount; left_v := r.vat_withheld_amount; left_c := r.cash_amount;
  -- Same invoices, oldest first; each can take what it owes apart from this payment.
  for a in select ra.invoice_id, i.outstanding + ra.cash_amount + ra.wht_amount + ra.vat_withheld_amount as room
           from public.receipt_allocations ra join public.invoices i on i.id = ra.invoice_id
           where ra.receipt_id = p_receipt order by i.invoice_date, i.invoice_number loop
    room := a.room;
    w := greatest(least(left_w, room), 0); room := room - w; left_w := left_w - w;
    v := greatest(least(left_v, room), 0); room := room - v; left_v := left_v - v;
    c := greatest(least(left_c, room), 0); left_c := left_c - c;
    plan := plan || jsonb_build_array(jsonb_build_object('invoice_id', a.invoice_id, 'w', w, 'v', v, 'c', c));
  end loop;
  if jsonb_array_length(plan) = 0 then return; end if;
  perform app.enter_system();
  delete from public.receipt_allocations where receipt_id = p_receipt;
  for item in select * from jsonb_array_elements(plan) loop
    if (item ->> 'w')::numeric + (item ->> 'v')::numeric + (item ->> 'c')::numeric > 0 then
      insert into public.receipt_allocations (receipt_id, invoice_id, cash_amount, wht_amount, vat_withheld_amount)
      values (p_receipt, (item ->> 'invoice_id')::uuid, (item ->> 'c')::numeric, (item ->> 'w')::numeric, (item ->> 'v')::numeric);
    end if;
  end loop;
  perform app.leave_system();
end $$;

create or replace function app.receipts_refit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'reported' and (new.cash_amount, new.wht_amount, new.vat_withheld_amount)
       is distinct from (old.cash_amount, old.wht_amount, old.vat_withheld_amount) then
    perform app.refit_allocations(new.id);
  end if;
  return null;
end $$;
create trigger refit_allocations after update of cash_amount, wht_amount, vat_withheld_amount on public.receipts
  for each row execute function app.receipts_refit_trigger();

-- The quick-log allocates no more than the invoice still owes.
create or replace function public.quick_log_payment(
  p_amount numeric, p_date date default null, p_invoice_id uuid default null, p_client_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_client uuid := p_client_id;
  v_owed numeric;
  v_id uuid;
begin
  if p_invoice_id is not null then
    select client_id, outstanding into v_client, v_owed from public.invoices where id = p_invoice_id;
  end if;
  if v_client is null then raise exception 'Choose a client or an invoice'; end if;
  insert into public.receipts (client_id, receipt_date, cash_amount, source)
  values (v_client, coalesce(p_date, app.today()), p_amount, 'reported_by_owner')
  returning id into v_id;
  if p_invoice_id is not null and least(p_amount, v_owed) > 0 then
    insert into public.receipt_allocations (receipt_id, invoice_id, cash_amount)
    values (v_id, p_invoice_id, least(p_amount, v_owed));
  end if;
  return v_id;
end $$;

-- Repair payments recorded before this fix (e.g. the 3 Oct staging test).
select app.refit_allocations(r.id) from public.receipts r
where r.status = 'reported'
  and exists (select 1 from public.receipt_allocations a where a.receipt_id = r.id
              group by a.receipt_id
              having sum(a.cash_amount) > r.cash_amount + 0.005 or sum(a.wht_amount) > r.wht_amount + 0.005
                  or sum(a.vat_withheld_amount) > r.vat_withheld_amount + 0.005);

-- -----------------------------------------------------------------------------
-- D-039: letterhead, payment options and "Bill to"
-- -----------------------------------------------------------------------------
alter table public.settings_versions
  add column company_phone text,
  add column company_email text,
  add column company_website text,
  add column payment_bank_name text,
  add column payment_bank_branch text,
  add column payment_bank_account_number text,
  add column payment_bank_account_name text,
  add column payment_momo_network text,
  add column payment_momo_number text,
  add column payment_momo_account_name text,
  add column payment_momo_note text;
comment on column public.settings_versions.payment_bank_account_number is
  'Printed on invoices for clients to pay into. MeLiNS''s own account records keep only the last 4 digits (brief §3).';

-- Supplied by the Owner on 3 Oct 2026. The MoMo number and the company phone
-- are left for the Owner to enter (never guessed).
update public.settings_versions set
  company_website = coalesce(company_website, 'www.themelins.com'),
  payment_bank_name = coalesce(payment_bank_name, 'Prudential Bank'),
  payment_bank_branch = coalesce(payment_bank_branch, 'Taifa Branch'),
  payment_bank_account_number = coalesce(payment_bank_account_number, '0392000680010'),
  payment_bank_account_name = coalesce(payment_bank_account_name, 'MeLiNS Associates Limited'),
  payment_momo_network = coalesce(payment_momo_network, 'MTN'),
  payment_momo_account_name = coalesce(payment_momo_account_name, 'MeLiNS Associates Limited'),
  payment_momo_note = coalesce(payment_momo_note,
    'Some apps may display the name Kwasi Dadzie Ennison (Managing Director) for this wallet.');

create or replace view public.company_profile with (security_barrier) as
  select s.registered_name, s.tin, s.vat_number, s.address, s.accounts_email,
         s.invoice_payment_details, s.invoice_terms_days, s.effective_from,
         s.company_phone, coalesce(s.company_email, s.accounts_email) as company_email, s.company_website,
         s.payment_bank_name, s.payment_bank_branch, s.payment_bank_account_number, s.payment_bank_account_name,
         s.payment_momo_network, s.payment_momo_number, s.payment_momo_account_name, s.payment_momo_note
  from public.settings_versions s
  where app.my_role() is not null
    and s.effective_from = (select max(effective_from) from public.settings_versions where effective_from <= app.today());

alter table public.clients
  add column address text,
  add column contact_person text;

-- -----------------------------------------------------------------------------
-- D-040: payment plans for statutory lines (e.g. opening arrears)
-- -----------------------------------------------------------------------------
alter table public.statutory_lines add column planned_payment_date date;
comment on column public.statutory_lines.due_date is 'When it was (or is) legally due. Overdue after this.';
comment on column public.statutory_lines.planned_payment_date is 'When MeLiNS plans, or has agreed, to pay it all (D-040).';

create table public.statutory_plan_instalments (
  id uuid primary key default gen_random_uuid(),
  statutory_line_id uuid not null references public.statutory_lines (id) on delete cascade,
  due_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (statutory_line_id, due_on)
);

-- Each planned payment with whether it's met: payments and credit count
-- towards the instalments in date order. A line with only a planned date is
-- one instalment of the whole amount.
create or replace function app.statutory_plan(p_line uuid)
returns table (due_on date, amount numeric, cumulative numeric, met boolean, missed boolean)
language sql stable security definer set search_path = '' as $$
  with l as (select * from public.statutory_lines where id = p_line),
  covered as (select app.statutory_cash_paid(p_line) + app.statutory_credit_applied(p_line) as amt),
  items as (
    select i.due_on, i.amount from public.statutory_plan_instalments i where i.statutory_line_id = p_line
    union all
    select l.planned_payment_date, l.amount_due from l
    where l.planned_payment_date is not null
      and not exists (select 1 from public.statutory_plan_instalments where statutory_line_id = p_line)),
  run as (select due_on, amount, sum(amount) over (order by due_on) as cumulative from items)
  select run.due_on, run.amount, run.cumulative,
         covered.amt >= run.cumulative - 0.005,
         covered.amt < run.cumulative - 0.005 and run.due_on < app.today()
  from run, covered
  order by run.due_on
$$;

create view public.statutory_plans with (security_barrier) as
  select l.id as statutory_line_id, l.planned_payment_date,
         (select count(*) from public.statutory_plan_instalments i where i.statutory_line_id = l.id)::int as instalments,
         nx.due_on as next_due_on, nx.cumulative - (app.statutory_cash_paid(l.id) + app.statutory_credit_applied(l.id)) as next_amount,
         ms.first_missed_on, coalesce(ms.missed, 0)::int as missed_count
  from public.statutory_lines l
  left join lateral (select p.due_on, p.cumulative from app.statutory_plan(l.id) p where not p.met order by p.due_on limit 1) nx on true
  left join lateral (select min(p.due_on) as first_missed_on, count(*) as missed from app.statutory_plan(l.id) p where p.missed) ms on true
  where app.is_finance()
    and (l.planned_payment_date is not null
         or exists (select 1 from public.statutory_plan_instalments i where i.statutory_line_id = l.id));

alter table public.statutory_plan_instalments enable row level security;
create policy plan_instalments_read on public.statutory_plan_instalments for select to authenticated using (app.is_finance());
create policy plan_instalments_write on public.statutory_plan_instalments for all to authenticated
  using (app.has_role('owner', 'accountant')) with check (app.has_role('owner', 'accountant'));
select app.enable_director_block('public.statutory_plan_instalments');
select app.enable_audit('public.statutory_plan_instalments');

-- -----------------------------------------------------------------------------
-- Money panel: as 1800, with each overdue line's original due date and next
-- planned payment, and any missed plan date (D-040).
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
      'arrears', (select coalesce(jsonb_agg(jsonb_build_object('id', sl.id, 'label', sl.label, 'outstanding', sl.outstanding,
                    'notes', sl.notes, 'is_opening_arrears', sl.is_opening_arrears, 'credit_applied', sl.credit_applied,
                    'due_date', sl.due_date, 'next_planned_on', pl.next_due_on, 'next_planned_amount', pl.next_amount,
                    'plan_missed_on', pl.first_missed_on)
                    order by sl.label, sl.due_date), '[]')
                  from public.statutory_ledger sl left join public.statutory_plans pl on pl.statutory_line_id = sl.id
                  where sl.status = 'overdue'),
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
-- Daily reminders: as 1800, plus payment-plan dates (D-040).
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
  -- Payment plans (D-040): 7 days before each planned payment, and the day after one is missed.
  for r in select l.id, ru.label, p.due_on, p.amount, p.cumulative, p.met
           from public.statutory_lines l
           join public.statutory_due_rules ru on ru.type = l.type
           cross join lateral app.statutory_plan(l.id) p
           where not p.met and p.due_on in (d + 7, d - 1) loop
    if r.due_on = d + 7 then
      n := n + app.remind_role('accountant', 'plan7:' || r.id || ':' || r.due_on, 'statutory_plan_due',
        format('%s: planned payment of %s due on %s', r.label, app.ghs(r.amount), app.dmy(r.due_on)),
        '/tax/statutory', 'statutory_line', r.id, null, true);
    else
      n := n + app.remind_role('accountant', 'planmissed:' || r.id || ':' || r.due_on, 'statutory_plan_missed',
        format('%s: the planned payment of %s due %s was missed', r.label, app.ghs(r.amount), app.dmy(r.due_on)),
        '/tax/statutory', 'statutory_line', r.id, null, true);
      n := n + app.remind(owner_id, 'planmissed:' || r.id || ':' || r.due_on, 'statutory_plan_missed',
        format('%s: the planned payment of %s due %s was missed', r.label, app.ghs(r.amount), app.dmy(r.due_on)),
        '/tax/statutory', 'statutory_line', r.id, null, true);
    end if;
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

-- -----------------------------------------------------------------------------
-- D-038: a draft's client WHT rate is looked up again whenever the draft is
-- saved or approved, so a rate added to Settings after the draft was made is
-- used (it was only looked up when the invoice date changed). The screens warn
-- while a WHT-deducting client has no rate (expected WHT would show as 0).
-- -----------------------------------------------------------------------------
create or replace function app.invoice_wht_rate_refresh() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.clients;
begin
  if old.status = 'draft' then
    select * into c from public.clients where id = new.client_id;
    new.wht_rate := case when c.deducts_wht then coalesce(app.wht_rate_at('client', c.wht_category, new.invoice_date), 0) else 0 end;
  end if;
  return new;
end $$;
create trigger wht_rate_refresh before update on public.invoices
  for each row execute function app.invoice_wht_rate_refresh();
