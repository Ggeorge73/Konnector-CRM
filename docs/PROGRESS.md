# Progress

## Sprint 1 — Foundation (KCRM-1)

Delivered:

- Next.js 15 (App Router, strict TS, pnpm), MUI v6 theme from tokens (dark default + light, cookie-persisted).
- Component kit with `/_kit` showcase: GlassCard, StatTile (count-up, sparkline), PulseGlobe (dot-matrix,
  arcs from Atlanta HQ, pauses on hover, reduced-motion aware, flat fallback without WebGL),
  KanbanBoard (dnd-kit, WIP warnings, gold shimmer on won), DataTable (glass DataGrid, CSV export),
  RecordHeader, Timeline (@mentions, reactions), HealthRing, ScoreCard, EmptyState, StatusChip, Countdown.
- App shell: floating collapsible sidenav, mobile drawer, top bar (breadcrumb, search, quick create,
  notifications, theme toggle, account menu), Cmd/Ctrl-K palette (records, pages, actions).
- Auth: Supabase Google + magic link restricted to the internal domain; demo sign-in per role;
  role route guards in the app layout; middleware session check.
- Data layer: Store port with MemoryStore (demo/tests) and SupabaseStore (RLS); realistic seed.
- Pulse home v1 with KPIs, charts and globe from seed.
- CI: typecheck, lint, format, unit, build, Playwright (desktop 1440 + mobile 390).

Notes / inspect & adapt:

- `react-globe.gl` hex layer can't tessellate one country polygon at our resolution; it is skipped.
- Compact money is formatted by our own helper so server and browser render identically.

## Sprint 2 — Core CRM (KCRM-2)

Delivered:

- Supabase schema for all 27 tables (4 migrations), RLS on every table with `has_role()` /
  ownership / sharing predicates, append-only `audit_log`, cost-free views (`quote_lines_client`,
  `consultants_public`) and owner-rights cost views. `pnpm test:rls`: 154 role assertions pass
  against Postgres 16; runs in CI as its own job. Seed SQL generated from the same seed as demo mode.
- Accounts: list with saved views, segment/type/status/tier/owner filters, bulk reassign/retier/archive,
  CSV import (per-row errors) and CSV export; record page with RecordHeader, tabs, related lists,
  Konnect Hub health, client items, timeline, follow-ups, files.
- Contacts: list + record page (timeline, follow-ups, opportunities, events met at).
- Unified Timeline: notes, calls, meetings, emails, @mentions (notify), reactions, file uploads.
- BD follow-up tasks with assignment notifications; My Work (overdue/today/upcoming, mentions,
  recently viewed, awaiting client); notifications list; admin audit log.

Notes / inspect & adapt:

- Postgres can't hide a column per user while all users share the `authenticated` role, so cost is
  read through `quote_lines_internal` (filtered by `can_see_quote_cost`). `SupabaseStore` handles this.
- Relative times render through `<RelTime>` to tolerate server/client second drift.

## Sprint 3 — Capture pipeline (KCRM-3) + handoff core (KCRM-34, KCRM-35)

Delivered:

- Pipeline: Kanban (dnd-kit, WIP warnings, gold shimmer on Won, auto-scroll) and table views with
  filters; stage gates enforced client- and server-side (approved Bid/No-Bid for public bids, lost /
  no-bid reasons, proposal due date); stage changes audited and on the timeline.
- Opportunity record page: public-bid fields, question/proposal countdowns, Bid/No-Bid tab
  (weighted ScoreCard, submit → executive approve/send back, history), quotes, timeline, follow-ups, files.
- Quotes: line editor with live margin vs floor, auto-approve above floor / executive approval below,
  sent/accepted/declined, client PDF (pdf-lib) built from client-facing fields only. Cost, margin and
  internal notes are redacted for viewers who aren't the quote owner or an executive.
- Forecast (stage, service line, quarter; commit / best case), bid calendar, registrations tracker with
  expiry reminders, partner/OEM vetting (executives only), admin settings (margin floor, bid weights
  summing to 100, stage labels/probabilities/WIP).
- Handoff core pulled forward (coupled to the Won flow): contract v1 schemas, HMAC-SHA256 signing with
  timestamp, outbox with idempotency + exponential backoff + cron retry, in-process mock Konnect Hub,
  inbound `project.health_updated` webhook, Won → handoff wizard, HealthRing + "Open in Konnect Hub",
  admin Integrations page, signed 7-day document links. Live updates (version poll / Supabase Realtime).

Notes / inspect & adapt:

- Kanban auto-scroll moves columns during long drags; the e2e test drags between adjacent stages and
  tests the gate dialog via the record page.
- Parallel builds use `NEXT_DIST_DIR` + `E2E_PORT` so several engineers can verify at once.

## Sprint 4 — Bench, events, handoff, Pulse (KCRM-4) and Sprint 5 — Client commercial loop (KCRM-5)

Delivered:

- Consultant bench (skills, certifications, bill/cost rates with cost restricted to leaders + recruiters,
  availability, resumes) and a ranked "who can staff this?" Staffing tab on opportunities.
- BD events with lead capture (existing or new contact/account), automatic follow-up tasks and timeline entries.
- Pulse home: globe with arcs from Atlanta HQ to live projects, KPI tiles, pipeline trend and stage charts,
  bids due, registrations expiring, awaiting client, project health.
- Notifications centre, daily email digest (`/api/cron/daily`, Resend when configured), live updates.
- Client items: publish an approved quote (exact client preview, client PDF), contract amendments,
  renewal offers and surveys; versions with supersede, withdraw; inbound viewed / decided / survey events
  drive the deal (Won + automatic handoff, `project.extended`, change-request tasks, low-score alerts);
  daily expiry job and owner nudges; demo "simulate the client" controls.
- Security: file downloads now check access to the record the file belongs to (consultant resumes are no
  longer readable by bd via file id).

Tests: 85 unit tests, 154 RLS assertions, 38 Playwright e2e (desktop + mobile smoke), all green.

Notes / inspect & adapt:

- Sprint 4 and 5 shipped in one PR because they share the client-item, file-access and nav changes.
- Not started (PI-2, needs PO approval per the build plan): Konnector Copilot (Claude API), Google
  Workspace / Microsoft 365 sync, public REST API.

## PI-2 Sprint 6 — Konnector Copilot (KCRM-45 … 51)

Delivered:

- Copilot drawer on account, contact and opportunity pages: account summary, follow-up email draft (send from
  your own mailbox once connected), Bid/No-Bid suggestion that pre-fills the scorecard, meeting notes → follow-ups,
  RFP PDF → compliance checklist. Nothing is sent or saved without a click. Guide: `docs/COPILOT.md`.
- Claude API server-side only, structured outputs validated with Zod, per-task effort, refusal / truncation /
  outage handling, 40 requests per user per hour, demo mode without a key.
- Context built only through role-scoped services; cost-side data never reaches a prompt (unit-tested).
- `/copilot` usage page (`copilot_runs` stores usage only, never prompt or answer text).

Notes / inspect & adapt:

- Bid suggestions are hidden while a scorecard is waiting for executive approval (found by the e2e test).

## PI-2 Sprint 7 — Google Workspace / Microsoft 365 (KCRM-52 … 55)

Delivered:

- Per-user OAuth connections (Google with PKCE, Microsoft Graph) on `/connections`; tokens encrypted at rest,
  never selectable by signed-in roles.
- Email and calendar sync (`POST /api/cron/mail-sync`, every 15 min, plus "Sync now"): only items with known
  contacts land on the timeline; newsletters, personal and internal-only items are skipped. Guide: `docs/MAIL.md`.
- Send from your own address on account and contact pages and from Copilot drafts; sent mail is logged.

Notes / inspect & adapt:

- Live Google / Microsoft calls are tested against recorded fixtures; the demo backend uses a mock mailbox.
- Microsoft sends via draft-then-send so the sent message keeps a stable id (no duplicate on the next sync).

## PI-2 Sprint 8 — REST API, outbound webhooks and PI-2 database (Platform)

Delivered:

- Migration `20261012000005_pi2.sql` for all six PI-2 tables (copilot_runs, mail_connections, synced_messages,
  api_keys, webhook_subscriptions, webhook_deliveries) with RLS and column-level secrecy for tokens, key hashes
  and webhook secrets; RLS test extended (per-role own/others' rows, admin-only webhooks, secret columns denied).
- Personal API keys (`kcrm_<prefix>_<secret>`, SHA-256 only, shown once, scopes read/write, expiry, revoke, audited).
- REST API v1 (`/api/v1/{accounts,contacts,opportunities,activities,tasks,quotes}`) through the existing services:
  cursor pagination, filters, consistent JSON errors, 120 req/min per key with `RateLimit-*` headers, no cost-side
  fields. OpenAPI 3.1 at `/api/v1/openapi.json`; guide in `docs/API.md`.
- Outbound webhooks: admin subscriptions with encrypted signing secrets, signed deliveries
  (`X-Konnector-Signature`), backoff retries from the integrations cron, test events, delivery log with retry.
  Emitted from account, opportunity, quote, client-item and handoff services.
- `/developer` ("API & webhooks"): keys for everyone; webhooks for admins.

Notes / inspect & adapt:

- In Supabase mode the API uses the service role (no user JWT behind an API key), so access control for API
  requests lives in the service layer — see "Security model" in `docs/API.md`.
- The rate limiter is per server instance; move it to a shared store before scaling out. (Done in S9-07 below.)

## PI-3 Sprint 9 — S9-03 sign-in hardening (KCRM-69) and S9-07 shared rate limiter (KCRM-73)

Delivered:

- Sign-in admission on the server (`admitSignIn`, `src/lib/services/users.ts`) used by the OAuth / magic-link callback
  and the demo email sign-in: exact `ALLOWED_EMAIL_DOMAIN` match (comma-separated list allowed; no subdomains or
  look-alikes), verified email required, deactivated users refused; refused sessions are signed out.
- Pending access: new people get a users row with `role = null`. `requireUser()` sends them to `/pending` from every
  app route, action and API route; API keys of pending owners are refused; RLS (`20261014000001_pending_access.sql`)
  hides every row from them via restrictive policies. Admins are notified; pending people are left out of pickers,
  mentions and digests.
- Settings → Team: admins assign, change or revoke roles (not their own); `user.role_changed` /
  `user.access_revoked` audit entries; the person is notified.
- One `RateLimiter` port (`src/lib/rate-limit`) for Copilot (40/hour/user) and the REST API (120/min/key, same
  headers and messages): Postgres `rate_limits` + atomic `take_rate_limit()` in Supabase mode, memory in demo/tests.
- Tests: `access.test.ts`, `rate-limit.test.ts`, `e2e/access.spec.ts`; RLS test covers pending users and `rate_limits`.

Notes / inspect & adapt:

- Rate limits are now fixed windows (were a token bucket / sliding log): up to 2x the limit can pass across a window
  boundary. `RateLimit-Reset` is seconds until the window ends.
- Magic-link sign-up still creates an `auth.users` row for any address before the callback rejects it; add a
  Supabase "before user created" auth hook if that matters.
- The rate limiter is per server instance; move it to a shared store before scaling out.

## PI-3 Sprint 9 — Observability (KCRM-72, S9-06) and security headers (KCRM-74, S9-08)

Delivered:

- `GET /api/health` (public): database, Konnect Hub (`mock` when mocked) and version checks, ~2 s timeout each,
  503 only when the database is down, Hub problems are "degraded". No error text or hostnames in the output.
- `src/lib/server/observability.ts`: `logEvent` / `reportError` write JSON lines to stdout and optionally POST errors to
  `ERROR_WEBHOOK_URL`; payloads are allow-listed and scrubbed (no bodies, emails or tokens). Wired into `run()`, API v1,
  cron routes, Konnect Hub and webhook deliveries, the OAuth callback and `src/instrumentation.ts` (`onRequestError`).
- Cron routes accept GET (Vercel Cron) as well as POST, same bearer check, and log a completion line per run.
- Security headers: nonce-based CSP from middleware (`'strict-dynamic'`, no inline/eval scripts in production), HSTS in
  production, X-Frame-Options DENY + `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy, nosniff.
- `pnpm audit --prod` clean (postcss override under Next); `pnpm keys:rotate-encryption` re-encrypts stored secrets.
- Runbooks: `docs/OPERATIONS.md` (uptime, logs, jobs, re-running deliveries) and `docs/SECURITY.md` (CSP rationale,
  audit and waivers, secret rotation).

Notes / inspect & adapt:

- No error-tracking vendor yet (PO decision); `ERROR_WEBHOOK_URL` is the hook for one.
- Styles keep `'unsafe-inline'` (emotion + React style attributes); scripts are nonce-only.
- `KONNECTOR_INTEGRATION_SECRET` rotation needs a short coordinated window; accepting a previous secret is a follow-up.

## PI-3 Sprint 10 — Contact and pipeline import (KCRM-75, S10-01 / KCRM-76, S10-02)

Delivered:

- One import framework for accounts, contacts and pipeline (`src/lib/import` parser + mapping, `src/lib/services/imports.ts`):
  parse → map → dry run (per-row create / skip / error with reasons, nothing written) → commit → undo. Dry run and
  commit share `planImport()`, so the preview is exactly what gets written. The old account import now runs on it.
- CSV parser (no new dependency): quotes, `""`, commas and newlines inside quotes, BOM, CRLF/CR; 5,000 rows / 5 MB.
- Auto-suggested column mapping the user can adjust; downloadable templates per type.
- Contacts: matched to visible accounts by normalized name, then account domain/website, then email domain (webmail
  ignored); unmatched rows flagged, optional "create missing accounts" owned by the importer; duplicates skipped by
  email (case-insensitive) against existing contacts and within the file.
- Pipeline: free-text stages mapped through an adjustable stage table ("Proposal Sent" → Submitted); unknown owners
  flagged and given a fallback owner (default the importer; only leaders can pick someone else, bd imports are always
  owned by the importer, as RLS requires); stage history (`2026-03-01 Qualify; 2026-05-10 Proposal`) becomes past-dated
  timeline entries, otherwise one "Imported at stage X" entry; no stage-gate checks for imported history, but lost /
  no-bid deals always carry a reason ("Imported" when blank). Cost / margin / score / quote columns are never mapped
  and are warned about.
- Commit: one multi-row insert per table (`Store.insertMany`), an `import_batches` row with the created ids, one
  `import.committed` audit entry. Undo archives exactly those records (refused if any was edited since or has new
  dependants), importer or a leader within 7 days, audited as `import.undone`.
- `/import` page (stepper: upload → map → dry run → import → done) with recent batches and Undo. Accounts' "Import CSV"
  now links to it. Access as the account import (bd, executive, admin).
- Tests: `imports.test.ts`, RLS checks for `import_batches`, `e2e/import.spec.ts`.

Notes / inspect & adapt:

- Accounts created by an import default to type Private, sector Unclassified, country US, tier C, prospect.
- The service lets recruiters import staffing deals (same as `createOpportunity`), but `opportunities_insert` RLS
  doesn't allow recruiters, and `/import` is bd/leaders only, so in practice recruiters can't import yet.
- Undo with Supabase reads whole tables to find dependants; fine at CRM scale, revisit if tables grow large.

## PI-3 Sprint 10 — Duplicate detection and merge (KCRM-77, S10-03) and data quality view (KCRM-78, S10-04)

Delivered:

- Detection (`src/lib/domain/dedupe.ts` rules, `src/lib/services/dedupe.ts` service). Accounts: same name once legal
  suffixes (LLC, Inc, Corp, Ltd…), "the", punctuation, case and diacritics are ignored; same website domain; or names with
  trigram (pg_trgm-style) Jaccard similarity >= 0.6. Contacts: same email (case-insensitive; dots and +tags dropped for
  Gmail/Googlemail only), same normalised name at the same account, same phone digits (leading US "1" dropped). Signals
  combine as `100 × (1 − Π(1 − weight))`; every pair lists its reasons. Blocking keys and an inverted trigram index avoid
  comparing every pair. Archived records and dismissed pairs are excluded.
- `duplicate_dismissals` table ("Not a duplicate", with restore) and `merge_accounts()` / `merge_contacts()` SQL functions
  (one transaction, leaders only, Hub-id conflict refused); `Store.merge()` with the MemoryStore mirror in `src/lib/data/merge.ts`.
  The survivor keeps its id; the loser is archived with a timeline entry on the survivor and an `account.merged` /
  `contact.merged` audit row (before/after, loser id and snapshot).
- Re-pointed on account merge: contacts, opportunities, quotes, quote_lines (OEM partner), partner_vetting, project_health,
  client_items, synced_messages, activities (account_id + related), tasks (account_id + related), files, copilot_runs,
  record_tags, recent_views, notification links. On contact merge: activities, tasks, files, copilot_runs, synced_messages,
  event_leads (same-event leads folded together), record_tags, recent_views, notification links.
- `/duplicates` (Accounts / Contacts tabs, score + reasons, side-by-side field picker) linked from Accounts and Contacts for
  leaders; `/data-quality` in the Admin nav (leaders) with tiles and tabbed tables: accounts without an active owner, open
  deals past expected close, open deals missing value or close date, contacts without email, stale deals
  (`STALE_DEAL_DAYS = 30`), and the duplicates count.
- Seed: "Harborline Logistics, Inc." (Priya, from an expo) duplicates Marcus's "Harborline Logistics", with Samuel Porter
  (same mailbox and phone as Sam Porter), Dana Whitaker (no email) and the "Yard Telematics Pilot" deal (past its close date).
- Tests: `dedupe.test.ts`, `data-quality.test.ts`, permissions; RLS test covers dismissals and both merge functions;
  `e2e/data-quality.spec.ts`.

Notes / inspect & adapt:

- Merged accounts emit `account.updated` webhooks; Konnect Hub is not told about merges (its client id moves to the survivor).
- The loser's `konnect_hub_client_id` is cleared on archive so Hub lookups resolve to one account; the audit snapshot keeps it.
- Detection runs in the app over all active accounts/contacts (fine for thousands of rows); move it to `pg_trgm` in SQL if
  the book grows much larger.
