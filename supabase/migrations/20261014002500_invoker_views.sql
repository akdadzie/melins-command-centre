-- =============================================================================
-- 2500 Security Advisor: no SECURITY DEFINER views (D-057). Supersedes A-029.
-- * 15 views now run as the caller (security_invoker), so the RLS on the
--   tables underneath applies. For each one, every role gets exactly what it
--   got before: checked role by role against the full test data.
-- * 10 views show a role rows or columns its RLS can't read (an Admin's
--   account picker, a staff member's own jobs, the company letterhead, the
--   leave calendar, ...). Their query moved, unchanged, into a role-checked
--   SECURITY DEFINER function app.<view>_rows() in the app schema, which the
--   API doesn't expose. The view keeps its name and columns and runs as the
--   caller over that function, so the app doesn't change.
-- * A-019: Admin gets no totals. job_money_status, retention_by_job and
--   job_milestone_check no longer return rows to Admin.
-- * anon has no privilege on any view or app._rows() function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Views backed by a role-checked function
-- -----------------------------------------------------------------------------
create function app.account_picker_rows()
returns table (id uuid, name text, type text)
language sql stable security definer set search_path = '' as $$
SELECT id,
    name,
    type
   FROM public.accounts a
  WHERE is_active AND (app.has_role(VARIADIC ARRAY['owner'::public.app_role, 'accountant'::public.app_role]) OR app.has_role(VARIADIC ARRAY['admin'::public.app_role]) AND admin_may_post)
$$;
revoke execute on function app.account_picker_rows() from public, anon;
grant execute on function app.account_picker_rows() to authenticated, service_role;
create or replace view public.account_picker with (security_invoker = on, security_barrier) as
  select id, name, type
  from app.account_picker_rows();

create function app.company_profile_rows()
returns table (registered_name text, tin text, vat_number text, address text, accounts_email text, invoice_payment_details text, invoice_terms_days integer, effective_from date, company_phone text, company_email text, company_website text, payment_bank_name text, payment_bank_branch text, payment_bank_account_number text, payment_bank_account_name text, payment_momo_network text, payment_momo_number text, payment_momo_account_name text, payment_momo_note text)
language sql stable security definer set search_path = '' as $$
SELECT registered_name,
    tin,
    vat_number,
    address,
    accounts_email,
    invoice_payment_details,
    invoice_terms_days,
    effective_from,
    company_phone,
    COALESCE(company_email, accounts_email) AS company_email,
    company_website,
    payment_bank_name,
    payment_bank_branch,
    payment_bank_account_number,
    payment_bank_account_name,
    payment_momo_network,
    payment_momo_number,
    payment_momo_account_name,
    payment_momo_note
   FROM public.settings_versions s
  WHERE app.my_role() IS NOT NULL AND effective_from = (( SELECT max(settings_versions.effective_from) AS max
           FROM public.settings_versions
          WHERE settings_versions.effective_from <= app.today()))
$$;
revoke execute on function app.company_profile_rows() from public, anon;
grant execute on function app.company_profile_rows() to authenticated, service_role;
create or replace view public.company_profile with (security_invoker = on, security_barrier) as
  select registered_name, tin, vat_number, address, accounts_email, invoice_payment_details, invoice_terms_days, effective_from, company_phone, company_email, company_website, payment_bank_name, payment_bank_branch, payment_bank_account_number, payment_bank_account_name, payment_momo_network, payment_momo_number, payment_momo_account_name, payment_momo_note
  from app.company_profile_rows();

create function app.job_money_status_rows()
returns table (job_id uuid, job_number text, fee numeric(14,2), invoiced_net numeric, billed_due numeric, settled numeric, money_status text)
language sql stable security definer set search_path = '' as $$
SELECT j.id AS job_id,
    j.job_number,
    j.fee,
    COALESCE(sum(i.net_total) FILTER (WHERE i.status <> 'draft'::text), 0::numeric) AS invoiced_net,
    COALESCE(sum(i.gross_total - i.retention_amount - i.credited_total) FILTER (WHERE i.status <> 'draft'::text), 0::numeric) AS billed_due,
    COALESCE(sum(i.settled_total) FILTER (WHERE i.status <> 'draft'::text), 0::numeric) AS settled,
        CASE
            WHEN count(i.id) FILTER (WHERE i.status <> 'draft'::text) = 0 THEN 'not_invoiced'::text
            WHEN COALESCE(sum(i.outstanding) FILTER (WHERE i.status <> 'draft'::text), 0::numeric) = 0::numeric AND COALESCE(sum(i.net_total) FILTER (WHERE i.status <> 'draft'::text), 0::numeric) >= COALESCE(j.fee, 0::numeric) THEN 'paid'::text
            WHEN COALESCE(sum(i.settled_total) FILTER (WHERE i.status <> 'draft'::text), 0::numeric) > 0::numeric THEN 'part_paid'::text
            WHEN COALESCE(sum(i.net_total) FILTER (WHERE i.status <> 'draft'::text), 0::numeric) >= COALESCE(j.fee, 0::numeric) THEN 'fully_invoiced'::text
            ELSE 'part_invoiced'::text
        END AS money_status
   FROM public.jobs j
     LEFT JOIN public.invoices i ON i.job_id = j.id
  WHERE app.has_role(VARIADIC ARRAY['owner'::public.app_role, 'director'::public.app_role, 'accountant'::public.app_role, 'project_lead'::public.app_role])
  GROUP BY j.id
$$;
revoke execute on function app.job_money_status_rows() from public, anon;
grant execute on function app.job_money_status_rows() to authenticated, service_role;
create or replace view public.job_money_status with (security_invoker = on, security_barrier) as
  select job_id, job_number, fee::numeric(14,2) as fee, invoiced_net, billed_due, settled, money_status
  from app.job_money_status_rows();

create function app.leave_calendar_rows()
returns table (id uuid, full_name text, start_date date, end_date date)
language sql stable security definer set search_path = '' as $$
SELECT r.id,
    s.full_name,
    r.start_date,
    r.end_date
   FROM public.leave_requests r
     JOIN public.staff s ON s.id = r.staff_id
  WHERE app.my_role() IS NOT NULL AND (r.status = ANY (ARRAY['approved'::text, 'taken'::text]))
$$;
revoke execute on function app.leave_calendar_rows() from public, anon;
grant execute on function app.leave_calendar_rows() to authenticated, service_role;
create or replace view public.leave_calendar with (security_invoker = on, security_barrier) as
  select id, full_name, start_date, end_date
  from app.leave_calendar_rows();

create function app.my_jobs_rows()
returns table (id uuid, job_number text, title text, delivery_status text, start_date date, due_date date, percent_complete numeric(5,2), client_name text)
language sql stable security definer set search_path = '' as $$
SELECT j.id,
    j.job_number,
    j.title,
    j.delivery_status,
    j.start_date,
    j.due_date,
    j.percent_complete,
    c.name AS client_name
   FROM public.jobs j
     JOIN public.clients c ON c.id = j.client_id
  WHERE app.my_role() IS NOT NULL AND app.on_my_job(j.id)
$$;
revoke execute on function app.my_jobs_rows() from public, anon;
grant execute on function app.my_jobs_rows() to authenticated, service_role;
create or replace view public.my_jobs with (security_invoker = on, security_barrier) as
  select id, job_number, title, delivery_status, start_date, due_date, percent_complete::numeric(5,2) as percent_complete, client_name
  from app.my_jobs_rows();

create function app.ready_to_invoice_rows()
returns table (item_type text, item_id uuid, job_id uuid, job_number text, job_title text, description text, amount numeric, ready_since date)
language sql stable security definer set search_path = '' as $$
SELECT 'milestone'::text AS item_type,
    m.id AS item_id,
    j.id AS job_id,
    j.job_number,
    j.title AS job_title,
    m.name AS description,
    m.amount,
    m.reached_on AS ready_since
   FROM public.billing_milestones m
     JOIN public.jobs j ON j.id = m.job_id
  WHERE app.has_role(VARIADIC ARRAY['owner'::public.app_role, 'director'::public.app_role, 'accountant'::public.app_role, 'admin'::public.app_role, 'project_lead'::public.app_role]) AND m.status = 'reached'::text AND NOT (EXISTS ( SELECT 1
           FROM public.invoice_lines l
             JOIN public.invoices i ON i.id = l.invoice_id
          WHERE l.billing_milestone_id = m.id AND i.status <> 'draft'::text))
UNION ALL
 SELECT 'rechargeable_expense'::text AS item_type,
    e.id AS item_id,
    j.id AS job_id,
    j.job_number,
    j.title AS job_title,
    e.description,
    round(
        CASE
            WHEN e.input_vat_claimable > 0::numeric THEN e.net_amount
            ELSE e.amount
        END * (1::numeric + e.recharge_markup_pct / 100::numeric), 2) AS amount,
    e.expense_date AS ready_since
   FROM public.expenses e
     JOIN public.jobs j ON j.id = e.job_id
  WHERE app.has_role(VARIADIC ARRAY['owner'::public.app_role, 'director'::public.app_role, 'accountant'::public.app_role, 'admin'::public.app_role, 'project_lead'::public.app_role]) AND e.rechargeable AND e.entry_status = 'confirmed'::text AND NOT (EXISTS ( SELECT 1
           FROM public.invoice_lines l
          WHERE l.expense_id = e.id))
$$;
revoke execute on function app.ready_to_invoice_rows() from public, anon;
grant execute on function app.ready_to_invoice_rows() to authenticated, service_role;
create or replace view public.ready_to_invoice with (security_invoker = on, security_barrier) as
  select item_type, item_id, job_id, job_number, job_title, description, amount, ready_since
  from app.ready_to_invoice_rows();

create function app.receipt_tasks_rows()
returns table (action_id uuid, status text, statement_line_id uuid, line_date date, amount numeric(14,2), description text, reference text)
language sql stable security definer set search_path = '' as $$
SELECT a.id AS action_id,
    a.status,
    sl.id AS statement_line_id,
    sl.line_date,
    sl.amount,
    sl.description,
    sl.reference
   FROM public.action_items a
     JOIN public.statement_lines sl ON sl.id = a.record_id
  WHERE a.kind = 'record_receipt'::text AND app.has_role(VARIADIC ARRAY['owner'::public.app_role, 'accountant'::public.app_role, 'admin'::public.app_role])
$$;
revoke execute on function app.receipt_tasks_rows() from public, anon;
grant execute on function app.receipt_tasks_rows() to authenticated, service_role;
create or replace view public.receipt_tasks with (security_invoker = on, security_barrier) as
  select action_id, status, statement_line_id, line_date, amount::numeric(14,2) as amount, description, reference
  from app.receipt_tasks_rows();

create function app.staff_loan_picker_rows()
returns table (id uuid, full_name text, monthly_instalment numeric(14,2), loan_date date)
language sql stable security definer set search_path = '' as $$
SELECT l.id,
    st.full_name,
    l.monthly_instalment,
    l.payment_date AS loan_date
   FROM public.staff_loans l
     JOIN public.staff st ON st.id = l.staff_id
  WHERE app.has_role(VARIADIC ARRAY['owner'::public.app_role, 'accountant'::public.app_role, 'admin'::public.app_role]) AND l.status = 'paid'::public.payout_status AND l.cleared_at IS NULL
$$;
revoke execute on function app.staff_loan_picker_rows() from public, anon;
grant execute on function app.staff_loan_picker_rows() to authenticated, service_role;
create or replace view public.staff_loan_picker with (security_invoker = on, security_barrier) as
  select id, full_name, monthly_instalment::numeric(14,2) as monthly_instalment, loan_date
  from app.staff_loan_picker_rows();

create function app.supplier_bills_open_rows()
returns table (id uuid, expense_date date, supplier_id uuid, supplier_name text, description text, amount numeric(14,2), outstanding numeric)
language sql stable security definer set search_path = '' as $$
SELECT e.id,
    e.expense_date,
    e.supplier_id,
    s.name AS supplier_name,
    e.description,
    e.amount,
    app.bill_outstanding(e.id) AS outstanding
   FROM public.expenses e
     JOIN public.suppliers s ON s.id = e.supplier_id
  WHERE app.has_role(VARIADIC ARRAY['owner'::public.app_role, 'director'::public.app_role, 'accountant'::public.app_role, 'admin'::public.app_role]) AND e.payment_source = 'supplier_payable'::text AND e.entry_status = 'confirmed'::text AND app.bill_outstanding(e.id) > 0::numeric
$$;
revoke execute on function app.supplier_bills_open_rows() from public, anon;
grant execute on function app.supplier_bills_open_rows() to authenticated, service_role;
create or replace view public.supplier_bills_open with (security_invoker = on, security_barrier) as
  select id, expense_date, supplier_id, supplier_name, description, amount::numeric(14,2) as amount, outstanding
  from app.supplier_bills_open_rows();

create function app.timesheet_charge_out_rows()
returns table (entry_id uuid, charge_out_rate numeric(12,2))
language sql stable security definer set search_path = '' as $$
SELECT entry_id,
    charge_out_rate
   FROM public.timesheet_rate_snapshots s
  WHERE app.has_role(VARIADIC ARRAY['owner'::public.app_role, 'director'::public.app_role, 'accountant'::public.app_role, 'project_lead'::public.app_role])
$$;
revoke execute on function app.timesheet_charge_out_rows() from public, anon;
grant execute on function app.timesheet_charge_out_rows() to authenticated, service_role;
create or replace view public.timesheet_charge_out with (security_invoker = on, security_barrier) as
  select entry_id, charge_out_rate::numeric(12,2) as charge_out_rate
  from app.timesheet_charge_out_rows();

-- -----------------------------------------------------------------------------
-- Views that run as the caller
-- -----------------------------------------------------------------------------
-- No longer for Admin (A-019: no totals).
create or replace view public.retention_by_job with (security_invoker = on, security_barrier) as
SELECT j.id AS job_id,
    j.job_number,
    j.title,
    c.id AS client_id,
    c.name AS client_name,
    j.retention_pct,
    j.retention_release_terms,
    j.retention_release_date,
    app.job_retention_held(j.id) AS retention_held
   FROM public.jobs j
     JOIN public.clients c ON c.id = j.client_id
  WHERE app.has_role(VARIADIC ARRAY['owner'::public.app_role, 'director'::public.app_role, 'accountant'::public.app_role]) AND app.job_retention_held(j.id) > 0::numeric;

-- No longer for Admin (A-019: no totals).
create or replace view public.job_milestone_check with (security_invoker = on, security_barrier) as
SELECT j.id AS job_id,
    j.job_number,
    j.fee,
    COALESCE(sum(m.amount), 0::numeric) AS milestones_total,
    COALESCE(j.fee, 0::numeric) - COALESCE(sum(m.amount), 0::numeric) AS difference
   FROM public.jobs j
     LEFT JOIN public.billing_milestones m ON m.job_id = j.id
  WHERE app.has_role(VARIADIC ARRAY['owner'::public.app_role, 'director'::public.app_role, 'accountant'::public.app_role, 'project_lead'::public.app_role]) AND j.contract_mode = 'consultancy'::text
  GROUP BY j.id
 HAVING abs(COALESCE(j.fee, 0::numeric) - COALESCE(sum(m.amount), 0::numeric)) > 0.005;

alter view public.account_balances set (security_invoker = on);
alter view public.director_balances set (security_invoker = on);
alter view public.invoices_to_chase set (security_invoker = on);
alter view public.job_hours_vs_budget set (security_invoker = on);
alter view public.jobs_flagged set (security_invoker = on);
alter view public.leave_balances set (security_invoker = on);
alter view public.payroll_cost_changes set (security_invoker = on);
alter view public.receivables_ageing set (security_invoker = on);
alter view public.staff_loan_warnings set (security_invoker = on);
alter view public.statutory_ledger set (security_invoker = on);
alter view public.statutory_plans set (security_invoker = on);
alter view public.tax_credit_balances set (security_invoker = on);
alter view public.timesheet_custom_activities set (security_invoker = on);

revoke all on all tables in schema public from anon;
