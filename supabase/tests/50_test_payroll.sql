-- Phase A acceptance tests: payroll import, checks, approval, payslips.
-- Brief §13 items 20, 21; D-022..D-024. Uses August 2026.
\set ON_ERROR_STOP 1

-- A staff loan for Ernest: GHS 3,000 at GHS 500 a month, issued in July.
select tests.login('acct@t');
set role authenticated;
insert into public.staff_loans (staff_id, amount, purpose, monthly_instalment, first_deduction_month)
select id, 3000, 'School fees', 500, '2026-08-01' from public.staff where full_name = 'Ernest Gbadago';
reset role;
select tests.login('owner@t');
set role authenticated;
update public.staff_loans set status = 'approved';
update public.staff_loans set status = 'paid', payment_date = '2026-07-15', method = 'bank_transfer',
  account_id = (select id from public.accounts where name = 'GCB operating');
reset role;

-- The Accountant imports August: staff sheet + NSP sheet into one run (D-022),
-- but the import misses Ibrahim.
select tests.login('acct@t');
set role authenticated;
insert into public.payroll_runs (period_month, source_files)
values ('2026-08-01', '["payroll/2026-08/staff.csv", "payroll/2026-08/nsp.csv"]');
insert into public.payroll_lines (run_id, staff_id, sheet_kind, basic, gross, ssnit_employee, taxable_income, paye,
                                  net_pay, loan_deduction, bank_amount, ssnit_employer, sheet_cost_to_company)
select r.id, s.id, case when s.is_national_service then 'nsp' else 'staff' end,
       v.basic, v.basic,
       case when s.is_national_service then 0 else round(v.basic * 0.055, 2) end,
       v.basic - case when s.is_national_service then 0 else round(v.basic * 0.055, 2) end,
       v.paye,
       v.basic - case when s.is_national_service then 0 else round(v.basic * 0.055, 2) end - v.paye,
       0,
       v.basic - case when s.is_national_service then 0 else round(v.basic * 0.055, 2) end - v.paye,
       case when s.is_national_service then 0 else round(v.basic * 0.13, 2) end,
       v.basic + case when s.is_national_service then 0 else round(v.basic * 0.13, 2) end
from public.payroll_runs r
cross join (values ('Kwasi Dadzie Ennison', 18000, 3500), ('Francis Austin', 6600, 900), ('Ernest Gbadago', 3600, 300),
                   ('Nana Poku', 1200, 0), ('NSP1 - Technical', 1200, 0), ('NSP2 - Technical', 1200, 0),
                   ('NSP3 - Admin', 1200, 0)) v(name, basic, paye)
join public.staff s on s.full_name = v.name;
do $$
declare run uuid := (select id from public.payroll_runs);
begin
  perform tests.ok(exists (select 1 from public.payroll_checks(run) where code = 'missing_staff' and staff_name = 'Ibrahim Commedan'),
                   '20: missing staff member is caught');
  perform tests.ok(exists (select 1 from public.payroll_checks(run) where code = 'loan_instalment_missing' and staff_name = 'Ernest Gbadago'),
                   '20: loan instalment due must appear as a deduction');
  perform tests.throws($q$update public.payroll_runs set status = 'approved'$q$, '%Only the Owner approves payroll%', '20: accountant cannot approve');
end $$;
reset role;
select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.payroll_runs set status = 'approved'$q$, '%fails its checks%', '20: a run with a missing person cannot be approved');
end $$;
reset role;

-- Accountant adds Ibrahim manually, but with a net that doesn't add up.
select tests.login('acct@t');
set role authenticated;
insert into public.payroll_lines (run_id, staff_id, source, basic, gross, ssnit_employee, taxable_income, paye, net_pay, bank_amount, ssnit_employer)
select r.id, s.id, 'manual', 3600, 3600, 198, 3402, 300, 3200, 3200, 468
from public.payroll_runs r, public.staff s where s.full_name = 'Ibrahim Commedan';
do $$ begin
  perform tests.ok(exists (select 1 from public.payroll_checks((select id from public.payroll_runs)) where code = 'net_mismatch'),
                   '20: gross - deductions <> net is caught');
end $$;
reset role;
select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.payroll_runs set status = 'approved'$q$, '%fails its checks%', '20: a run with a net mismatch cannot be approved');
end $$;
reset role;

-- Fix: Ibrahim's net 3,102; Ernest's loan deduction 500; sheet totals match.
select tests.login('acct@t');
set role authenticated;
update public.payroll_lines set net_pay = 3102, bank_amount = 3102
where staff_id = (select id from public.staff where full_name = 'Ibrahim Commedan');
update public.payroll_lines set loan_deduction = 500, bank_amount = net_pay - 500
where staff_id = (select id from public.staff where full_name = 'Ernest Gbadago');
update public.payroll_runs set sheet_totals = jsonb_build_object(
  'gross', (select sum(gross) from public.payroll_lines),
  'net_pay', (select sum(net_pay) + 0.01 from public.payroll_lines),    -- the sheet's 0.01 rounding (D-023)
  'paye', (select sum(paye) from public.payroll_lines));
do $$ begin
  perform tests.eq((select count(*)::int from public.payroll_checks((select id from public.payroll_runs)) where severity = 'blocking'), 0,
                   '20: corrected run passes every check (totals within tolerance)');
  perform tests.eq((select tier1_amount + tier2_amount from public.payroll_lines l join public.staff s on s.id = l.staff_id
                    where s.full_name = 'Francis Austin'), round(6600 * 0.055, 2) + round(6600 * 0.13, 2), 'D-024: Tier 1 + Tier 2 = total SSNIT');
  perform tests.eq((select tier1_amount from public.payroll_lines l join public.staff s on s.id = l.staff_id
                    where s.full_name = 'NSP1 - Technical'), 0.00, 'D-024: national service persons have no SSNIT tiers');
end $$;
update public.payroll_runs set sheet_totals = sheet_totals || '{"paye": 1}';
do $$ begin
  perform tests.ok(exists (select 1 from public.payroll_checks((select id from public.payroll_runs)) where code = 'total_mismatch'),
                   '20: totals must match the sheet');
end $$;
update public.payroll_runs set sheet_totals = sheet_totals || jsonb_build_object('paye', (select sum(paye) from public.payroll_lines));
reset role;

select tests.login('owner@t');
set role authenticated;
update public.payroll_runs set status = 'approved';
reset role;
do $$
declare run uuid := (select id from public.payroll_runs);
begin
  perform tests.eq((select amount_due from public.statutory_lines where auto_key = 'paye:' || run), 5000.00, '20: PAYE line created on approval');
  perform tests.eq((select due_date from public.statutory_lines where auto_key = 'paye:' || run), '2026-09-15'::date, '20: PAYE due 15 September');
  perform tests.eq((select amount_due from public.statutory_lines where auto_key = 'ssnit_tier1:' || run)
                 + (select amount_due from public.statutory_lines where auto_key = 'ssnit_tier2:' || run),
                   (select sum(ssnit_employee + ssnit_employer) from public.payroll_lines), '20: SSNIT Tier 1 and Tier 2 lines created');
  perform tests.eq((select sum(amount) from public.staff_loan_repayments where method = 'salary_deduction'), 500.00, '20: loan repayment recorded from the deduction');
  perform tests.eq(app.loan_balance((select id from public.staff_loans)), 2500.00, '20: loan balance reduced');
  perform tests.eq((select count(*)::int from public.ledger_entries where source_type = 'payroll_run'), 0, 'A-012: net pay posts only when paid');
end $$;
select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.payroll_lines set paye = 0$q$, '%locked%', '20: approved lines are locked');
end $$;
update public.payroll_runs set paid_date = '2026-08-28', account_id = (select id from public.accounts where name = 'GCB operating');
update public.payroll_runs set status = 'issued';
reset role;
do $$ begin
  perform tests.eq((select -amount from public.ledger_entries where source_type = 'payroll_run'),
                   (select sum(bank_amount) from public.payroll_lines), 'A-012: bank amounts leave the account when paid');
  perform tests.eq((select count(*)::int from public.payslips), 8, '20: one payslip per person');
  perform tests.eq((select count(*)::int from public.payslips where is_allowance_statement), 4, '20: national service allowance statements');
end $$;

-- 21: staff see only their own payslips; issued payslips can't be edited
select tests.login('ernest@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.payslips), 1, '21: staff sees only their own payslip');
  perform tests.eq((select count(*)::int from public.payslips p join public.staff s on s.id = p.staff_id
                    where s.full_name = 'Ibrahim Commedan'), 0, '21: another person''s payslip returns nothing');
  perform tests.eq((select count(*)::int from public.payroll_lines), 1, '21: and only their own payroll line');
  perform tests.eq((select loan_deduction from public.payroll_lines), 500.00, '21: own deductions visible');
  perform tests.eq((select count(*)::int from public.notifications where kind = 'payslip_ready'), 1, '21: told the payslip is ready, with a link');
  perform tests.eq(tests.rows($q$update public.payslips set ytd = '{}'$q$), 0, '21: staff cannot edit a payslip');
end $$;
reset role;
do $$ begin
  perform tests.throws($q$update public.payslips set ytd = '{}'$q$, '%locked%', '21: issued payslips are locked, even for the service role');
end $$;
select tests.login('owner@t');
set role authenticated;
update public.director_hidden_areas set hidden = true where area = 'salaries';
reset role;
select tests.login('kofi@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.payslips), 0, 'D-017: hidden salaries: director sees no payslips');
  perform tests.eq((select count(*)::int from public.payroll_runs), 1, 'D-017: run totals still visible');
end $$;
reset role;
select set_config('request.jwt.claims', '', false);
update public.director_hidden_areas set hidden = false;
