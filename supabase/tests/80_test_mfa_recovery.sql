-- Two-factor recovery: an audited reset, never reachable from the API.
\set ON_ERROR_STOP 1

insert into auth.mfa_factors (user_id, friendly_name) values
  (tests.uid('acct@t'), 'Phone'), (tests.uid('acct@t'), 'Backup'), (tests.uid('owner@t'), 'Phone');

select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.throws($q$select app.reset_mfa('owner@t', 'x')$q$, '%permission denied%', 'API roles cannot reset 2FA');
end $$;
reset role;
select set_config('request.jwt.claims', '', false);

do $$ begin
  perform tests.throws($q$select app.reset_mfa('acct@t', '')$q$, '%reason%', 'a reset needs a reason');
  perform tests.throws($q$select app.reset_mfa('nobody@t', 'x')$q$, '%No log-in%', 'unknown email is rejected');
  perform tests.eq(app.reset_mfa('ACCT@t', 'Phone lost on site visit'),
    '2 authenticator(s) removed for ACCT@t. They set up a new one at their next sign-in.', 'reset removes every authenticator');
  perform tests.eq((select count(*)::int from auth.mfa_factors where user_id = tests.uid('acct@t')), 0, 'accountant has no authenticator left');
  perform tests.eq((select count(*)::int from auth.mfa_factors where user_id = tests.uid('owner@t')), 1, 'nobody else is affected');
  perform tests.eq((select new_data ->> 'reason' from public.audit_log where table_name = 'auth.mfa_factors'),
    'Phone lost on site visit', 'the reset is in the audit log with its reason');
end $$;
