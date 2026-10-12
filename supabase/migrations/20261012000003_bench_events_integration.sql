-- Konnector CRM — talent bench, BD events and the Konnect Hub integration
-- tables (handoffs, project_health, integration_events).

create table public.consultants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  full_name text not null,
  title text not null,
  email text,
  skills text[] not null default '{}',
  certifications text[] not null default '{}',
  rate_cost numeric(14, 2),
  rate_bill numeric(14, 2) not null default 0,
  currency char(3) not null default 'USD',
  availability_from date,
  location text not null,
  clearance text,
  resume_file_id uuid references public.files (id) on delete set null,
  status text not null default 'available' check (status in ('available', 'allocated', 'partial', 'inactive'))
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  name text not null,
  kind text not null check (kind in ('summit', 'expo', 'procurement_fair', 'conference', 'webinar')),
  starts_on date not null,
  ends_on date not null,
  location text not null,
  budget numeric(14, 2) not null default 0,
  currency char(3) not null default 'USD',
  attendee_ids uuid[] not null default '{}',
  notes text,
  check (ends_on >= starts_on)
);

create table public.event_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  event_id uuid not null references public.events (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  interest text,
  follow_up_task_id uuid references public.tasks (id) on delete set null,
  unique (event_id, contact_id)
);

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'acknowledged', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  konnect_hub_project_id text,
  konnect_hub_url text,
  payload_version text not null default '1',
  payload jsonb not null default '{}'::jsonb,
  next_attempt_at timestamptz
);

create table public.project_health (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  konnect_hub_project_id text not null unique,
  opportunity_id uuid references public.opportunities (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  project_name text not null,
  health_schedule text not null check (health_schedule in ('green', 'amber', 'red')),
  health_budget text not null check (health_budget in ('green', 'amber', 'red')),
  health_acceptance text not null check (health_acceptance in ('green', 'amber', 'red')),
  percent_complete numeric(5, 2) not null default 0 check (percent_complete between 0 and 100),
  status text not null,
  hub_updated_at timestamptz not null,
  end_date date
);

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  direction text not null check (direction in ('outbound', 'inbound')),
  event text not null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'processed', 'rejected')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  response jsonb,
  unique (direction, idempotency_key)
);

create index consultants_org_id_idx on public.consultants (org_id);
create index consultants_status_idx on public.consultants (status);
create index consultants_availability_idx on public.consultants (availability_from);
create index consultants_skills_idx on public.consultants using gin (skills);
create index consultants_resume_file_id_idx on public.consultants (resume_file_id);
create index events_org_id_idx on public.events (org_id);
create index events_starts_on_idx on public.events (starts_on);
create index event_leads_event_id_idx on public.event_leads (event_id);
create index event_leads_contact_id_idx on public.event_leads (contact_id);
create index event_leads_task_id_idx on public.event_leads (follow_up_task_id);
create index handoffs_opportunity_id_idx on public.handoffs (opportunity_id);
create index handoffs_status_next_idx on public.handoffs (status, next_attempt_at);
create index project_health_opportunity_id_idx on public.project_health (opportunity_id);
create index project_health_account_id_idx on public.project_health (account_id);
create index integration_events_status_idx on public.integration_events (status, direction);
create index integration_events_event_idx on public.integration_events (event);

select public.attach_updated_at(
  'consultants', 'events', 'event_leads', 'handoffs', 'project_health', 'integration_events'
);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Start from nothing (Supabase default privileges grant ALL incl. TRUNCATE).
revoke all on
  public.consultants, public.events, public.event_leads, public.handoffs,
  public.project_health, public.integration_events
  from anon, authenticated;
grant select, insert, update, delete on
  public.consultants, public.events, public.event_leads, public.handoffs,
  public.project_health, public.integration_events
  to service_role;
grant select, insert, update, delete on public.consultants, public.events, public.event_leads to authenticated;
-- Integration tables are written by the service role (webhooks, retry worker).
-- The only user write is creating a handoff from the Won wizard.
grant select, insert on public.handoffs to authenticated;
grant select on public.project_health, public.integration_events to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.consultants enable row level security;
alter table public.events enable row level security;
alter table public.event_leads enable row level security;
alter table public.handoffs enable row level security;
alter table public.project_health enable row level security;
alter table public.integration_events enable row level security;

-- consultants: the table (with rate_cost) is for leaders and recruiters only
-- (canSeeConsultantCost / canEditBench). bd sees nothing. Delivery leads read
-- the bench through consultants_public, which omits rate_cost.
create policy consultants_select on public.consultants
  for select to authenticated using (public.has_role('admin', 'executive', 'recruiter'));
create policy consultants_insert on public.consultants
  for insert to authenticated with check (public.has_role('admin', 'executive', 'recruiter'));
create policy consultants_update on public.consultants
  for update to authenticated
  using (public.has_role('admin', 'executive', 'recruiter'))
  with check (public.has_role('admin', 'executive', 'recruiter'));
create policy consultants_delete on public.consultants
  for delete to authenticated using (public.is_leader());

-- Bench without cost rates (canSeeBench: everyone but bd). Runs with the view
-- owner's rights, so the WHERE clause is the row policy.
create view public.consultants_public
with (security_invoker = false, security_barrier = true) as
  select
    id, created_at, updated_at, created_by, archived_at,
    org_id, full_name, title, email, skills, certifications, rate_bill, currency,
    availability_from, location, clearance, resume_file_id, status
  from public.consultants
  where public.has_role('admin', 'executive', 'delivery_lead', 'recruiter');

revoke all on public.consultants_public from anon, authenticated;
grant select on public.consultants_public to authenticated, service_role;

-- events: everyone reads; leaders and bd run events.
create policy events_select on public.events
  for select to authenticated using (true);
create policy events_insert on public.events
  for insert to authenticated with check (public.has_role('admin', 'executive', 'bd'));
create policy events_update on public.events
  for update to authenticated
  using (public.has_role('admin', 'executive', 'bd')) with check (public.has_role('admin', 'executive', 'bd'));
create policy events_delete on public.events
  for delete to authenticated using (public.is_leader());

-- event_leads follow the captured contact's account.
create or replace function public.can_see_contact(p_contact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.can_see_account(c.account_id) from public.contacts c where c.id = p_contact_id),
    false
  )
$$;
revoke execute on function public.can_see_contact(uuid) from public, anon;
grant execute on function public.can_see_contact(uuid) to authenticated, service_role;

create policy event_leads_select on public.event_leads
  for select to authenticated using (public.can_see_contact(contact_id));
create policy event_leads_insert on public.event_leads
  for insert to authenticated
  with check (public.has_role('admin', 'executive', 'bd') and public.can_see_contact(contact_id));
create policy event_leads_update on public.event_leads
  for update to authenticated
  using (public.has_role('admin', 'executive', 'bd') and public.can_see_contact(contact_id))
  with check (public.has_role('admin', 'executive', 'bd') and public.can_see_contact(contact_id));
create policy event_leads_delete on public.event_leads
  for delete to authenticated using (public.has_role('admin', 'executive', 'bd'));

-- handoffs: leaders + delivery leads read all; others where the opportunity is
-- visible. Created by leaders / delivery leads (canRunHandoff); status updates
-- come from the service role only.
create policy handoffs_select on public.handoffs
  for select to authenticated
  using (public.has_role('admin', 'executive', 'delivery_lead') or public.can_see_opportunity(opportunity_id));
create policy handoffs_insert on public.handoffs
  for insert to authenticated
  with check (public.has_role('admin', 'executive', 'delivery_lead'));

-- project_health: read-only mirror of Konnect Hub; service role writes.
create policy project_health_select on public.project_health
  for select to authenticated
  using (
    public.has_role('admin', 'executive', 'delivery_lead')
    or (opportunity_id is not null and public.can_see_opportunity(opportunity_id))
    or (account_id is not null and public.can_see_account(account_id))
  );

-- integration_events: the delivery log; leaders + delivery leads only.
create policy integration_events_select on public.integration_events
  for select to authenticated
  using (public.has_role('admin', 'executive', 'delivery_lead'));
