-- =============================================================================
-- 1200 Two-factor recovery (docs/ACCESS_RECOVERY.md).
-- Removing someone's authenticator makes the app ask them to set up a new one
-- at their next sign-in (they still need their password). Every reset is
-- written to the audit log with who asked and why.
--  * app.reset_mfa(email, reason): run from the Supabase SQL editor. This is
--    how the Owner recovers their own access; it's never reachable from the API.
--  * The reset-mfa Edge Function lets the Owner (signed in with 2FA) reset
--    anyone else's from Settings > Users.
-- =============================================================================
create or replace function app.reset_mfa(p_email text, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  n int;
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give the reason for resetting two-factor sign-in';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No log-in for %', p_email; end if;
  delete from auth.mfa_factors where user_id = uid;
  get diagnostics n = row_count;
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values ('auth.mfa_factors', uid::text, 'DELETE',
          jsonb_build_object('factors_removed', n),
          jsonb_build_object('email', lower(trim(p_email)), 'reason', p_reason, 'via', coalesce(nullif(current_setting('app.reset_via', true), ''), 'sql_editor')),
          auth.uid());
  return format('%s authenticator(s) removed for %s. They set up a new one at their next sign-in.', n, p_email);
end $$;

revoke execute on function app.reset_mfa(text, text) from public, anon, authenticated;
