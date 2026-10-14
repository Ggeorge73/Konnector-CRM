-- Konnector CRM — Supabase Storage bucket for record files (KCRM-68).
--
-- The app stores attachments, resumes and generated client PDFs in a private bucket called "files"
-- (src/lib/services/files.ts). Object paths are  <org_id>/<related_type>/<related_id>/<uuid>-<name>.
--
-- Access mirrors public.files:
--   * upload: only into your own org's folder, and only for a record you can see (can_see_record)
--   * read:   only objects that have a public.files row you can see (that row's RLS applies here too)
--   * no update/delete by signed-in users; files are archived via public.files, generated PDFs use the
--     service role
--
-- Plain Postgres (CI's RLS job) has no storage schema, so everything is guarded and runs only on Supabase.

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not present; skipping bucket and storage policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('files', 'files', false, 15 * 1024 * 1024)
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

  execute 'drop policy if exists kcrm_files_insert on storage.objects';
  execute 'drop policy if exists kcrm_files_select on storage.objects';

  execute $p$
    create policy kcrm_files_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'files'
        and (storage.foldername(name))[1] = (select u.org_id::text from public.users u where u.id = (select auth.uid()))
        and public.is_related_type((storage.foldername(name))[2])
        and public.can_see_record((storage.foldername(name))[2], ((storage.foldername(name))[3])::uuid)
      )
  $p$;

  execute $p$
    create policy kcrm_files_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'files'
        and exists (select 1 from public.files f where f.storage_path = storage.objects.name and f.archived_at is null)
      )
  $p$;
end
$$;
