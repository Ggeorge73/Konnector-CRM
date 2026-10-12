-- Konnector CRM — capture pipeline: opportunities, bid/no-bid, quotes,
-- registrations and partner vetting. Also the opportunity/account visibility
-- predicates and the policies that depend on them (accounts, contacts,
-- activities, mentions). Rules mirror src/lib/auth/permissions.ts.

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  name text not null,
  account_id uuid not null references public.accounts (id),
  owner_id uuid not null references public.users (id),
  kind text not null check (kind in ('public_bid', 'private_deal', 'reseller_quote', 'staffing_placement')),
  stage text not null default 'signal' check (stage in (
    'signal', 'qualify', 'capture', 'bid_no_bid', 'proposal', 'submitted', 'won', 'lost', 'no_bid'
  )),
  value numeric(14, 2) not null default 0,
  currency char(3) not null default 'USD',
  probability integer not null default 0 check (probability between 0 and 100),
  pwin integer check (pwin between 0 and 100),
  expected_close date,
  source text not null check (source in ('signal', 'referral', 'event', 'inbound', 'partner')),
  service_lines text[] not null default '{}' check (
    service_lines <@ array['implementation', 'systems_integration', 'staffing', 'reselling', 'advisory']::text[]
  ),
  next_step text,
  next_step_due date,
  lost_reason text,
  no_bid_reason text,
  shared_with uuid[] not null default '{}',
  parent_opportunity_id uuid references public.opportunities (id) on delete set null deferrable initially deferred,
  -- public-bid fields
  solicitation_no text,
  agency_buyer text,
  procurement_vehicle text,
  naics text,
  set_aside text,
  questions_due date,
  proposal_due date,
  submission_method text,
  incumbent text
);

create table public.bid_decisions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  weights jsonb not null default '{}'::jsonb,
  total_score numeric(6, 2) not null default 0,
  verdict text not null check (verdict in ('bid', 'no_bid', 'conditional')),
  notes text,
  decided_by uuid references public.users (id) on delete set null,
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected')),
  approved_by uuid references public.users (id) on delete set null,
  approved_at timestamptz
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  account_id uuid not null references public.accounts (id),
  number text not null unique,
  title text not null,
  currency char(3) not null default 'USD',
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'sent', 'accepted', 'declined'
  )),
  valid_until date,
  terms text,
  internal_notes text,
  approved_by uuid references public.users (id) on delete set null,
  approved_at timestamptz,
  owner_id uuid not null references public.users (id)
);

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  position integer not null default 0,
  item text not null,
  description text,
  qty numeric(14, 2) not null default 1,
  unit_cost numeric(14, 2) not null default 0,
  unit_price numeric(14, 2) not null default 0,
  oem_partner_account_id uuid references public.accounts (id) on delete set null
);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  kind text not null check (kind in ('sam_uei', 'cage', 'georgia_supplier', 'certification', 'insurance', 'license')),
  name text not null,
  identifier text,
  issuer text,
  issued_on date,
  expires_on date,
  owner_id uuid not null references public.users (id),
  notes text
);

create table public.partner_vetting (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  account_id uuid not null references public.accounts (id) on delete cascade,
  sanctions_screen text not null default 'pending' check (sanctions_screen in ('clear', 'hit', 'pending')),
  pep_screen text not null default 'pending' check (pep_screen in ('clear', 'hit', 'pending')),
  beneficial_ownership text,
  anti_corruption_attested boolean not null default false,
  references_checked boolean not null default false,
  risk_rating text not null default 'medium' check (risk_rating in ('low', 'medium', 'high')),
  review_due date,
  reviewer_id uuid references public.users (id) on delete set null,
  notes text
);

create index opportunities_org_id_idx on public.opportunities (org_id);
create index opportunities_account_id_idx on public.opportunities (account_id);
create index opportunities_owner_id_idx on public.opportunities (owner_id);
create index opportunities_stage_idx on public.opportunities (stage);
create index opportunities_kind_idx on public.opportunities (kind);
create index opportunities_expected_close_idx on public.opportunities (expected_close);
create index opportunities_proposal_due_idx on public.opportunities (proposal_due);
create index opportunities_parent_idx on public.opportunities (parent_opportunity_id);
create index opportunities_shared_with_idx on public.opportunities using gin (shared_with);
create index bid_decisions_opportunity_id_idx on public.bid_decisions (opportunity_id);
create index bid_decisions_status_idx on public.bid_decisions (status);
create index quotes_org_id_idx on public.quotes (org_id);
create index quotes_opportunity_id_idx on public.quotes (opportunity_id);
create index quotes_account_id_idx on public.quotes (account_id);
create index quotes_owner_id_idx on public.quotes (owner_id);
create index quotes_status_idx on public.quotes (status);
create index quote_lines_quote_id_idx on public.quote_lines (quote_id, position);
create index quote_lines_oem_idx on public.quote_lines (oem_partner_account_id);
create index registrations_org_id_idx on public.registrations (org_id);
create index registrations_expires_on_idx on public.registrations (expires_on);
create index partner_vetting_org_id_idx on public.partner_vetting (org_id);
create index partner_vetting_account_id_idx on public.partner_vetting (account_id);
create index partner_vetting_review_due_idx on public.partner_vetting (review_due);

select public.attach_updated_at(
  'opportunities', 'bid_decisions', 'quotes', 'quote_lines', 'registrations', 'partner_vetting'
);

-- ---------------------------------------------------------------------------
-- Visibility predicates (canSeeOpportunity / canEditOpportunity / canSeeAccount)
-- ---------------------------------------------------------------------------

-- Pure predicate over an opportunity's columns; used directly by the
-- opportunities policy (no table access, so no recursion).
create or replace function public.opportunity_visible(p_owner_id uuid, p_shared_with uuid[], p_kind text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when public.has_role('admin', 'executive', 'delivery_lead') then true
    when public.has_role('recruiter') then p_kind = 'staffing_placement'
    when auth.uid() is null then false
    else p_owner_id = auth.uid() or auth.uid() = any (p_shared_with)
  end
$$;

create or replace function public.opportunity_editable(p_owner_id uuid, p_shared_with uuid[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_leader()
    or (public.has_role('bd') and (p_owner_id = auth.uid() or auth.uid() = any (p_shared_with)))
$$;

-- By id, for other tables' policies. SECURITY DEFINER reads opportunities
-- without RLS, so policies on accounts etc. never recurse.
create or replace function public.can_see_opportunity(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.opportunity_visible(o.owner_id, o.shared_with, o.kind)
       from public.opportunities o where o.id = p_opportunity_id),
    false
  )
$$;

create or replace function public.can_edit_opportunity(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.opportunity_editable(o.owner_id, o.shared_with)
       from public.opportunities o where o.id = p_opportunity_id),
    false
  )
$$;

create or replace function public.is_opportunity_owner(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.opportunities o where o.id = p_opportunity_id and o.owner_id = auth.uid()
  )
$$;

-- Leaders / delivery leads see all accounts; others see accounts they own or
-- that carry an opportunity they can see.
create or replace function public.can_see_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('admin', 'executive', 'delivery_lead')
    or exists (select 1 from public.accounts a where a.id = p_account_id and a.owner_id = auth.uid())
    or exists (
      select 1 from public.opportunities o
      where o.account_id = p_account_id
        and public.opportunity_visible(o.owner_id, o.shared_with, o.kind)
    )
$$;

create or replace function public.can_see_quote(p_quote_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.can_see_opportunity(q.opportunity_id) from public.quotes q where q.id = p_quote_id),
    false
  )
$$;

-- canSeeQuoteCost: leaders or the quote owner.
create or replace function public.can_see_quote_cost(p_quote_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_leader()
    or exists (select 1 from public.quotes q where q.id = p_quote_id and q.owner_id = auth.uid())
$$;

create or replace function public.can_edit_quote(p_quote_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_leader()
    or exists (
      select 1 from public.quotes q
      where q.id = p_quote_id and q.owner_id = auth.uid() and public.can_edit_opportunity(q.opportunity_id)
    )
$$;

-- canApprove: only leaders may approve bid decisions / quotes. Service role and
-- migrations (no auth.uid()) are not restricted.
create or replace function public.guard_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_leader() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'approved' or new.approved_by is not null or new.approved_at is not null then
      raise exception 'only admin or executive can approve' using errcode = 'insufficient_privilege';
    end if;
  elsif (new.status = 'approved' and old.status is distinct from 'approved')
     or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    raise exception 'only admin or executive can approve' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger bid_decisions_guard_approval
  before insert or update on public.bid_decisions
  for each row execute function public.guard_approval();
create trigger quotes_guard_approval
  before insert or update on public.quotes
  for each row execute function public.guard_approval();

revoke execute on function
  public.opportunity_visible(uuid, uuid[], text), public.opportunity_editable(uuid, uuid[]),
  public.can_see_opportunity(uuid), public.can_edit_opportunity(uuid), public.is_opportunity_owner(uuid),
  public.can_see_account(uuid), public.can_see_quote(uuid), public.can_see_quote_cost(uuid),
  public.can_edit_quote(uuid)
  from public, anon;
grant execute on function
  public.opportunity_visible(uuid, uuid[], text), public.opportunity_editable(uuid, uuid[]),
  public.can_see_opportunity(uuid), public.can_edit_opportunity(uuid), public.is_opportunity_owner(uuid),
  public.can_see_account(uuid), public.can_see_quote(uuid), public.can_see_quote_cost(uuid),
  public.can_edit_quote(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Start from nothing (Supabase default privileges grant ALL incl. TRUNCATE).
revoke all on
  public.opportunities, public.bid_decisions, public.quotes, public.quote_lines,
  public.registrations, public.partner_vetting
  from anon, authenticated;
grant select, insert, update, delete on
  public.opportunities, public.bid_decisions, public.quotes, public.registrations, public.partner_vetting
  to authenticated, service_role;
grant select, insert, update, delete on public.quote_lines to service_role;

-- Column-level secrecy for quote_lines.unit_cost: `authenticated` may read every
-- column EXCEPT unit_cost. Clients read lines through quote_lines_client; cost
-- holders (leaders, quote owner) read quote_lines_internal. Writes may set
-- unit_cost (INSERT/UPDATE privileges are separate from SELECT) but must not
-- ask for it back (`returning *`): select explicit columns or re-read the view.
grant select (
  id, created_at, updated_at, created_by, archived_at,
  quote_id, position, item, description, qty, unit_price, oem_partner_account_id
) on public.quote_lines to authenticated;
grant insert, update, delete on public.quote_lines to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.opportunities enable row level security;
alter table public.bid_decisions enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;
alter table public.registrations enable row level security;
alter table public.partner_vetting enable row level security;

-- opportunities
create policy opportunities_select on public.opportunities
  for select to authenticated
  using (public.opportunity_visible(owner_id, shared_with, kind));
create policy opportunities_insert on public.opportunities
  for insert to authenticated
  with check (public.is_leader() or (public.has_role('bd') and owner_id = (select auth.uid())));
create policy opportunities_update on public.opportunities
  for update to authenticated
  using (public.opportunity_editable(owner_id, shared_with))
  with check (public.opportunity_editable(owner_id, shared_with));
create policy opportunities_delete on public.opportunities
  for delete to authenticated using (public.is_leader());

-- accounts (canSeeAccount / canEditAccount)
create policy accounts_select on public.accounts
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.can_see_account(id));
create policy accounts_insert on public.accounts
  for insert to authenticated
  with check (public.is_leader() or (public.has_role('bd') and owner_id = (select auth.uid())));
create policy accounts_update on public.accounts
  for update to authenticated
  using (public.is_leader() or (public.has_role('bd') and owner_id = (select auth.uid())))
  with check (public.is_leader() or (public.has_role('bd') and owner_id = (select auth.uid())));
create policy accounts_delete on public.accounts
  for delete to authenticated using (public.is_leader());

-- contacts follow their account
create policy contacts_select on public.contacts
  for select to authenticated using (public.can_see_account(account_id));
create policy contacts_insert on public.contacts
  for insert to authenticated
  with check (public.is_leader() or (public.has_role('bd') and public.can_see_account(account_id)));
create policy contacts_update on public.contacts
  for update to authenticated
  using (public.is_leader() or (public.has_role('bd') and public.can_see_account(account_id)))
  with check (public.is_leader() or (public.has_role('bd') and public.can_see_account(account_id)));
create policy contacts_delete on public.contacts
  for delete to authenticated using (public.is_leader());

-- activities: opportunity-related rows need opportunity visibility; others
-- follow the account (no account → visible to all internal users).
create policy activities_select on public.activities
  for select to authenticated
  using (
    case
      when related_type = 'opportunity' then public.can_see_opportunity(related_id)
      else account_id is null or public.can_see_account(account_id)
    end
  );
create policy activities_insert on public.activities
  for insert to authenticated
  with check (actor_id is null or actor_id = (select auth.uid()));
create policy activities_update on public.activities
  for update to authenticated
  using (actor_id = (select auth.uid()) or public.is_leader())
  with check (actor_id = (select auth.uid()) or public.is_leader());
create policy activities_delete on public.activities
  for delete to authenticated using (public.has_role('admin'));

-- mentions: the mentioned user, or anyone who can see the activity.
create policy mentions_select on public.mentions
  for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.activities a where a.id = activity_id));
create policy mentions_insert on public.mentions
  for insert to authenticated
  with check (exists (
    select 1 from public.activities a where a.id = activity_id and a.actor_id = (select auth.uid())
  ));
create policy mentions_delete on public.mentions
  for delete to authenticated using (created_by = (select auth.uid()) or public.is_leader());

-- bid_decisions: leaders or the opportunity owner.
create policy bid_decisions_select on public.bid_decisions
  for select to authenticated
  using (public.is_leader() or public.is_opportunity_owner(opportunity_id));
create policy bid_decisions_insert on public.bid_decisions
  for insert to authenticated
  with check (public.is_leader() or public.is_opportunity_owner(opportunity_id));
create policy bid_decisions_update on public.bid_decisions
  for update to authenticated
  using (public.is_leader() or public.is_opportunity_owner(opportunity_id))
  with check (public.is_leader() or public.is_opportunity_owner(opportunity_id));
create policy bid_decisions_delete on public.bid_decisions
  for delete to authenticated using (public.is_leader());

-- quotes: visible with their opportunity; written by leaders or the owner (who
-- must be able to edit the opportunity).
create policy quotes_select on public.quotes
  for select to authenticated using (public.can_see_opportunity(opportunity_id));
create policy quotes_insert on public.quotes
  for insert to authenticated
  with check (
    public.is_leader()
    or (owner_id = (select auth.uid()) and public.can_edit_opportunity(opportunity_id))
  );
create policy quotes_update on public.quotes
  for update to authenticated
  using (public.is_leader() or (owner_id = (select auth.uid()) and public.can_edit_opportunity(opportunity_id)))
  with check (public.is_leader() or (owner_id = (select auth.uid()) and public.can_edit_opportunity(opportunity_id)));
create policy quotes_delete on public.quotes
  for delete to authenticated using (public.is_leader());

-- quote_lines rows: visible with their quote (cost column is hidden by grants).
create policy quote_lines_select on public.quote_lines
  for select to authenticated using (public.can_see_quote(quote_id));
create policy quote_lines_insert on public.quote_lines
  for insert to authenticated with check (public.can_edit_quote(quote_id));
create policy quote_lines_update on public.quote_lines
  for update to authenticated
  using (public.can_edit_quote(quote_id)) with check (public.can_edit_quote(quote_id));
create policy quote_lines_delete on public.quote_lines
  for delete to authenticated using (public.can_edit_quote(quote_id));

-- Client-safe lines: everything but unit_cost. security_invoker, so the
-- caller's grants and the quote_lines policy above apply.
create view public.quote_lines_client
with (security_invoker = true) as
  select
    id, created_at, updated_at, created_by, archived_at,
    quote_id, position, item, description, qty, unit_price, oem_partner_account_id
  from public.quote_lines;

-- Cost view for leaders and the quote owner (canSeeQuoteCost). Runs with the
-- view owner's rights (bypasses the column grant), so the row filter is the
-- policy: rows appear only where can_see_quote_cost() is true.
create view public.quote_lines_internal
with (security_invoker = false, security_barrier = true) as
  select
    l.id, l.created_at, l.updated_at, l.created_by, l.archived_at,
    l.quote_id, l.position, l.item, l.description, l.qty, l.unit_cost, l.unit_price,
    l.oem_partner_account_id,
    case when l.unit_price = 0 then null
      else round((l.unit_price - l.unit_cost) / l.unit_price * 100, 2) end as margin_pct
  from public.quote_lines l
  where public.can_see_quote_cost(l.quote_id);

revoke all on public.quote_lines_client, public.quote_lines_internal from anon, authenticated;
grant select on public.quote_lines_client, public.quote_lines_internal to authenticated, service_role;

-- registrations: everyone reads; leaders write.
create policy registrations_select on public.registrations
  for select to authenticated using (true);
create policy registrations_insert on public.registrations
  for insert to authenticated with check (public.is_leader());
create policy registrations_update on public.registrations
  for update to authenticated using (public.is_leader()) with check (public.is_leader());
create policy registrations_delete on public.registrations
  for delete to authenticated using (public.is_leader());

-- partner_vetting: leaders only.
create policy partner_vetting_all on public.partner_vetting
  for all to authenticated using (public.is_leader()) with check (public.is_leader());
