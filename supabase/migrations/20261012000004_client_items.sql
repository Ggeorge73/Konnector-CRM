-- Konnector CRM — client commercial items (CRM → Konnect Hub portal → CRM),
-- plus the generic record-visibility predicate and the policies that need
-- every table to exist (files, record_tags).

create table public.client_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  type text not null check (type in ('quote', 'contract_amendment', 'renewal_offer', 'survey')),
  account_id uuid not null references public.accounts (id),
  opportunity_id uuid references public.opportunities (id) on delete set null,
  quote_id uuid references public.quotes (id) on delete set null,
  konnect_hub_client_id text,
  konnect_hub_project_id text,
  title text not null,
  summary text,
  amount numeric(14, 2),
  currency char(3) not null default 'USD',
  -- client-facing lines only: [{ item, description, qty, unit_price }] — never cost
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  terms text,
  new_end_date date,
  document_file_id uuid references public.files (id) on delete set null,
  respond_by date,
  version integer not null default 1 check (version >= 1),
  lineage_id uuid not null,
  status text not null default 'draft' check (status in (
    'draft', 'published', 'viewed', 'accepted', 'declined', 'changes_requested', 'expired', 'withdrawn', 'superseded'
  )),
  decided_by_name text,
  decided_by_title text,
  decided_by_email text,
  decided_at timestamptz,
  decision_ip text,
  decision_note text,
  survey_score integer check (survey_score between 0 and 10),
  published_by uuid references public.users (id) on delete set null,
  published_at timestamptz,
  owner_id uuid not null references public.users (id),
  unique (lineage_id, version)
);

create index client_items_org_id_idx on public.client_items (org_id);
create index client_items_account_id_idx on public.client_items (account_id);
create index client_items_opportunity_id_idx on public.client_items (opportunity_id);
create index client_items_quote_id_idx on public.client_items (quote_id);
create index client_items_owner_id_idx on public.client_items (owner_id);
create index client_items_status_respond_by_idx on public.client_items (status, respond_by);
create index client_items_document_file_id_idx on public.client_items (document_file_id);
create index client_items_published_by_idx on public.client_items (published_by);

select public.attach_updated_at('client_items');

-- Start from nothing (Supabase default privileges grant ALL incl. TRUNCATE).
revoke all on public.client_items from anon, authenticated;
grant select, insert, update on public.client_items to authenticated;
grant select, insert, update, delete on public.client_items to service_role;

alter table public.client_items enable row level security;

create or replace function public.can_see_client_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.has_role('admin', 'executive', 'delivery_lead')
        or case when ci.opportunity_id is not null then public.can_see_opportunity(ci.opportunity_id)
                else public.can_see_account(ci.account_id) end
       from public.client_items ci where ci.id = p_item_id),
    false
  )
$$;

-- client_items: leaders + delivery leads read all; others when the related
-- opportunity (or, for account-level items, the account) is visible.
-- Created/edited by leaders or the owner; decisions arrive via service role.
create policy client_items_select on public.client_items
  for select to authenticated
  using (
    public.has_role('admin', 'executive', 'delivery_lead')
    or case when opportunity_id is not null then public.can_see_opportunity(opportunity_id)
            else public.can_see_account(account_id) end
  );
create policy client_items_insert on public.client_items
  for insert to authenticated
  with check (public.is_leader() or owner_id = (select auth.uid()));
create policy client_items_update on public.client_items
  for update to authenticated
  using (public.is_leader() or owner_id = (select auth.uid()))
  with check (public.is_leader() or owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Generic polymorphic visibility (files, record_tags)
-- ---------------------------------------------------------------------------

create or replace function public.can_see_record(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'account' then public.can_see_account(p_id)
    when 'contact' then public.can_see_contact(p_id)
    when 'opportunity' then public.can_see_opportunity(p_id)
    when 'quote' then public.can_see_quote(p_id)
    when 'client_item' then public.can_see_client_item(p_id)
    when 'consultant' then public.has_role('admin', 'executive', 'delivery_lead', 'recruiter')
    when 'partner_vetting' then public.is_leader()
    when 'event' then auth.uid() is not null
    when 'registration' then auth.uid() is not null
    else false
  end
$$;

revoke execute on function public.can_see_client_item(uuid), public.can_see_record(text, uuid) from public, anon;
grant execute on function public.can_see_client_item(uuid), public.can_see_record(text, uuid)
  to authenticated, service_role;

create policy files_select on public.files
  for select to authenticated
  using (created_by = (select auth.uid()) or public.can_see_record(related_type, related_id));
create policy files_insert on public.files
  for insert to authenticated
  with check (created_by = (select auth.uid()) and public.can_see_record(related_type, related_id));
create policy files_update on public.files
  for update to authenticated
  using (created_by = (select auth.uid()) or public.is_leader())
  with check (created_by = (select auth.uid()) or public.is_leader());
create policy files_delete on public.files
  for delete to authenticated using (created_by = (select auth.uid()) or public.is_leader());

create policy record_tags_select on public.record_tags
  for select to authenticated using (public.can_see_record(related_type, related_id));
create policy record_tags_insert on public.record_tags
  for insert to authenticated with check (public.can_see_record(related_type, related_id));
create policy record_tags_delete on public.record_tags
  for delete to authenticated using (public.can_see_record(related_type, related_id));
