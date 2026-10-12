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
