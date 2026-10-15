-- KCRM-75 / KCRM-76 (S10 data onboarding): CSV import batches.
--
-- One row per committed import (accounts, contacts or pipeline): who ran it, when, the file
-- name, row counts and the ids of every record it created, so Undo can archive exactly those.
-- Row type mirrors src/lib/domain/types.ts (ImportBatch); change both together.
--
-- Rules (src/lib/auth/permissions.ts canImport / canUndoImport):
--   read    the importer; leaders (admin, executive) read every batch
--   insert  as yourself, with an import role for the entity (bd/leaders; recruiters: pipeline only)
--   update  undo only: the importer or a leader, within 7 days, committed → undone
--   delete  nobody (history)

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  user_id uuid not null references public.users (id),
  entity text not null check (entity in ('accounts', 'contacts', 'opportunities')),
  file_name text not null check (length(file_name) between 1 and 200),
  status text not null default 'committed' check (status in ('committed', 'undone')),
  total_rows integer not null default 0 check (total_rows between 0 and 5000),
  created_count integer not null default 0 check (created_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  created_ids jsonb not null default '{"accounts":[],"contacts":[],"opportunities":[]}'::jsonb
    check (jsonb_typeof(created_ids) = 'object'),
  undone_at timestamptz,
  undone_by uuid references public.users (id),
  check ((status = 'undone') = (undone_at is not null))
);

create index import_batches_org_id_created_at_idx on public.import_batches (org_id, created_at desc);
create index import_batches_user_id_idx on public.import_batches (user_id);

select public.attach_updated_at('import_batches');

-- Privileges: start from nothing, then grant what the app needs.
revoke all on public.import_batches from anon, authenticated;
grant select, insert, update, delete on public.import_batches to service_role;
grant select, insert on public.import_batches to authenticated;
-- Undo flips the status only; ids, counts and the importer can't be rewritten.
grant update (status, undone_at, undone_by) on public.import_batches to authenticated;

alter table public.import_batches enable row level security;

create policy import_batches_active_user_only on public.import_batches
  as restrictive for all to authenticated using (public.is_active_user()) with check (public.is_active_user());

create policy import_batches_select on public.import_batches
  for select to authenticated using (user_id = (select auth.uid()) or public.is_leader());

create policy import_batches_insert on public.import_batches
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'committed'
    and (public.is_leader() or public.has_role('bd') or (public.has_role('recruiter') and entity = 'opportunities'))
  );

create policy import_batches_update on public.import_batches
  for update to authenticated
  using (
    (user_id = (select auth.uid()) or public.is_leader())
    and status = 'committed'
    and created_at > now() - interval '7 days'
  )
  with check (status = 'undone' and undone_by = (select auth.uid()));
