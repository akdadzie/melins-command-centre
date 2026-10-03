-- =============================================================================
-- 2200 Go-live dates (DECISIONS D-051, D-052)
--  * Timesheets start on production with the soft launch on 12 Oct 2026, so
--    missing days, compliance, utilisation and timesheet reminders count from
--    then (app.system_config.go_live_date, D-034). Money opening balances are
--    unaffected: they stay as at 30 Sep 2026 (D-029).
--  * NSP1-3 start on 1 Nov 2026 (the full go-live), so they aren't chased for
--    October. Their names are filled in when they're known.
-- =============================================================================

update app.system_config set go_live_date = '2026-10-12';

update public.staff set start_date = '2026-11-01'
 where full_name in ('NSP1 - Technical', 'NSP2 - Technical', 'NSP3 - Admin')
   and start_date = '2026-09-01';   -- only the seeded placeholder, never a date someone has set
