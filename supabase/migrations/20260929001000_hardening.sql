-- =============================================================================
-- 1000 Hardening. Internal write helpers are only ever called from SECURITY
-- DEFINER triggers and functions (which run as the owner), so API roles
-- don't need EXECUTE on them. The app schema isn't exposed through the API
-- either; this is a second lock.
-- =============================================================================
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in (
      'post', 'next_number', 'bump_number', 'notify', 'notify_role', 'open_action', 'close_action',
      'enter_system', 'leave_system', 'upsert_statutory_line', 'sync_withholding', 'refresh_invoice',
      'refresh_staff_payment', 'generate_recurring_drafts', 'flag_payment_to_owner', 'receipt_details_task',
      'enable_audit', 'enable_month_lock', 'enable_review', 'enable_payout', 'enable_director_block')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Aggregates through the API stay off (Supabase default), so Admin can't
-- total the per-invoice amounts it may see (brief §4, acceptance 4).
-- Recorded in DECISIONS.md A-019.
