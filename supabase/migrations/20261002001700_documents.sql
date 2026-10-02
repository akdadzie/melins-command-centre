-- =============================================================================
-- 1700 Documents (A-045): one private Storage bucket for every attachment
-- (receipts, invoices from suppliers, certificates, contracts, statements,
-- medical certificates, board resolutions...).
--
-- A file lives at  <table>/<record id>/<file name>  and anyone who can read
-- that record (its RLS decides) can open the file. So leave documents are
-- seen only by the person, their approver and finance; statements only by
-- finance; and so on, with no second set of rules to keep in step.
-- Directors never upload. Only the uploader or the Owner deletes a file.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'text/csv',
              'application/vnd.ms-excel', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The tables that take attachments, and the column that holds the path.
create or replace function app.document_tables() returns text[]
language sql immutable as $$
  select array['receipts', 'expenses', 'payments_out', 'staff_payments', 'transfers', 'staff_loans',
               'director_transactions', 'director_payments', 'statutory_payments', 'wht_certificates',
               'leave_requests', 'job_contracts', 'statement_imports', 'payroll_runs']
$$;

-- Runs as the caller, so the table's own RLS decides whether the record (and
-- therefore its file) is visible.
create or replace function app.document_record_visible(p_name text) returns boolean
language plpgsql stable security invoker set search_path = '' as $$
declare
  t text := split_part(p_name, '/', 1);
  rid text := split_part(p_name, '/', 2);
  ok boolean;
begin
  if not t = any (app.document_tables())
     or rid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name, '/', 3) = '' or split_part(p_name, '/', 4) <> '' then
    return false;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1)', t) into ok using rid::uuid;
  return ok;
end $$;
grant execute on function app.document_record_visible(text) to authenticated;
grant execute on function app.document_tables() to authenticated;

create policy documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and app.document_record_visible(name));

create policy documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and app.my_role() is not null and app.my_role() <> 'director'
              and app.document_record_visible(name));

create policy documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (owner = auth.uid() or owner_id = auth.uid()::text or app.has_role('owner'))
         and app.document_record_visible(name));
