-- After a run: put staging back to the snapshot. Rows the run added are
-- deleted, rows it changed are restored, and the test log-ins are removed.
-- Triggers are off meanwhile (closed months, locked invoices and the audit log
-- would otherwise refuse), as in scripts/backup/restore.sh.
create temp table acc_result (tbl text, deleted int, restored int, reinserted int);

set session_replication_role = replica;
do $$
declare
  r record;
  pk text;
  has_pk boolean;
  cols text;
  xcols text;
  d int; u int; i int;
begin
  if to_regclass('acceptance.snapshot') is null then return; end if;
  for r in select * from acceptance.tables loop
    pk := acceptance.pk_expr(r.oid);
    has_pk := pk <> 'to_jsonb(t)';
    select string_agg(format('%I', attname), ', ' order by attnum), string_agg(format('x.%I', attname), ', ' order by attnum)
      into cols, xcols
      from pg_attribute where attrelid = r.oid and attnum > 0 and not attisdropped and attgenerated = '' and attidentity <> 'a';

    execute format('delete from %s t where not exists (select 1 from acceptance.snapshot s where s.tbl = %L and s.pk = %s)',
                   r.qname, r.qname, pk);
    get diagnostics d = row_count;
    u := 0;
    if has_pk then
      execute format('update %1$s t set (%2$s) = row(%3$s) from acceptance.snapshot s, jsonb_populate_record(null::%1$s, s.row) x
                      where s.tbl = %4$L and s.pk = %5$s and s.row <> to_jsonb(t)', r.qname, cols, xcols, r.qname, pk);
      get diagnostics u = row_count;
    end if;
    execute format('insert into %1$s (%2$s) select %3$s from acceptance.snapshot s, jsonb_populate_record(null::%1$s, s.row) x
                    where s.tbl = %4$L and not exists (select 1 from %1$s t where %5$s = s.pk)', r.qname, cols, xcols, r.qname, pk);
    get diagnostics i = row_count;
    if d + u + i > 0 then insert into acc_result values (r.qname, d, u, i); end if;
  end loop;
end $$;
set session_replication_role = origin;

-- Test log-ins (their profiles went with the rows above).
with gone as (delete from auth.users where email like '%@melins-acceptance.invalid' returning 1)
insert into acc_result select 'auth.users', count(*)::int, 0, 0 from gone;

drop schema if exists acceptance cascade;

select coalesce(json_agg(acc_result order by tbl), '[]') as changes from acc_result;
