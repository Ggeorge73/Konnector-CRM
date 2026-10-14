-- KCRM-69 Production sign-in hardening: pending access.
--
-- People who sign in from ALLOWED_EMAIL_DOMAIN get a public.users row with role = null
-- ("pending access") from the auth callback (service role). Until an admin assigns a role
-- they see nothing: the app sends them to /pending, and the restrictive policies below
-- hide every row of every table from them (permissive policies such as `using (true)` are
-- AND-ed with these), except their own users row so the app can tell them they are pending.

alter table public.users alter column role drop not null;
comment on column public.users.role is
  'null = pending access: signed in from the allowed domain, waiting for an admin to assign a role';

-- has_role() / is_leader() already return false for a null role (coalesce); app_role() returns null.

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.archived_at is null and u.role is not null
  )
$$;

revoke execute on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated, service_role;

-- One restrictive policy per table: no role, no rows, no writes.
do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'users'
  loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.is_active_user()) with check (public.is_active_user())',
      t || '_active_user_only',
      t
    );
  end loop;
end;
$$;

-- users: a pending person may read only their own row; writes still need admin (users_* policies).
create policy users_active_user_only on public.users
  as restrictive for all to authenticated
  using (public.is_active_user() or id = (select auth.uid()))
  with check (public.is_active_user());

-- Only admins change roles (users_update already requires admin); index pending people for Settings → Team.
create index users_pending_idx on public.users (created_at) where role is null;
