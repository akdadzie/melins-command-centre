-- Migration 2300: notifications are never emailed to .invalid addresses, or
-- while an acceptance run has email suppressed (D-054).
\set ON_ERROR_STOP 1

select tests.create_user('acc-guard@melins-acceptance.invalid', 'ACC Guard', 'accountant');

insert into public.notifications (recipient_id, kind, title, link, send_email)
values (tests.uid('acc-guard@melins-acceptance.invalid'), 'test', 'ACC to a test user', '/', true),
       (tests.uid('acct@t'), 'test', 'ACC to a real user', '/', true);
do $$ begin
  perform tests.eq((select send_email from public.notifications where title = 'ACC to a test user'), false, 'D-054: no email to .invalid addresses');
  perform tests.eq((select send_email from public.notifications where title = 'ACC to a real user'), true, 'D-054: real users still emailed');
end $$;

update app.system_config set suppress_email_until = now() + interval '5 minutes';
insert into public.notifications (recipient_id, kind, title, link, send_email)
values (tests.uid('acct@t'), 'test', 'ACC during a run', '/', true);
update app.system_config set suppress_email_until = now() - interval '1 second';
insert into public.notifications (recipient_id, kind, title, link, send_email)
values (tests.uid('acct@t'), 'test', 'ACC after the run', '/', true);
update app.system_config set suppress_email_until = null;
do $$ begin
  perform tests.eq((select send_email from public.notifications where title = 'ACC during a run'), false, 'D-054: no email while a run is in progress');
  perform tests.eq((select send_email from public.notifications where title = 'ACC after the run'), true, 'D-054: email again once it expires');
end $$;
