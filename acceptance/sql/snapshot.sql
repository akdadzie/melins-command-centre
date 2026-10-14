-- Before a run: copy every row of every table in public and app into
-- acceptance.snapshot, so teardown.sql can put staging back exactly as it was.
-- Also: no email while the run is in progress (migration 2300), and an early
-- timesheet go-live date so compliance and utilisation have days to count.
create schema acceptance;
revoke all on schema acceptance from public, anon, authenticated;
create table acceptance.snapshot (tbl text not null, pk jsonb not null, row jsonb not null);
create table acceptance.run (started_at timestamptz not null default now());
insert into acceptance.run default values;

create function acceptance.pk_expr(p_rel oid) returns text
language sql stable as $$
  select coalesce('jsonb_build_object(' || string_agg(format('%L, t.%I', a.attname, a.attname), ', ' order by a.attnum) || ')',
                  'to_jsonb(t)')
  from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = p_rel and i.indisprimary
$$;

create view acceptance.tables as
  select c.oid, n.nspname, c.relname, format('%I.%I', n.nspname, c.relname) as qname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app') and c.relkind = 'r' and not c.relispartition;

do $$
declare r record;
begin
  for r in select * from acceptance.tables loop
    execute format('insert into acceptance.snapshot select %L, %s, to_jsonb(t) from %s t',
                   r.qname, acceptance.pk_expr(r.oid), r.qname);
  end loop;
end $$;

update app.system_config set suppress_email_until = now() + interval '30 minutes',
                             go_live_date = least(go_live_date, current_date - 60);

select (select count(*) from acceptance.snapshot) as snapshot_rows, (select started_at from acceptance.run) as started_at;
