-- =============================================================================
-- 2100 Leave and setup fixes from the Owner's staging test, 3 Oct 2026
-- (DECISIONS D-046..D-050)
--  * D-046 Each leave type has an entitlement kind:
--      annual     Annual leave: pro-rated by time worked, carried over
--      capped     Sick, Compassionate, Study/exam: a yearly cap, not pro-rated
--      per_event  Maternity, Paternity: a set entitlement per event, no yearly
--                 balance; supporting document required before approval
--      none       Unpaid, Other: no entitlement
--  * D-047 An entitlement with nothing taken or booked against it can be
--    deleted by the Owner (audited); otherwise not.
--  * D-049 "Fees received" on the Money panel is the net fee received, on the
--    same basis as fees invoiced.
--  * D-050 The company phone for the invoice header (supplied by the Owner).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- D-046: entitlement kinds
-- -----------------------------------------------------------------------------
alter table public.leave_types
  add column entitlement_kind text not null default 'none'
    check (entitlement_kind in ('annual', 'capped', 'per_event', 'none')),
  add column event_entitled_days numeric(5,1) check (event_entitled_days > 0);
comment on column public.leave_types.event_entitled_days is
  'per_event types: working days granted for each event (Maternity 12 weeks = 60 working days; Paternity 5).';

update public.leave_types set entitlement_kind = case
    when uses_annual_balance then 'annual'
    when name in ('Sick', 'Compassionate/bereavement', 'Study/exam') then 'capped'
    when name in ('Maternity', 'Paternity') then 'per_event'
    else 'none' end;
update public.leave_types set event_entitled_days = 60, requires_document = true where name = 'Maternity' and event_entitled_days is null;
update public.leave_types set event_entitled_days = 5, requires_document = true where name = 'Paternity' and event_entitled_days is null;
-- Only Annual leave uses the annual balance; the flag now follows the kind.
update public.leave_types set uses_annual_balance = (entitlement_kind = 'annual');

-- Edits in Settings keep the old flag in step with the kind.
create or replace function app.leave_types_kind_sync() returns trigger
language plpgsql as $$
begin
  new.uses_annual_balance := new.entitlement_kind = 'annual';
  if new.entitlement_kind <> 'per_event' then new.event_entitled_days := null; end if;
  return new;
end $$;
create trigger kind_sync before insert or update on public.leave_types
  for each row execute function app.leave_types_kind_sync();

-- Per-event and no-entitlement types have no yearly entitlement rows.
delete from public.leave_entitlements e using public.leave_types t
 where t.id = e.leave_type_id and t.entitlement_kind in ('per_event', 'none');

-- Setting up a year: Annual pro-rated and carried over; yearly caps in full;
-- nothing for per-event or no-entitlement types (as 1400 otherwise).
create or replace function public.set_up_leave_year(p_year int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings_versions;
  y_start date;
  y_end date;
  n int;
begin
  if not app.has_role('owner') then
    raise exception 'Only the Owner sets leave entitlements' using errcode = '42501';
  end if;
  y_start := make_date(p_year, (app.settings_at(make_date(p_year, 12, 31))).leave_year_start_month, 1);
  y_end := (y_start + interval '1 year' - interval '1 day')::date;
  s := app.settings_at(y_start);

  insert into public.leave_entitlements (staff_id, leave_type_id, leave_year, entitled_days, carried_over_days, notes)
  select st.id, lt.id, p_year,
         case when lt.entitlement_kind = 'annual'
              -- days employed in the leave year / days in the year, to the nearest half day
              then round(lt.default_entitled_days * 2
                         * (least(coalesce(st.end_date, y_end), y_end) - greatest(st.start_date, y_start) + 1)
                         / (y_end - y_start + 1)) / 2
              else lt.default_entitled_days end,
         case when lt.entitlement_kind = 'annual'
              then least(coalesce(s.max_carry_over_days, 0),
                         greatest((app.leave_balance(st.id, lt.id, p_year - 1)).available, 0))
              else 0 end,
         case when lt.entitlement_kind = 'annual' and (st.start_date > y_start or coalesce(st.end_date, y_end) < y_end)
              then 'Pro-rated for the dates employed' end
  from public.staff st
  cross join public.leave_types lt
  where st.is_active and lt.is_active and lt.entitlement_kind in ('annual', 'capped')
    and lt.default_entitled_days is not null
    and st.start_date <= y_end and (st.end_date is null or st.end_date >= y_start)
    and not exists (select 1 from public.leave_entitlements e
                    where e.staff_id = st.id and e.leave_type_id = lt.id and e.leave_year = p_year);
  get diagnostics n = row_count;
  return n;
end $$;

-- Requests and approvals: as 0300, with the yearly cap checked for Annual and
-- capped types, and per-event types limited to their entitlement per event
-- and needing their document before approval.
create or replace function app.leave_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.leave_types;
  bal record;
begin
  select * into t from public.leave_types where id = new.leave_type_id;
  new.working_days := app.working_days_in(new.start_date, new.end_date);
  if new.working_days = 0 then
    raise exception 'The leave dates contain no working days';
  end if;
  if exists (select 1 from public.leave_requests r
             where r.staff_id = new.staff_id and r.id <> new.id
               and r.status in ('requested', 'approved', 'taken')
               and daterange(r.start_date, r.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'This overlaps another leave request';
  end if;
  if t.entitlement_kind = 'per_event' and t.event_entitled_days is not null and new.working_days > t.event_entitled_days then
    raise exception '% leave is up to % working days for each event; this request is %', t.name, trim_scale(t.event_entitled_days), new.working_days;
  end if;

  if tg_op = 'INSERT' then
    if new.staff_id <> coalesce(app.my_staff_id(), '00000000-0000-0000-0000-000000000000') and not app.has_role('owner') then
      raise exception 'You can only request leave for yourself' using errcode = '42501';
    end if;
    -- The Owner's own leave is recorded without approval (brief §4).
    if app.staff_is_owner(new.staff_id) then
      new.status := 'approved'; new.decided_by := auth.uid(); new.decided_at := now();
    else
      new.status := 'requested'; new.decided_by := null; new.decided_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if app.in_system() then return new; end if;
  if old.status <> 'requested' and (new.start_date, new.end_date, new.leave_type_id, new.staff_id)
       is distinct from (old.start_date, old.end_date, old.leave_type_id, old.staff_id) then
    raise exception 'Only a pending request can be changed';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'requested' and new.status in ('approved', 'declined') then
      if not app.can_approve_for(new.staff_id) then
        raise exception 'You are not this person''s leave approver' using errcode = '42501';
      end if;
      if new.status = 'approved' and t.entitlement_kind = 'per_event' and t.requires_document and new.document_path is null then
        raise exception 'Attach the supporting document before approving % leave', t.name;
      end if;
      if new.status = 'approved' and t.entitlement_kind in ('annual', 'capped') then
        bal := app.leave_balance(new.staff_id, new.leave_type_id, app.leave_year(new.start_date));
        if bal.available - new.working_days < 0 and not app.has_role('owner') then
          raise exception '%', case when t.entitlement_kind = 'annual'
            then 'This takes the annual balance below zero: only the Owner can approve it, or change it to Unpaid leave'
            else format('This goes over the yearly %s leave limit: only the Owner can approve it, or change it to Unpaid leave', t.name) end
            using errcode = '42501';
        end if;
      end if;
      new.decided_by := auth.uid(); new.decided_at := now();
    elsif new.status = 'cancelled' and old.status in ('requested', 'approved') then
      if old.status = 'approved' and old.start_date <= app.today() then
        raise exception 'Approved leave can only be cancelled before it starts';
      end if;
      if not (new.staff_id = app.my_staff_id() or app.can_approve_for(new.staff_id)) then
        raise exception 'Not allowed' using errcode = '42501';
      end if;
    elsif new.status = 'taken' and old.status = 'approved' then
      if not app.has_role('owner') then raise exception 'Not allowed' using errcode = '42501'; end if;
    else
      raise exception 'Leave cannot move from % to %', old.status, new.status;
    end if;
  end if;
  return new;
end $$;

-- Balances: Annual and yearly-capped types only (as 0800, plus the
-- entitlement's id and kind for the screens).
create or replace view public.leave_balances with (security_barrier) as
  select e.staff_id, st.full_name, e.leave_type_id, lt.name as leave_type, e.leave_year,
         b.entitled, b.carried_over, b.taken, b.booked, b.available,
         e.id as entitlement_id, lt.entitlement_kind
  from public.leave_entitlements e
  join public.staff st on st.id = e.staff_id
  join public.leave_types lt on lt.id = e.leave_type_id
  cross join lateral app.leave_balance(e.staff_id, e.leave_type_id, e.leave_year) b
  where lt.entitlement_kind in ('annual', 'capped')
    and (app.has_role('owner', 'director', 'accountant')
         or e.staff_id = app.my_staff_id()
         or (app.has_role('project_lead') and app.can_approve_for(e.staff_id)));

-- -----------------------------------------------------------------------------
-- D-047: deleting an entitlement only while nothing is taken or booked
-- -----------------------------------------------------------------------------
create or replace function app.leave_entitlements_before_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.leave_requests r
             where r.staff_id = old.staff_id and r.leave_type_id = old.leave_type_id
               and r.status in ('requested', 'approved', 'taken')
               and app.leave_year(r.start_date) = old.leave_year) then
    raise exception 'Leave has been taken or booked against this entitlement, so it can''t be deleted. Change the days instead.'
      using errcode = '42501';
  end if;
  return old;
end $$;
create trigger guard_delete before delete on public.leave_entitlements
  for each row execute function app.leave_entitlements_before_delete();

-- -----------------------------------------------------------------------------
-- D-050: the company phone, supplied by the Owner on 3 Oct 2026
-- -----------------------------------------------------------------------------
update public.settings_versions set company_phone = '+233 56 071 2012' where company_phone is null;

-- -----------------------------------------------------------------------------
-- D-049: Money panel as 1900, with fees received on the net basis.
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
      -- Net fee received (D-049): each confirmed payment's share of the net fee
      -- on the invoices it settles (cash, WHT and VAT withheld all settle the
      -- invoice; VAT is taken out pro rata), on the same basis as "invoiced".
      'received', (select coalesce(round(sum((a.cash_amount + a.wht_amount + a.vat_withheld_amount)
                                             * i.net_total / nullif(i.gross_total, 0)), 2), 0)
                   from public.receipt_allocations a
                   join public.receipts r on r.id = a.receipt_id
                   join public.invoices i on i.id = a.invoice_id
                   where r.status = 'confirmed' and r.receipt_date >= m and r.receipt_date < m + interval '1 month'),
      'received_gross', (select coalesce(sum(cash_amount + wht_amount + vat_withheld_amount), 0) from public.receipts
                   where status = 'confirmed' and receipt_date >= m and receipt_date < m + interval '1 month'),
      'target', s.monthly_fee_target)
  );
  return result;
end $$;
