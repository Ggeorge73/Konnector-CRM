# Konnector CRM — working notes for Claude Code

Internal CRM for Konnector LLC: **winning the work** (accounts → capture → bid → award).
Delivery lives in **Konnect Hub** (github.com/Ggeorge73/Konnect-hub). Never build delivery
features here (task boards, milestones, deliverables, client portal, status reports) — link out.

Source of truth: `.claude/skills/konnector-crm-builder/` (SKILL.md + references/design-system.md

- references/data-model.md). Original build prompts are in `docs/kit/`.

## Commands

| Task                           | Command                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Dev server (demo data)         | `pnpm dev` → http://localhost:3000, sign in as any seeded role                        |
| Typecheck / lint / format      | `pnpm typecheck` · `pnpm lint` · `pnpm format`                                        |
| Unit tests (Vitest)            | `pnpm test`                                                                           |
| E2E (Playwright, builds first) | `pnpm build && pnpm test:e2e` (set `PW_CHROMIUM_PATH` to use a preinstalled Chromium) |
| RLS tests against Postgres     | `DATABASE_URL=postgres://… pnpm test:rls`                                             |
| Regenerate `supabase/seed.sql` | `pnpm db:seed-sql`                                                                    |

## Architecture

```
src/
  config/app.ts          APP_NAME + env flags (single place for the product name)
  theme/                 tokens.ts (all colours) → theme.ts (MUI v6)
  components/kit/        GlassCard, StatTile, PulseGlobe, KanbanBoard, DataTable, RecordHeader,
                         Timeline, HealthRing, ScoreCard, EmptyState, StatusChip, Countdown, Money
  components/shell/      AppShell (floating sidenav, top bar, Cmd/Ctrl-K), nav.ts (+ SHIPPED routes)
  lib/domain/            types.ts (row types = migrations), pure domain rules (bid scoring, margins…)
  lib/data/              Store port; MemoryStore (demo/tests); SupabaseStore (RLS); seed.ts
  lib/auth/              permissions.ts (role rules, mirrored by RLS), session.ts (current user)
  lib/services/          All reads/writes. Take a Ctx {user, store, now}; scope + redact by role,
                         validate with Zod, write audit_log + timeline.
  lib/integration/       Konnect Hub contract: signing, payloads, outbox with retries
  app/(app)/             Authenticated pages (layout applies role route guards)
  app/api/               search, integrations (inbound webhooks), mock-konnect-hub, cron, dev
supabase/migrations/     SQL schema + RLS (has_role(), ownership/sharing). Keep in sync with types.ts
e2e/                     Playwright specs (demo backend, store reset per test)
```

## Conventions

- Server logic first (service + Zod), then UI from the kit with loading/empty/error states.
- No hard-coded colours outside `src/theme/tokens.ts`; no raw MUI defaults on screen.
- Money = number + ISO currency, rendered with `money()` / `<Money>` (mono font). Dates via `lib/format`.
- Audit (`audit()`) anything touching money, stage, ownership or permissions.
- Cost-side fields (quote unit cost/margins, consultant cost rates, bid decisions, vetting) are
  redacted in services **and** blocked by RLS. Add a test whenever permissions change.
- Integration payloads to Konnect Hub carry client-facing data only — see `lib/integration`.
- Add a route to `SHIPPED` in `components/shell/nav.ts` when its page lands.
- Commit per story/sprint; update `docs/PROGRESS.md`.

## Delivery process

SAFe-style PI plan in `docs/PI-1.md`; Jira project **KCRM** (board columns: To Do → In Progress →
Pull Request → Testing → Done, same as DiamondEcho). Move tickets as work progresses.

## Jobs and integration

- `POST /api/cron/integrations` (every 5 min) — retry due Konnect Hub deliveries. `POST /api/cron/daily` —
  client-item expiry + nudges, registration/vetting reminders, email digests. `POST /api/cron/mail-sync` (every 15 min) —
  mailbox/calendar sync. All accept GET (Vercel Cron, schedules in `vercel.json`) or POST and need
  `Authorization: Bearer $CRON_SECRET`. The integrations cron also retries webhooks.
- Production: Vercel + Supabase Pro (`docs/adr/0001-hosting.md`, setup in `docs/DEPLOY.md`, runbooks in
  `docs/OPERATIONS.md` and `docs/SECURITY.md`). New users are **pending** (`users.role` null) until an admin assigns
  a role; every new table needs its restrictive `<table>_active_user_only` RLS policy (rls-test enforces it).
- PI-2: Copilot (`lib/copilot`, `docs/COPILOT.md`; Claude API server-side only, demo without `ANTHROPIC_API_KEY`),
  mail sync (`lib/mail`, `docs/MAIL.md`), REST API v1 + webhooks (`lib/api`, `docs/API.md`, `/developer`).
- Contract and event list: `docs/INTEGRATION.md`. PI-2 plan: `docs/PI-2.md`. Database and RLS: `docs/DATABASE.md`.
- Before pushing: `pnpm verify` (typecheck, lint, format:check, unit tests), then `pnpm build && pnpm test:e2e`.
  Parallel runs: `NEXT_DIST_DIR=.next-x E2E_PORT=34xx PW_OUTPUT=test-results-x`. Never commit the
  `tsconfig.json` include that Next adds for a custom dist dir.
