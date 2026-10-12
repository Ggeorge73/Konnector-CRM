# Database (Supabase / Postgres)

The schema lives in `supabase/migrations/`. Row shapes match `src/lib/domain/types.ts` exactly. Role rules match
`src/lib/auth/permissions.ts` and are enforced with row-level security (RLS). If you change one of these, change the others
too. `pnpm test:rls` checks that they still agree.

Every table has `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at` (set by a trigger), `created_by` (defaults to
`auth.uid()`) and `archived_at` (soft delete). Other column conventions:

- Money is `numeric(14,2)` with `currency char(3) default 'USD'`.
- Dates are `date` and timestamps are `timestamptz`.
- Lists are `text[]` or `uuid[]`. Objects are `jsonb`.
- Enum-like columns are `text` with a `check` constraint.

## Migrations

| File                                          | Contents                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261012000001_core.sql`                     | `pgcrypto`, the `set_updated_at` trigger, role helpers (`current_app_user()`, `app_role()`, `has_role(variadic text[])`, `is_leader()`). Tables: organizations, users (`id` = `auth.users.id`), accounts, contacts, activities, tasks, files, tags, record_tags, saved_views, notifications, mentions, recent_views, audit_log (append-only).                                                              |
| `20261012000002_capture.sql`                  | opportunities, bid_decisions, quotes, quote_lines, registrations, partner_vetting. Visibility predicates (`opportunity_visible`, `can_see_opportunity`, `can_see_account`, `can_see_quote`, `can_see_quote_cost`, …) and the policies that depend on them (accounts, contacts, activities, mentions). The `quote_lines_client` and `quote_lines_internal` views. A trigger that lets only leaders approve. |
| `20261012000003_bench_events_integration.sql` | consultants (plus the `consultants_public` view), events, event_leads, handoffs, project_health, integration_events.                                                                                                                                                                                                                                                                                       |
| `20261012000004_client_items.sql`             | client_items. `can_see_record(type, id)` handles polymorphic links. Policies for files and record_tags.                                                                                                                                                                                                                                                                                                    |
| `20261012000005_pi2.sql`                      | PI-2: copilot_runs, mail_connections, synced_messages, api_keys, webhook_subscriptions, webhook_deliveries. Column-level `SELECT` grants keep OAuth tokens, API key hashes and webhook secrets away from `authenticated` (see below).                                                                                                                                                                      |

Policies that need a later table are created in the migration that adds that table. Until then, the table denies all access to
`authenticated`.

## Role matrix (enforced by RLS)

"Leaders" means `admin` and `executive`. All policies apply to the `authenticated` role. `anon` has no privileges on any table.

| Table / view                          | admin, executive                  | bd                                                                                             | delivery_lead            | recruiter                       |
| ------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------- |
| users                                 | read all; **admin** writes        | read all                                                                                       | read all                 | read all                        |
| opportunities                         | read/write all                    | read/write own or `shared_with`                                                                | read all                 | read `staffing_placement`       |
| accounts                              | read/write all                    | read own, or with a visible opportunity; write own                                             | read all                 | read with a visible opportunity |
| contacts                              | follow the account                | follow the account                                                                             | follow the account       | follow the account              |
| activities                            | read all; insert as self          | opportunity rows: opportunity visible; others: account visible (or no account); insert as self | read all; insert as self | same rule as bd                 |
| tasks                                 | all                               | assignee or creator                                                                            | assignee or creator      | assignee or creator             |
| quotes                                | all                               | with a visible opportunity; write own                                                          | read all                 | read on staffing deals          |
| quote_lines (no `unit_cost`)          | all                               | with the quote                                                                                 | with the quote           | with the quote                  |
| `quote_lines_internal` (cost, margin) | all                               | **own quotes only**                                                                            | none                     | none                            |
| bid_decisions                         | all; only leaders approve         | opportunities they **own**                                                                     | none                     | none                            |
| partner_vetting                       | all                               | none                                                                                           | none                     | none                            |
| registrations                         | read/write                        | read                                                                                           | read                     | read                            |
| consultants (with `rate_cost`)        | read/write                        | none                                                                                           | none                     | read/write                      |
| `consultants_public` (no `rate_cost`) | read                              | none                                                                                           | read                     | read                            |
| events / event_leads                  | read/write                        | read/write (leads follow the contact)                                                          | read                     | read                            |
| handoffs                              | read all; insert                  | read when the opportunity is visible                                                           | read all; insert         | read when visible               |
| project_health                        | read all                          | read when the opportunity or account is visible                                                | read all                 | read when visible               |
| integration_events                    | read                              | none                                                                                           | read                     | none                            |
| client_items                          | read all; insert/update           | read when the opportunity or account is visible; write own                                     | read all                 | read when visible               |
| notifications, recent_views           | own rows                          | own rows                                                                                       | own rows                 | own rows                        |
| saved_views                           | own rows plus `shared = true`     | same                                                                                           | same                     | same                            |
| audit_log                             | **admin** reads; everyone appends | append only                                                                                    | append only              | append only                     |
| copilot_runs                          | read all; insert as self          | own rows; insert as self                                                                       | same as bd               | same as bd                      |
| mail_connections (no tokens)          | own row: read/update/delete       | same                                                                                           | same                     | same                            |
| synced_messages                       | read all                          | own rows (read only)                                                                           | own rows                 | own rows                        |
| api_keys (no `key_hash`)              | own keys; **admin** reads all     | own keys: read, create, revoke (`revoked_at`, `name`)                                          | same as bd               | same as bd                      |
| webhook_subscriptions (no secret)     | **admin** only (executive: none)  | none                                                                                           | none                     | none                            |
| webhook_deliveries                    | **admin** only (executive: none)  | none                                                                                           | none                     | none                            |

Inserts into mail_connections and every write to synced_messages happen only through the **service role** (the OAuth
callback and the sync worker). copilot_runs has no UPDATE or DELETE grant and api_keys no DELETE grant (revoke instead).

Writes to handoff status, project_health and integration_events happen only through the **service role** (the webhooks and
the retry worker). No user, the database owner included, can UPDATE, DELETE or TRUNCATE `audit_log`: the grants are revoked and
a trigger raises an error.

Supabase's default privileges grant `ALL` on new tables to `anon` and `authenticated`, and that includes `TRUNCATE`, which RLS
does not check. Every migration therefore starts with `revoke all … from anon, authenticated` and then grants only what is
needed.

The `has_role()` family and the `can_see_*()` predicates are `SECURITY DEFINER` and use `search_path = ''`. Policies on one
table can therefore check another table (an account's policy can look at its opportunities, for example) without recursing
through RLS.

## Column secrecy: `quote_lines.unit_cost` and `consultants.rate_cost`

RLS filters rows, not columns. Supabase also sends every user through the same Postgres role (`authenticated`). As a result, a
column grant cannot say "leaders yes, bd no". Two different patterns are used:

**quote_lines.unit_cost (and the margin, which is derived from it)**

- `authenticated` has `SELECT` on every column of `quote_lines` **except** `unit_cost`. For every user, `select unit_cost` (or
  `select *`) on the table fails with `permission denied`. Row policy: a line is visible when its quote's opportunity is
  visible.
- `quote_lines_client` is a `security_invoker` view with every column except `unit_cost`. The caller's grants and the policy
  above apply. Use it for any client-facing or general read.
- `quote_lines_internal` is a definer-rights view with `security_barrier`. It returns `unit_cost` and `margin_pct`, filtered
  by `can_see_quote_cost(quote_id)`, which means leaders, or the owner of the quote. This view is the only way to read cost.
- Writers can still `insert` or `update` `unit_cost`, because those privileges are separate from `SELECT`. They must not ask
  for it back. Use `.select("id, …")` with explicit columns instead of `returning *`, and re-read through
  `quote_lines_internal`.

**consultants.rate_cost**

- RLS limits the `consultants` table, `rate_cost` included, to leaders and recruiters. bd and delivery_lead get 0 rows.
- `consultants_public` is a definer-rights view with `security_barrier`. It has every column except `rate_cost` and is
  filtered to every role except bd. Delivery leads read the bench from this view.

**PI-2 secrets: `mail_connections.access_token_enc` / `refresh_token_enc`, `api_keys.key_hash`,
`webhook_subscriptions.secret_enc`**

- `authenticated` gets `SELECT` on every other column of these tables, so `select *` (and PostgREST's default
  `returning *`) fails with `permission denied` for every user, admins included. Select explicit columns.
- `UPDATE` / `INSERT` privileges are separate from `SELECT`: a user can still disconnect a mailbox (`status = 'revoked'`,
  tokens set to null) or create a key without being able to read the secret back.
- The app reads and writes these tables through the **service role** (`src/lib/services/privileged.ts`,
  `src/lib/api/store.ts`, the mail sync worker) and scopes by user in the service layer. Tokens and webhook secrets are
  AES-256-GCM ciphertext (`src/lib/server/crypto.ts`, `APP_ENCRYPTION_KEY`); API keys are SHA-256 hashes. See
  `docs/API.md`.

Definer-rights views and `SECURITY DEFINER` functions are intentional here. Supabase's security advisor will flag them. Each
one filters on `auth.uid()` or the user's role internally.

## Seed data

`supabase/seed.sql` is **generated** from `buildSeed()` in `src/lib/data/seed.ts`, the same rows that demo mode uses:

```bash
pnpm db:seed-sql
```

The demo backend calls `buildSeed()` with the current time, so its dates are relative to now. `seed.sql` is pinned to
`2026-10-12T15:00:00Z` so that the file is deterministic. Regenerate it to move the dates. CI fails when `seed.sql` is out of
sync with `seed.ts`. The seed also adds an `auth.users` row for each internal user. These rows have no password, so set one
in Studio (or send a magic link) to sign in as a seeded user.

## Running locally with Supabase

```bash
supabase start          # Postgres 16, Auth, REST, Studio (see supabase/config.toml)
supabase db reset       # applies supabase/migrations/* in order, then supabase/seed.sql
```

The app reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which `supabase start` prints.

## RLS role test

`scripts/rls-test.ts` runs these steps:

1. Creates a throwaway database.
2. Stubs what Supabase provides: the `auth` schema, `auth.users`, `auth.uid()`, `auth.jwt()`, the `anon`, `authenticated` and
   `service_role` roles, and Supabase's default privileges.
3. Applies every migration in order and loads `seed.sql`.
4. For each seeded user, opens a transaction with `set local role authenticated` and `request.jwt.claims`, then runs its
   assertions.

The expected row sets come from `buildSeed()` and the functions in `permissions.ts`, so the database and the UI are checked
against the same rules. The test also checks:

- the public tables match the `Tables` type in `types.ts`;
- RLS is on for every table;
- the columns match the seed rows;
- `anon` has no privileges;
- writes behave as expected: opportunity edits, approvals, activities written as another user, quote cost leaking through
  `RETURNING`, handoffs, and the integration tables;
- PI-2 tables (no seed rows, so the test inserts fixtures as the superuser and checks their columns against an explicit
  list): own-row vs others' rows per role for copilot_runs, mail_connections, synced_messages and api_keys; admin-only
  webhook tables; `permission denied` on every secret column (and `select *`) for every role; service role reads them.

```bash
# any Postgres 16 superuser connection; the test creates and drops its own database
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test:rls
# keep the database for poking around
KEEP_DB=1 DATABASE_URL=… pnpm test:rls
```

The output has one `PASS`/`FAIL` line per assertion. The process exits non-zero if any assertion fails. In CI, the `rls` job in
`.github/workflows/ci.yml` runs the test against a `postgres:16` service container after checking that `seed.sql` is in sync.
