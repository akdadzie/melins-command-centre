-- =============================================================================
-- 2300 Acceptance suite on staging: never email test users (D-054).
-- * The staging acceptance suite (acceptance/) creates users at the reserved
--   .invalid domain (RFC 2606). Notifications to them are never emailed, so
--   nothing bounces from noreply@themelins.com.
-- * While a run is in progress the suite sets app.system_config.
--   suppress_email_until a few minutes ahead: notifications created meanwhile
--   (including ones to the real Owner, e.g. "month closed") are in-app only.
--   It's cleared at the end of the run, and expires on its own if a run dies.
-- Neither is ever set on production.
-- =============================================================================

alter table app.system_config add column suppress_email_until timestamptz;

create or replace function app.suppress_test_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.send_email and (
       exists (select 1 from app.system_config where suppress_email_until > now())
    or exists (select 1 from public.profiles where user_id = new.recipient_id and email like '%.invalid')) then
    new.send_email := false;
  end if;
  return new;
end $$;
revoke execute on function app.suppress_test_email() from public, anon, authenticated;

create trigger notifications_suppress_test_email before insert on public.notifications
  for each row execute function app.suppress_test_email();
