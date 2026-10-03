-- Leave and setup fixes, 3 Oct 2026 (D-046..D-050).
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------------------
-- D-046: entitlement kinds
-- ---------------------------------------------------------------------------
do $$ begin
  perform tests.eq((select string_agg(name || '=' || entitlement_kind || coalesce(':' || event_entitled_days, ''), ', ' order by sort_order) from public.leave_types),
    'Annual=annual, Sick=capped, Maternity=per_event:60.0, Paternity=per_event:5.0, Compassionate/bereavement=capped, Study/exam=capped, Unpaid=none, Other=none',
    'D-046: each leave type has its kind; Maternity 12 weeks (60 working days), Paternity 5');
  perform tests.ok((select bool_and(requires_document) from public.leave_types where entitlement_kind = 'per_event'),
                   'D-046: Maternity and Paternity need a supporting document');
end $$;

update public.leave_types set default_entitled_days = 10 where name = 'Sick';
update public.leave_types set default_entitled_days = 5 where name = 'Paternity';   -- must still create nothing
update public.staff set end_date = '2029-06-30' where full_name = 'NSP2 - Technical';
select tests.login('owner@t');
set role authenticated;
select public.set_up_leave_year(2029);
do $$
declare nsp2 uuid := (select id from public.staff where full_name = 'NSP2 - Technical');
begin
  perform tests.eq((select entitled_days from public.leave_entitlements e join public.leave_types t on t.id = e.leave_type_id
                    where e.staff_id = nsp2 and e.leave_year = 2029 and t.name = 'Sick'), 10.0,
                   'D-046: a yearly cap is given in full, not pro-rated, even for someone leaving mid-year');
  perform tests.eq((select entitled_days from public.leave_entitlements e join public.leave_types t on t.id = e.leave_type_id
                    where e.staff_id = nsp2 and e.leave_year = 2029 and t.name = 'Annual'), 7.5,
                   'D-046: only Annual is pro-rated (15 x 181/365, to the half day)');
  perform tests.eq((select count(*)::int from public.leave_entitlements e join public.leave_types t on t.id = e.leave_type_id
                    where e.leave_year = 2029 and t.entitlement_kind in ('per_event', 'none')), 0,
                   'D-046: no yearly entitlement for Maternity, Paternity, Unpaid or Other');
  perform tests.ok(not exists (select 1 from public.leave_balances where leave_year = 2029 and entitlement_kind not in ('annual', 'capped')),
                   'D-046: and they''re not in the balances');
end $$;
reset role;

-- Per-event leave: up to the entitlement per event; document before approval.
select tests.login('ernest@t', 'aal1');
set role authenticated;
do $$ begin
  perform tests.throws($q$insert into public.leave_requests (staff_id, leave_type_id, start_date, end_date)
    values (app.my_staff_id(), (select id from public.leave_types where name = 'Paternity'), '2029-03-05', '2029-03-12')$q$,
    '%up to 5 working days for each event%', 'D-046: Paternity is up to 5 working days per event');
end $$;
insert into public.leave_requests (staff_id, leave_type_id, start_date, end_date, reason)
values (app.my_staff_id(), (select id from public.leave_types where name = 'Paternity'), '2029-03-05', '2029-03-09', 'Paternity test');
reset role;
select tests.login('francis@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.leave_requests set status = 'approved' where reason = 'Paternity test'$q$,
                       '%Attach the supporting document%', 'D-046: per-event leave needs its document before approval');
end $$;
update public.leave_requests set document_path = 'leave_requests/x/birth-certificate.pdf' where reason = 'Paternity test';
update public.leave_requests set status = 'approved' where reason = 'Paternity test';
do $$ begin
  perform tests.eq((select status from public.leave_requests where reason = 'Paternity test'), 'approved', 'D-046: then it can be approved');
end $$;
reset role;

-- Yearly caps: going over needs the Owner, as for Annual leave.
select tests.login('owner@t');
set role authenticated;
select public.set_up_leave_year(2030);
reset role;
select tests.login('ernest@t', 'aal1');
set role authenticated;
insert into public.leave_requests (staff_id, leave_type_id, start_date, end_date, reason)
values (app.my_staff_id(), (select id from public.leave_types where name = 'Sick'), '2030-03-04', '2030-03-19', 'Long illness');
reset role;
select tests.login('francis@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$update public.leave_requests set status = 'approved' where reason = 'Long illness'$q$,
                       '%over the yearly Sick leave limit%Owner%', 'D-046: over the yearly cap needs the Owner');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- D-047: deleting entitlements
-- ---------------------------------------------------------------------------
select tests.login('owner@t');
set role authenticated;
do $$
declare
  sick uuid := (select e.id from public.leave_entitlements e join public.leave_types t on t.id = e.leave_type_id
                join public.staff s on s.id = e.staff_id where s.full_name = 'Ernest Gbadago' and e.leave_year = 2030 and t.name = 'Sick');
  annual uuid := (select e.id from public.leave_entitlements e join public.leave_types t on t.id = e.leave_type_id
                  join public.staff s on s.id = e.staff_id where s.full_name = 'Ibrahim Commedan' and e.leave_year = 2030 and t.name = 'Annual');
begin
  perform tests.throws(format($q$delete from public.leave_entitlements where id = %L$q$, sick), '%taken or booked%',
                       'D-047: an entitlement with leave booked against it can''t be deleted');
  delete from public.leave_entitlements where id = annual;
  perform tests.ok(not exists (select 1 from public.leave_entitlements where id = annual), 'D-047: an unused one can');
  perform tests.ok(exists (select 1 from public.audit_log where table_name = 'leave_entitlements' and action = 'DELETE' and record_id = annual::text),
                   'D-047: and the deletion is logged');
end $$;
reset role;
select tests.login('francis@t');
set role authenticated;
do $$ begin
  perform tests.eq(tests.rows($q$delete from public.leave_entitlements where leave_year = 2030$q$), 0, 'D-047: only the Owner deletes');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- D-049: fees received on the same (net) basis as fees invoiced
-- ---------------------------------------------------------------------------
select tests.login('owner@t');
set role authenticated;
insert into public.clients (name, type) values ('Net basis client', 'corporate');
insert into public.jobs (title, client_id, fee) select 'Net basis job', id, 10000 from public.clients where name = 'Net basis client';
insert into public.invoices (job_id, invoice_date, notes) select id, app.today(), 'net basis' from public.jobs where title = 'Net basis job';
insert into public.invoice_lines (invoice_id, description, tax_code_id, net_amount)
select id, 'Design fee', (select id from public.tax_codes where name = 'Standard'), 10000 from public.invoices where notes = 'net basis';
update public.invoices set status = 'approved' where notes = 'net basis';
do $$ begin perform set_config('tests.recv', (public.money_panel() -> 'fees_this_month' ->> 'received'), false); end $$;
select public.quick_log_payment((select gross_total from public.invoices where notes = 'net basis'), app.today(),
                                (select id from public.invoices where notes = 'net basis'));
update public.receipts set account_id = (select id from public.accounts where name = 'GCB operating'), method = 'bank_transfer'
 where id = (select a.receipt_id from public.receipt_allocations a join public.invoices i on i.id = a.invoice_id where i.notes = 'net basis');
update public.receipts set status = 'confirmed'
 where id = (select a.receipt_id from public.receipt_allocations a join public.invoices i on i.id = a.invoice_id where i.notes = 'net basis');
do $$ begin
  perform tests.eq((public.money_panel() -> 'fees_this_month' ->> 'received')::numeric - current_setting('tests.recv')::numeric, 10000.00,
                   'D-049: a payment of the full VAT-inclusive invoice counts as its 10,000 net fee received');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- D-050: the company phone
-- ---------------------------------------------------------------------------
do $$ begin
  perform tests.eq((select company_phone from public.settings_versions order by effective_from limit 1), '+233 56 071 2012',
                   'D-050: the company phone is filled in for the invoice header');
end $$;
