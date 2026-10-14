-- Migration 2500: no SECURITY DEFINER views; Admin and Staff get no money (D-057).
\set ON_ERROR_STOP 1

create or replace function tests.count_rows(p_view text) returns int
language plpgsql as $$
declare n int;
begin
  execute format('select count(*) from public.%I', p_view) into n;
  return n;
end $$;
grant execute on function tests.count_rows(text) to authenticated;

do $$ begin
  perform tests.eq((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind = 'v'
                      and not coalesce(c.reloptions::text[] @> array['security_invoker=on'], false)),
    0, 'every public view runs as the caller');
  perform tests.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('public', 'app') and p.prosecdef
                      and has_function_privilege('anon', p.oid, 'execute') and p.proname like '%\_rows'),
    0, 'anon can execute no app._rows() function');
  perform tests.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.prosecdef
                      and (has_function_privilege('anon', p.oid, 'execute')
                           or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""'))),
    0, 'every public SECURITY DEFINER function: search_path '''' and not for anon');
end $$;

-- Admin: per-item amounts, never a balance or total (A-019)
select tests.login('admin@t', 'aal1');
set role authenticated;
do $$
declare v text;
begin
  foreach v in array array['account_balances', 'director_balances', 'receivables_ageing', 'statutory_ledger',
    'statutory_plans', 'tax_credit_balances', 'payroll_cost_changes', 'staff_loan_warnings', 'job_money_status',
    'retention_by_job', 'job_milestone_check', 'timesheet_charge_out', 'job_hours_vs_budget', 'jobs_flagged'] loop
    perform tests.eq(tests.count_rows(v), 0, 'admin: ' || v);
  end loop;
  perform tests.ok(public.money_panel(null) is null, 'admin: money_panel');
  perform tests.ok((public.running_cost(null)).calculated is null, 'admin: running_cost');
  perform tests.ok(public.monthly_summary(app.today()) is null, 'admin: monthly_summary');
  perform tests.ok(public.accountant_queue() is null, 'admin: accountant_queue');
  perform tests.eq((select count(*)::int from public.vat_workings(app.today())), 0, 'admin: vat_workings');
  perform tests.eq((select count(*)::int from public.entries_to_review(app.today())), 0, 'admin: entries_to_review');
  perform tests.eq((select count(*)::int from public.payroll_checks((select id from public.payroll_runs limit 1))), 0, 'admin: payroll_checks');
  perform tests.ok(tests.count_rows('account_picker') > 0, 'admin: account picker still lists accounts');
  perform tests.eq((select count(*)::int from public.account_picker p join public.accounts a on a.id = p.id), 0, 'admin: picker ids only, not the accounts table');
  perform tests.ok(tests.count_rows('invoices_to_chase') > 0, 'admin: per-invoice outstanding still visible');
  perform tests.throws('select public.close_month(date ''2019-03-01'')', '%Only the Accountant%', 'admin: close_month');
  perform tests.throws('select public.apply_tax_credit(gen_random_uuid(), gen_random_uuid(), 1, ''x'', ''x'')', '%Only the Owner or the Accountant%', 'admin: apply_tax_credit');
end $$;
reset role;

-- Staff: nothing financial; their own jobs, the letterhead and the leave calendar still work
select tests.login('ernest@t', 'aal1');
set role authenticated;
do $$
declare v text;
begin
  foreach v in array array['account_balances', 'account_picker', 'director_balances', 'receivables_ageing',
    'invoices_to_chase', 'ready_to_invoice', 'supplier_bills_open', 'receipt_tasks', 'statutory_ledger',
    'statutory_plans', 'tax_credit_balances', 'payroll_cost_changes', 'staff_loan_picker', 'staff_loan_warnings',
    'job_money_status', 'retention_by_job', 'job_milestone_check', 'timesheet_charge_out', 'job_hours_vs_budget', 'jobs_flagged'] loop
    perform tests.eq(tests.count_rows(v), 0, 'staff: ' || v);
  end loop;
  perform tests.ok(public.money_panel(null) is null, 'staff: money_panel');
  perform tests.ok((public.running_cost(null)).calculated is null, 'staff: running_cost');
  perform tests.eq((select count(*)::int from public.vat_workings(app.today())), 0, 'staff: vat_workings');
  perform tests.eq((select count(*)::int from public.payroll_checks((select id from public.payroll_runs limit 1))), 0, 'staff: payroll_checks');
  perform tests.ok(tests.count_rows('my_jobs') > 0, 'staff: own jobs');
  perform tests.eq(tests.count_rows('company_profile'), 1, 'staff: company letterhead');
  perform tests.ok(tests.count_rows('leave_calendar') > 0, 'staff: leave calendar');
  perform tests.throws('select public.set_up_leave_year(2030)', '%Only the Owner%', 'staff: set_up_leave_year');
  perform tests.throws('select public.reopen_month(date ''2019-03-01'', ''x'')', '%Only the Owner%', 'staff: reopen_month');
end $$;
reset role;
select set_config('request.jwt.claims', '', false);
