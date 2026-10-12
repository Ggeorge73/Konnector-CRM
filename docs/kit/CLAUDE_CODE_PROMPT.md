# Prompt for Claude Code — build "Konnector CRM"

> How to use: create an empty GitHub repo (e.g. `Ggeorge73/konnector-crm`), copy this
> kit's `.claude/` folder into it, open Claude Code there, and paste everything below the
> line. Claude Code picks up the `konnector-crm-builder` skill automatically.

---

You are the lead engineer and product designer building **Konnector CRM**, the internal
CRM for **Konnector LLC** — a Georgia-based, sector-agnostic technology implementation
company that helps governments (state, federal, international) and private organizations
deliver projects on time, on budget and to acceptance criteria, with staffing, systems
integration and technology reselling as supporting service lines.

**The CRM's job is winning the work.** Delivering the work happens in **Konnect Hub**,
our separate delivery platform (repo: github.com/Ggeorge73/Konnect-hub). Clients log into
Konnect Hub, never the CRM. The two apps connect at one point: when a deal is **Won**, the
CRM hands the project to Konnect Hub; Konnect Hub sends project health back.

**Before writing any code, load the `konnector-crm-builder` skill and read both reference
files** (`design-system.md`, `data-model.md`). They are the source of truth for stack,
design, data model, pipeline, roles, security and the handoff contract. If you can access
the Konnect Hub repo, read it too and match its auth, theme tokens and API where they
exist. Where this prompt, the skill and Konnect Hub disagree, ask me.

## What makes it ours, not a Salesforce copy

1. **Government capture built in**: solicitation numbers, procurement vehicle, NAICS,
   set-asides, question/proposal deadlines with countdowns, and a weighted **Bid/No-Bid
   scorecard** that gates the stage and needs executive approval.
2. **Registrations tracker**: SAM UEI/CAGE, Georgia supplier registration,
   certifications and insurance, with expiry alerts — so we never miss a bid on a lapsed
   registration.
3. **Partner & OEM vetting** (sanctions/PEP, beneficial ownership, anti-corruption
   checks, risk rating) and **reseller quotes** with margin guardrails.
4. **Talent bench**: skills, rates and availability, so BD can answer "can we staff
   this?" before bidding.
5. **One-click handoff**: Won → wizard → project created in Konnect Hub → its health
   ring (Schedule / Budget / Acceptance) appears back on the account.
6. **One client door**: quotes, contract amendments, renewal offers and surveys are
   published from the CRM into the client's Konnect Hub portal; the client's decision
   comes back and moves the deal automatically.
7. **Pulse home**: dot-matrix globe of accounts with arcs from Atlanta HQ to live
   projects, plus pipeline, win-rate, deadline and registration-expiry tiles.

## Build plan — phases, finishing each before the next

Use the task list. At the end of every phase: run typecheck, lint, unit tests and the
Playwright smoke test; open the running app and check new screens in dark and light mode
at desktop and mobile widths; fix what you find; update `docs/PROGRESS.md`; commit. Then
show me a short summary with screenshots and wait for my "go".

**Phase 0 — Foundation**
- Scaffold Next.js (App Router, TypeScript strict, pnpm), MUI v6, Supabase (local via
  Supabase CLI + Docker), ESLint/Prettier, Vitest, Playwright, GitHub Actions CI.
- Write `CLAUDE.md` (commands, conventions, folder map, the CRM/Konnect Hub boundary) and
  `.env.example`. Product name in one config value.
- Theme + full component kit from the design system, with a `/_kit` page showing every
  component in every state.
- App shell: floating sidenav, top bar, Cmd/Ctrl-K palette, theme toggle, auth (Google +
  email magic link, internal domain only), role-based route guards.

**Phase 1 — Core CRM**
- Migrations + RLS: organizations, users/roles, accounts, contacts, activities, tasks,
  files, tags, saved views, notifications, audit log.
- Accounts and Contacts: lists (saved views, filters, bulk actions, CSV import/export)
  and record pages (RecordHeader, tabs, Timeline, related lists).
- Unified Timeline: notes, calls, meetings, emails, @mentions, file uploads.
- My Work page: follow-ups due, mentions, recently viewed.
- Realistic seed data.

**Phase 2 — Capture pipeline**
- Opportunities with the stage model; Kanban (drag-and-drop, stage-gate dialogs) and
  table views; forecast by stage and service line.
- Public-bid fields, deadline countdowns, calendar of proposal due dates.
- Bid/No-Bid scorecard (weights configurable in Settings) + executive approval.
- Quotes with line items, margin guardrails (warn below a set %, require executive
  approval), PDF export.
- Registrations tracker and partner vetting with reminders.
- Role tests: prove a `bd` user can't read cost rates, margins, bid scores or vetting
  they aren't entitled to.

**Phase 3 — Bench, events, handoff and Pulse**
- Consultants (skills, rates, availability) with a "who can staff this?" search from an
  opportunity.
- BD events with lead capture and auto follow-up tasks.
- **Handoff to Konnect Hub** exactly as the data model specifies: Won wizard, signed
  versioned payload, retries, idempotency, handoff status on the opportunity, inbound
  `project.health_updated` webhook, read-only HealthRing + "Open in Konnect Hub" link.
  Build and test against a mock Konnect Hub first; switch to the real endpoint via env.
- Pulse home: PulseGlobe, KPI tiles (pipeline value, weighted pipeline, win rate, bids
  due in 14 days, registrations expiring, projects at risk from Konnect Hub health),
  charts.
- Notifications centre (in-app + email digest); Supabase Realtime for live timeline and
  kanban updates.

**Phase 4 — Client commercial loop (via Konnect Hub)**
- `client_items` exactly as the data model specifies: Publish button on quotes, plus
  contract amendments, renewal offers and surveys; preview of exactly what the client
  will see; version history; withdraw.
- Outbound `client_item.published` / `withdrawn`; inbound `client_item.viewed` /
  `decided` and `survey.submitted`, with the automatic follow-ups (quote accepted → Won
  → handoff; renewal/amendment accepted → `project.extended`; changes requested → task;
  low survey score → alert).
- Daily expiry job and owner nudges; "Awaiting client" widget on Pulse and My Work.
- Tests: full round trip against the mock Konnect Hub; a payload test proving unit cost,
  margin and internal notes never leave the CRM.
- Note: the Konnect Hub side is built from a separate add-on prompt in that repo; keep
  the payloads identical to the data model so both sides match.

**Phase 5 — AI assist and integrations** (ask me before starting)
- "Konnector Copilot" side panel using the Claude API (server-side key only): summarise
  an account, draft a follow-up email from the timeline, suggest a Bid/No-Bid verdict
  with reasons, turn meeting notes into follow-ups, summarise an RFP into a compliance
  checklist. Nothing is sent without a human click.
- Google Workspace / Microsoft 365: sync email and calendar to the timeline; send from
  the user's own address.
- Documented REST API + webhooks for later tools (accounting, e-signature).

## Rules

- Follow the skill's non-negotiables and quality bar on every change.
- **Do not build delivery features** (task boards, milestones, deliverables, client
  portal, status reports) — those belong to Konnect Hub. If something seems to need
  them, link out or ask me.
- No placeholder screens; every page works with seeded data.
- No secrets in the repo; keys via env vars; Claude API calls server-side only.
- Don't copy code or assets from commercial templates; build the look ourselves.
- Prefer well-supported libraries; explain any new dependency in the commit.
- For decisions that are expensive to undo (auth provider, shared database with Konnect
  Hub, hosting), ask me first with 2–3 options and your recommendation.

Start with Phase 0. First show me the folder structure and the Phase 1 migration list,
then build.
