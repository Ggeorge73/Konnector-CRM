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
