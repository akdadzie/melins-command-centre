-- =============================================================================
-- 1500 Month-close screen (brief §9 close; A-040)
--  * Admin's view of what blocks a close is limited to Admin's own part:
--    queried entries, reported payments and recurring drafts. Statement lines
--    and reconciliations are the Accountant's (Admin never handles statements).
--  * entries_to_review(): every money entry waiting for the Accountant's
--    review, with what it is and how much, for the review queue.
-- =============================================================================

alter function public.month_close_blockers(date) rename to month_close_blockers_all;
alter function public.month_close_blockers_all(date) set schema app;
revoke execute on function app.month_close_blockers_all(date) from public, anon, authenticated;

create function public.month_close_blockers(p_month date)
returns table (kind text, record_type text, record_id uuid, description text)
language sql stable security definer set search_path = '' as $$
  select b.kind, b.record_type, b.record_id, b.description
  from app.month_close_blockers_all(p_month) b
  where not app.has_role('admin') or b.kind in ('queried_entry', 'unconfirmed_receipt', 'recurring_draft')
$$;

-- p_month null = everything outstanding, whatever its date.
create or replace function public.entries_to_review(p_month date default null)
returns table (record_type text, record_id uuid, entry_date date, amount numeric, description text,
               review_status text, query_note text, entered_by text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s date := date_trunc('month', p_month)::date;
  e date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  if not app.has_role('owner', 'director', 'accountant') then return; end if;
  return query
  with q as (
    select 'expenses' t, x.id, x.expense_date d, x.amount a, x.description dsc, x.review_status::text rs, x.query_note qn, x.created_by cb
      from public.expenses x where x.review_status in ('recorded', 'queried') and x.entry_status <> 'draft'
    union all
    select 'payments_out', p.id, p.payment_date, p.net_amount,
           coalesce(sp.name || ': ', '') || coalesce(p.description, p.reference, 'Supplier payment'), p.review_status::text, p.query_note, p.created_by
      from public.payments_out p left join public.suppliers sp on sp.id = p.supplier_id
     where p.review_status in ('recorded', 'queried') and p.status = 'paid'
    union all
    select 'staff_payments', p.id, p.payment_date, p.amount, 'Staff payment: ' || st.full_name, p.review_status::text, p.query_note, p.created_by
      from public.staff_payments p join public.staff st on st.id = p.staff_id
     where p.review_status in ('recorded', 'queried') and p.status = 'paid'
    union all
    select 'transfers', x.id, x.transfer_date, x.amount, 'Transfer: ' || coalesce(x.reason, x.reference, ''), x.review_status::text, x.query_note, x.created_by
      from public.transfers x where x.review_status in ('recorded', 'queried')
    union all
    select 'staff_loans', x.id, x.payment_date, x.amount, 'Staff loan: ' || st.full_name || coalesce(' (' || x.purpose || ')', ''),
           x.review_status::text, x.query_note, x.created_by
      from public.staff_loans x join public.staff st on st.id = x.staff_id
     where x.review_status in ('recorded', 'queried') and x.status = 'paid'
    union all
    select 'staff_loan_repayments', x.id, x.repayment_date, x.amount, 'Loan repayment' || coalesce(': ' || x.reference, ''),
           x.review_status::text, x.query_note, x.created_by
      from public.staff_loan_repayments x where x.review_status in ('recorded', 'queried')
    union all
    select 'director_transactions', x.id, x.txn_date, x.amount, d.full_name || ': ' || coalesce(x.description, replace(x.type, '_', ' ')),
           x.review_status::text, x.query_note, x.created_by
      from public.director_transactions x join public.directors d on d.id = x.director_id
     where x.review_status in ('recorded', 'queried')
    union all
    select 'director_payments', x.id, x.payment_date, x.net_amount, 'Payment to ' || d.full_name || ': ' || replace(x.payment_type, '_', ' '),
           x.review_status::text, x.query_note, x.created_by
      from public.director_payments x join public.directors d on d.id = x.director_id
     where x.review_status in ('recorded', 'queried') and x.status = 'paid'
    union all
    select 'statutory_payments', x.id, x.payment_date, x.amount, 'Statutory payment' || coalesce(': ' || x.reference, ''),
           x.review_status::text, x.query_note, x.created_by
      from public.statutory_payments x where x.review_status in ('recorded', 'queried') and x.status = 'paid'
    union all
    select 'payroll_runs', r.id, r.period_month, null::numeric, 'Payroll run ' || to_char(r.period_month, 'Mon YYYY'),
           r.review_status::text, r.query_note, r.created_by
      from public.payroll_runs r where r.review_status in ('recorded', 'queried') and r.status in ('approved', 'issued')
    union all
    select 'receipts', r.id, r.receipt_date, r.cash_amount, 'Confirmed by the Owner: payment from ' || c.name,
           r.review_status::text, null, r.confirmed_by
      from public.receipts r join public.clients c on c.id = r.client_id
     where r.status = 'confirmed' and r.review_status = 'recorded')
  select q.t, q.id, q.d, q.a, q.dsc, q.rs, q.qn, pr.full_name
  from q left join public.profiles pr on pr.user_id = q.cb
  where p_month is null or (q.d >= s and q.d < e)
  order by q.d, q.t;
end $$;
revoke execute on function public.entries_to_review(date) from public, anon;
grant execute on function public.entries_to_review(date) to authenticated;
