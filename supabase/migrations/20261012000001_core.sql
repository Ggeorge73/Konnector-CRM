-- Konnector CRM — core schema.
-- Row types mirror src/lib/domain/types.ts exactly; change both together.
-- Conventions: every table has id uuid pk, created_at, updated_at (trigger),
-- created_by (defaults to the caller), archived_at (soft delete).
-- Enum-like columns are text + check constraints (easier to evolve than enums).
--
-- RLS is enabled on every table here. Policies that depend on opportunity
-- visibility (accounts, contacts, activities) are added in 20261012000002, and
-- the cross-record policies for files / record_tags in 20261012000004 — until
-- then those tables are deny-all for `authenticated`.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Attach the updated_at trigger to a list of tables.
create or replace function public.attach_updated_at(variadic tables text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  t text;
begin
  foreach t in array tables loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- organizations / users
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  archived_at timestamptz,
  name text not null,
  settings jsonb not null default '{}'::jsonb
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  email text not null unique,
  full_name text not null,
  title text not null,
  role text not null check (role in ('admin', 'executive', 'bd', 'delivery_lead', 'recruiter')),
  avatar_color text not null,
  time_zone text not null default 'America/New_York'
);

-- created_by is a soft pointer to public.users; deferrable so seed rows that are
-- "created by" a user inserted later in the same transaction still load.
alter table public.organizations
  add constraint organizations_created_by_fkey foreign key (created_by)
  references public.users (id) on delete set null deferrable initially deferred;
alter table public.users
  add constraint users_created_by_fkey foreign key (created_by)
  references public.users (id) on delete set null deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so policies can read users without recursion)
-- ---------------------------------------------------------------------------

create or replace function public.current_app_user()
returns public.users
language sql
stable
security definer
set search_path = ''
as $$
  select u.* from public.users u where u.id = auth.uid() and u.archived_at is null
$$;

create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.role from public.users u where u.id = auth.uid() and u.archived_at is null
$$;

create or replace function public.has_role(variadic roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.role = any (roles) from public.users u where u.id = auth.uid() and u.archived_at is null),
    false
  )
$$;

create or replace function public.is_leader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('admin', 'executive')
$$;

-- ---------------------------------------------------------------------------
-- Core CRM tables
-- ---------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  name text not null,
  type text not null check (type in (
    'government_federal', 'government_state', 'government_local', 'government_foreign',
    'private', 'partner_subcontractor', 'oem_vendor'
  )),
  sector text not null,
  country text not null,
  state_region text,
  city text,
  lat double precision,
  lng double precision,
  website text,
  logo_url text,
  owner_id uuid not null references public.users (id),
  tier text not null check (tier in ('A', 'B', 'C')),
  status text not null check (status in ('prospect', 'active_client', 'past_client', 'partner', 'dormant')),
  konnect_hub_client_id text,
  survey_score numeric(4, 1) check (survey_score between 0 and 10),
  description text
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  account_id uuid not null references public.accounts (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  title text,
  email text,
  phone text,
  role_in_buying text check (role_in_buying in (
    'decision_maker', 'influencer', 'procurement_officer', 'technical_evaluator', 'champion'
  )),
  owner_id uuid not null references public.users (id)
);

-- related_type values shared by polymorphic links (RelatedType in types.ts)
create or replace function public.is_related_type(t text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t in (
    'account', 'contact', 'opportunity', 'quote', 'consultant', 'event',
    'registration', 'partner_vetting', 'client_item'
  )
$$;

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  type text not null check (type in (
    'note', 'email', 'call', 'meeting', 'task', 'stage_change', 'file', 'handoff', 'system'
  )),
  subject text not null,
  body text,
  occurred_at timestamptz not null default now(),
  related_type text not null check (public.is_related_type(related_type)),
  related_id uuid not null,
  account_id uuid references public.accounts (id) on delete cascade,
  actor_id uuid references public.users (id) on delete set null,
  mentions uuid[] not null default '{}',
  reactions jsonb not null default '{}'::jsonb
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  title text not null,
  due_at timestamptz,
  assignee_id uuid not null references public.users (id),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'done')),
  related_type text check (related_type is null or public.is_related_type(related_type)),
  related_id uuid,
  account_id uuid references public.accounts (id) on delete set null,
  notes text
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  storage_path text not null,
  name text not null,
  size bigint not null check (size >= 0),
  mime text not null,
  related_type text not null check (public.is_related_type(related_type)),
  related_id uuid not null
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  name text not null,
  color text not null,
  unique (org_id, name)
);

create table public.record_tags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  tag_id uuid not null references public.tags (id) on delete cascade,
  related_type text not null check (public.is_related_type(related_type)),
  related_id uuid not null,
  unique (tag_id, related_type, related_id)
);

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  owner_id uuid not null references public.users (id) on delete cascade,
  entity text not null check (entity in ('accounts', 'contacts', 'opportunities', 'consultants')),
  name text not null,
  query jsonb not null default '{}'::jsonb,
  shared boolean not null default false
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null check (kind in (
    'mention', 'assignment', 'deadline', 'expiry', 'client_decision', 'handoff', 'approval', 'alert'
  )),
  title text not null,
  body text,
  href text,
  read_at timestamptz
);

create table public.mentions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  unique (activity_id, user_id)
);

create table public.recent_views (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  user_id uuid not null references public.users (id) on delete cascade,
  related_type text not null check (public.is_related_type(related_type)),
  related_id uuid not null,
  label text not null,
  unique (user_id, related_type, related_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  actor_id uuid references public.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid not null,
  before jsonb,
  after jsonb
);

-- ---------------------------------------------------------------------------
-- Indexes (FKs + common filters)
-- ---------------------------------------------------------------------------

create index users_org_id_idx on public.users (org_id);
create index users_role_idx on public.users (role);
create index accounts_org_id_idx on public.accounts (org_id);
create index accounts_owner_id_idx on public.accounts (owner_id);
create index accounts_type_idx on public.accounts (type);
create index accounts_status_idx on public.accounts (status);
create index contacts_org_id_idx on public.contacts (org_id);
create index contacts_account_id_idx on public.contacts (account_id);
create index contacts_owner_id_idx on public.contacts (owner_id);
create index contacts_email_idx on public.contacts (lower(email));
create index activities_org_id_idx on public.activities (org_id);
create index activities_related_idx on public.activities (related_type, related_id);
create index activities_account_id_idx on public.activities (account_id);
create index activities_actor_id_idx on public.activities (actor_id);
create index activities_occurred_at_idx on public.activities (occurred_at desc);
create index tasks_org_id_idx on public.tasks (org_id);
create index tasks_assignee_status_idx on public.tasks (assignee_id, status);
create index tasks_due_at_idx on public.tasks (due_at);
create index tasks_related_idx on public.tasks (related_type, related_id);
create index tasks_account_id_idx on public.tasks (account_id);
create index tasks_created_by_idx on public.tasks (created_by);
create index files_org_id_idx on public.files (org_id);
create index files_related_idx on public.files (related_type, related_id);
create index tags_org_id_idx on public.tags (org_id);
create index record_tags_related_idx on public.record_tags (related_type, related_id);
create index saved_views_org_id_idx on public.saved_views (org_id);
create index saved_views_owner_id_idx on public.saved_views (owner_id);
create index notifications_user_unread_idx on public.notifications (user_id, read_at);
create index mentions_user_id_idx on public.mentions (user_id);
create index recent_views_user_id_idx on public.recent_views (user_id, updated_at desc);
create index audit_log_org_id_idx on public.audit_log (org_id);
create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

select public.attach_updated_at(
  'organizations', 'users', 'accounts', 'contacts', 'activities', 'tasks', 'files', 'tags',
  'record_tags', 'saved_views', 'notifications', 'mentions', 'recent_views'
);

-- ---------------------------------------------------------------------------
-- audit_log is append-only: no UPDATE/DELETE/TRUNCATE for anyone (trigger),
-- and the privileges are revoked from the API roles as well.
-- ---------------------------------------------------------------------------

create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only (% not allowed)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();

-- ---------------------------------------------------------------------------
-- Privileges + RLS
-- ---------------------------------------------------------------------------

-- Supabase's default privileges grant ALL (incl. TRUNCATE, which ignores RLS)
-- on new tables to anon/authenticated. Start from nothing and grant precisely.
revoke all on
  public.organizations, public.users, public.accounts, public.contacts, public.activities,
  public.tasks, public.files, public.tags, public.record_tags, public.saved_views,
  public.notifications, public.mentions, public.recent_views, public.audit_log
  from anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on
  public.organizations, public.users, public.accounts, public.contacts, public.activities,
  public.tasks, public.files, public.tags, public.record_tags, public.saved_views,
  public.notifications, public.mentions, public.recent_views
  to authenticated;
grant select, insert on public.audit_log to authenticated;
revoke update, delete, truncate on public.audit_log from authenticated, service_role;
grant select, insert, update, delete on
  public.organizations, public.users, public.accounts, public.contacts, public.activities,
  public.tasks, public.files, public.tags, public.record_tags, public.saved_views,
  public.notifications, public.mentions, public.recent_views
  to service_role;
grant select, insert on public.audit_log to service_role;

revoke execute on function public.current_app_user(), public.app_role(), public.has_role(text[]),
  public.is_leader() from public, anon;
grant execute on function public.current_app_user(), public.app_role(), public.has_role(text[]),
  public.is_leader() to authenticated, service_role;

alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.files enable row level security;
alter table public.tags enable row level security;
alter table public.record_tags enable row level security;
alter table public.saved_views enable row level security;
alter table public.notifications enable row level security;
alter table public.mentions enable row level security;
alter table public.recent_views enable row level security;
alter table public.audit_log enable row level security;

-- organizations: everyone reads the tenant; admin manages settings.
create policy organizations_select on public.organizations
  for select to authenticated using (true);
create policy organizations_update on public.organizations
  for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));

-- users: every internal user is visible to every internal user; only admin writes.
create policy users_select on public.users
  for select to authenticated using (true);
create policy users_insert on public.users
  for insert to authenticated with check (public.has_role('admin'));
create policy users_update on public.users
  for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy users_delete on public.users
  for delete to authenticated using (public.has_role('admin'));

-- tasks: assignee, creator or leaders.
create policy tasks_select on public.tasks
  for select to authenticated
  using (assignee_id = (select auth.uid()) or created_by = (select auth.uid()) or public.is_leader());
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (created_by = (select auth.uid()) or public.is_leader());
create policy tasks_update on public.tasks
  for update to authenticated
  using (assignee_id = (select auth.uid()) or created_by = (select auth.uid()) or public.is_leader())
  with check (assignee_id = (select auth.uid()) or created_by = (select auth.uid()) or public.is_leader());
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_leader());

-- tags: shared vocabulary; anyone may add, leaders curate.
create policy tags_select on public.tags
  for select to authenticated using (true);
create policy tags_insert on public.tags
  for insert to authenticated with check (true);
create policy tags_update on public.tags
  for update to authenticated using (public.is_leader()) with check (public.is_leader());
create policy tags_delete on public.tags
  for delete to authenticated using (public.is_leader());

-- saved_views: own rows; shared views are readable by everyone.
create policy saved_views_select on public.saved_views
  for select to authenticated using (owner_id = (select auth.uid()) or shared);
create policy saved_views_insert on public.saved_views
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy saved_views_update on public.saved_views
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy saved_views_delete on public.saved_views
  for delete to authenticated using (owner_id = (select auth.uid()));

-- notifications: own rows. Any user may raise a notification for someone else
-- (mentions, assignments) but it is attributed to them via created_by.
create policy notifications_select on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_insert on public.notifications
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

-- recent_views: own rows only.
create policy recent_views_all on public.recent_views
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- audit_log: append-only; any user may append as themselves, only admin reads.
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (actor_id is null or actor_id = (select auth.uid()));
create policy audit_log_select on public.audit_log
  for select to authenticated using (public.has_role('admin'));

-- Internal DDL helper; not part of the API.
revoke execute on function public.attach_updated_at(text[]) from public, anon, authenticated;
