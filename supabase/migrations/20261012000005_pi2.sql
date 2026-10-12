-- Konnector CRM — PI-2 tables: Copilot usage log, mail/calendar sync, personal API keys and
-- outbound webhooks. Row types mirror src/lib/domain/types.ts (CopilotRun, MailConnection,
-- SyncedMessage, ApiKey, WebhookSubscription, WebhookDelivery); change both together.
--
-- Secrets (OAuth tokens, API key hashes, webhook signing secrets) are never selectable by
-- `authenticated`: those tables get column-level SELECT grants on the non-secret columns only.
-- The app reads and writes the secret columns through the service role (server-side only).

-- ---------------------------------------------------------------------------
-- copilot_runs: one row per Copilot request (no prompt or output text is stored)
-- ---------------------------------------------------------------------------

create table public.copilot_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  user_id uuid not null references public.users (id) on delete cascade,
  task text not null check (task in ('account_summary', 'followup_email', 'bid_suggestion', 'notes_to_tasks', 'rfp_checklist')),
  related_type text check (related_type is null or public.is_related_type(related_type)),
  related_id uuid,
  model text not null,
  status text not null check (status in ('ok', 'refused', 'error', 'demo')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  error text,
  check ((related_type is null) = (related_id is null))
);

create index copilot_runs_org_id_idx on public.copilot_runs (org_id);
create index copilot_runs_user_id_created_at_idx on public.copilot_runs (user_id, created_at desc);
create index copilot_runs_related_idx on public.copilot_runs (related_type, related_id);

-- ---------------------------------------------------------------------------
-- mail_connections: a user's own mailbox / calendar (tokens encrypted at rest)
-- ---------------------------------------------------------------------------

create table public.mail_connections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  user_id uuid not null references public.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  email text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  scopes text[] not null default '{}',
  -- AES-256-GCM ciphertext (src/lib/server/crypto.ts). Never selectable by `authenticated`.
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  sync_cursor jsonb not null default '{}'::jsonb check (jsonb_typeof(sync_cursor) = 'object'),
  last_error text,
  unique (user_id, provider, email)
);

create index mail_connections_org_id_idx on public.mail_connections (org_id);
create index mail_connections_status_idx on public.mail_connections (status);

-- ---------------------------------------------------------------------------
-- synced_messages: emails / calendar events pulled from a connection
-- ---------------------------------------------------------------------------

create table public.synced_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  connection_id uuid not null references public.mail_connections (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  provider_message_id text not null,
  kind text not null check (kind in ('email', 'event')),
  direction text not null check (direction in ('inbound', 'outbound')),
  subject text not null,
  from_address text,
  to_addresses text[] not null default '{}',
  occurred_at timestamptz not null,
  activity_id uuid references public.activities (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  unique (connection_id, provider_message_id)
);

create index synced_messages_user_id_occurred_at_idx on public.synced_messages (user_id, occurred_at desc);
create index synced_messages_activity_id_idx on public.synced_messages (activity_id);
create index synced_messages_account_id_idx on public.synced_messages (account_id);
create index synced_messages_contact_id_idx on public.synced_messages (contact_id);

-- ---------------------------------------------------------------------------
-- api_keys: personal REST API keys (SHA-256 hash + display prefix only)
-- ---------------------------------------------------------------------------

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  prefix text not null unique,
  -- hex SHA-256 of the full key. Never selectable by `authenticated`.
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default '{read}' check (cardinality(scopes) >= 1 and scopes <@ array['read', 'write']::text[]),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create index api_keys_org_id_idx on public.api_keys (org_id);
create index api_keys_user_id_idx on public.api_keys (user_id);

-- ---------------------------------------------------------------------------
-- webhook_subscriptions / webhook_deliveries: outbound webhooks (admin-managed)
-- ---------------------------------------------------------------------------

create table public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  url text not null check (url ~ '^https?://'),
  description text,
  events text[] not null check (
    cardinality(events) >= 1
    and events <@ array[
      'account.created', 'account.updated', 'opportunity.created', 'opportunity.stage_changed',
      'quote.status_changed', 'client_item.decided', 'handoff.acknowledged'
    ]::text[]
  ),
  -- AES-256-GCM ciphertext of the HMAC signing secret. Never selectable by `authenticated`.
  secret_enc text not null,
  active boolean not null default true
);

create index webhook_subscriptions_org_id_idx on public.webhook_subscriptions (org_id);
create index webhook_subscriptions_events_idx on public.webhook_subscriptions using gin (events);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  subscription_id uuid not null references public.webhook_subscriptions (id) on delete cascade,
  event text not null check (event in (
    'account.created', 'account.updated', 'opportunity.created', 'opportunity.stage_changed',
    'quote.status_changed', 'client_item.decided', 'handoff.acknowledged'
  )),
  event_id uuid not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  response_status integer,
  last_error text,
  next_attempt_at timestamptz,
  unique (subscription_id, event_id)
);

create index webhook_deliveries_subscription_id_created_at_idx on public.webhook_deliveries (subscription_id, created_at desc);
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at) where status = 'pending';

select public.attach_updated_at(
  'copilot_runs', 'mail_connections', 'synced_messages', 'api_keys', 'webhook_subscriptions', 'webhook_deliveries'
);

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing (Supabase default privileges grant ALL incl.
-- TRUNCATE), then grant only what each table needs. Secret columns are left out
-- of every SELECT grant to `authenticated`.
-- ---------------------------------------------------------------------------

revoke all on public.copilot_runs, public.mail_connections, public.synced_messages, public.api_keys,
  public.webhook_subscriptions, public.webhook_deliveries from anon, authenticated;
grant select, insert, update, delete on public.copilot_runs, public.mail_connections, public.synced_messages,
  public.api_keys, public.webhook_subscriptions, public.webhook_deliveries to service_role;

-- copilot_runs: append-only usage log for users.
grant select, insert on public.copilot_runs to authenticated;

-- mail_connections: no access_token_enc / refresh_token_enc. Inserts happen in the OAuth
-- callback with the service role. UPDATE/DELETE privileges don't imply SELECT, so a user can
-- still disconnect (status = 'revoked', tokens nulled) without being able to read the tokens.
grant select (
  id, created_at, updated_at, created_by, archived_at,
  org_id, user_id, provider, email, status, scopes, token_expires_at, last_synced_at, sync_cursor, last_error
) on public.mail_connections to authenticated;
grant update (status, access_token_enc, refresh_token_enc, token_expires_at, last_error, archived_at)
  on public.mail_connections to authenticated;
grant delete on public.mail_connections to authenticated;

-- synced_messages: read-only for users; the sync worker writes with the service role.
grant select on public.synced_messages to authenticated;

-- api_keys: no key_hash. Users create their own keys and revoke them (revoked_at / name).
grant select (
  id, created_at, updated_at, created_by, archived_at,
  org_id, user_id, name, prefix, scopes, last_used_at, expires_at, revoked_at
) on public.api_keys to authenticated;
grant insert (org_id, user_id, name, prefix, key_hash, scopes, expires_at, created_by) on public.api_keys to authenticated;
grant update (name, revoked_at) on public.api_keys to authenticated;

-- webhook_subscriptions: admin only, no secret_enc on read.
grant select (
  id, created_at, updated_at, created_by, archived_at,
  org_id, url, description, events, active
) on public.webhook_subscriptions to authenticated;
grant insert, update, delete on public.webhook_subscriptions to authenticated;

-- webhook_deliveries: admin only.
grant select, insert, update, delete on public.webhook_deliveries to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.copilot_runs enable row level security;
alter table public.mail_connections enable row level security;
alter table public.synced_messages enable row level security;
alter table public.api_keys enable row level security;
alter table public.webhook_subscriptions enable row level security;
alter table public.webhook_deliveries enable row level security;

-- copilot_runs: insert as yourself; read your own; leaders read all. No update/delete.
create policy copilot_runs_select on public.copilot_runs
  for select to authenticated using (user_id = (select auth.uid()) or public.is_leader());
create policy copilot_runs_insert on public.copilot_runs
  for insert to authenticated with check (user_id = (select auth.uid()));

-- mail_connections: your own row only (no insert — the OAuth callback uses the service role).
create policy mail_connections_select on public.mail_connections
  for select to authenticated using (user_id = (select auth.uid()));
create policy mail_connections_update on public.mail_connections
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy mail_connections_delete on public.mail_connections
  for delete to authenticated using (user_id = (select auth.uid()));

-- synced_messages: your own; leaders read all. Writes: service role only.
create policy synced_messages_select on public.synced_messages
  for select to authenticated using (user_id = (select auth.uid()) or public.is_leader());

-- api_keys: your own keys; admin reads every key (non-secret columns) for oversight.
create policy api_keys_select on public.api_keys
  for select to authenticated using (user_id = (select auth.uid()) or public.has_role('admin'));
create policy api_keys_insert on public.api_keys
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy api_keys_update on public.api_keys
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- webhook_subscriptions / webhook_deliveries: admin only.
create policy webhook_subscriptions_select on public.webhook_subscriptions
  for select to authenticated using (public.has_role('admin'));
create policy webhook_subscriptions_insert on public.webhook_subscriptions
  for insert to authenticated with check (public.has_role('admin'));
create policy webhook_subscriptions_update on public.webhook_subscriptions
  for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy webhook_subscriptions_delete on public.webhook_subscriptions
  for delete to authenticated using (public.has_role('admin'));

create policy webhook_deliveries_select on public.webhook_deliveries
  for select to authenticated using (public.has_role('admin'));
create policy webhook_deliveries_insert on public.webhook_deliveries
  for insert to authenticated with check (public.has_role('admin'));
create policy webhook_deliveries_update on public.webhook_deliveries
  for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy webhook_deliveries_delete on public.webhook_deliveries
  for delete to authenticated using (public.has_role('admin'));
