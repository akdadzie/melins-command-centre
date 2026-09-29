-- User provisioning: invites create profiles; the first Owner is bootstrapped once.
\set ON_ERROR_STOP 1

-- An Owner already exists from 10_test_access, so bootstrap refuses.
do $$ begin
  perform tests.throws($q$select app.bootstrap_owner('owner@t')$q$, '%already exists%', 'bootstrap refuses when an Owner exists');
end $$;

-- An invite with metadata (as the invite-user Edge Function sends) creates the profile.
insert into auth.users (email, raw_user_meta_data)
values ('NSP1@T', jsonb_build_object('full_name', 'NSP1 - Technical', 'role', 'staff',
        'staff_id', (select id from public.staff where full_name = 'NSP1 - Technical')));
-- A log-in without a role gets no profile.
insert into auth.users (email) values ('stray@t');
do $$ begin
  perform tests.eq((select role::text from public.profiles where email = 'nsp1@t'), 'staff', 'invite creates the profile with its role');
  perform tests.eq((select email from public.staff where full_name = 'NSP1 - Technical'), 'nsp1@t', 'invite links the staff record');
  perform tests.eq((select count(*)::int from public.profiles where email = 'stray@t'), 0, 'no role in the invite, no profile');
end $$;

-- Only the Owner sees the user directory.
select tests.login('owner@t');
set role authenticated;
do $$ begin
  perform tests.ok((select count(*) from public.user_directory) >= 9, 'owner sees the user directory');
end $$;
reset role;
select tests.login('acct@t');
set role authenticated;
do $$ begin
  perform tests.eq((select count(*)::int from public.user_directory), 0, 'accountant does not see the user directory');
  perform tests.throws($q$select app.bootstrap_owner('x@t')$q$, '%permission denied%', 'API roles cannot call bootstrap');
end $$;
reset role;
select set_config('request.jwt.claims', '', false);
