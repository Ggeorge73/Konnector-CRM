---
name: konnector-crm-builder
description: Build, extend or restyle Konnector CRM, Konnector LLC's internal CRM for winning work (accounts, capture pipeline, bids, quotes, vetting, bench) and its handoff to Konnect Hub. Use for any work on its modules, data model, design system or UI.
---

# Konnector CRM — builder skill

Konnector CRM is the internal CRM for **Konnector LLC**, a sector-agnostic technology
implementation firm (Georgia, USA) that helps governments and private organizations
deliver projects **on time, on budget and to acceptance criteria**, with staffing,
systems integration and technology reselling as supporting lines.

**Scope: winning the work.** The CRM covers first signal → capture → bid → award.
Delivery happens in **Konnect Hub**, Konnector's separate delivery platform
(github.com/Ggeorge73/Konnect-hub). Clients log into Konnect Hub, not the CRM.

| Konnector CRM owns | Konnect Hub owns |
|---|---|
| Accounts, contacts, activity timeline | Boards, tasks, sprints, milestones |
| Capture pipeline, Bid/No-Bid, quotes | Deliverables, client acceptance, change requests |
| Registrations, partner/OEM vetting | Risks/issues, status reports |
| Consultant bench (skills, rates, availability) | Assignments and time on the work |
| BD events, lead capture | Client portal and client users |

The two connect through one versioned, signed integration with three flows:
1. **Handoff** – "Won" creates the project in Konnect Hub.
2. **Health** – Konnect Hub sends Schedule / Budget / Acceptance back; the CRM shows it
   read-only on the account and opportunity.
3. **Commercial items** – the CRM publishes quotes, contract amendments, renewal offers
   and surveys to the client's Konnect Hub portal; the client's decision flows back and
   updates the CRM. Clients have **one door** (Konnect Hub); the CRM stays internal.

Read before writing code:
- `references/design-system.md` — tokens, glass surfaces, layout, components, motion
- `references/data-model.md` — entities, pipeline, roles, security, the handoff contract

## Non-negotiables

1. **Stack**: Next.js (App Router) + TypeScript (strict) + MUI v6 with a custom theme +
   Supabase (Postgres, Auth, Realtime, Storage) + Zod for every input + TanStack Query +
   Recharts + react-globe.gl. pnpm. Vitest + Playwright. If Konnect Hub already uses a
   different auth or database, match its identity approach so one login works for both
   (ask before deciding).
2. **Internal only.** No client portal and no client user roles in the CRM. Postgres RLS
   by role on every table; margins, rates, bid decisions and vetting restricted further.
3. **Never duplicate delivery.** No tasks boards, milestones, deliverables or status
   reports in the CRM. Link out to Konnect Hub instead.
4. **The integration is a contract.** Versioned, signed webhook/API payloads (see data
   model) for handoff, health and commercial items. Idempotent, retried, logged, and testable with a mock Konnect Hub.
5. **Design first.** Build the theme and component kit before feature pages. No raw MUI
   defaults on screen; no hard-coded colours outside the theme.
6. **Every record has a timeline**; **audit everything** that changes money, stage,
   ownership or permissions (`audit_log`, append-only).
7. **Seed realistic data** (Georgia state agencies, a federal agency, private clients,
   an OEM partner, consultants) so every screen looks alive.
8. **Ship in phases** and finish each one: migrations, RLS, UI, tests, seed, a commit.
9. Product name lives in one config value (`APP_NAME = "Konnector CRM"`).

## Workflow for any task

1. Read `CLAUDE.md`, both references and `docs/PROGRESS.md`.
2. If the data shape changes, write the migration + RLS policy first.
3. Server logic (route handlers / server actions with Zod) before UI.
4. UI from the component kit, with loading, empty and error states.
5. Verify: `pnpm typecheck && pnpm lint && pnpm test`; run the app and check the page in
   dark and light themes at 1440px and 390px. Add/update a Playwright test for the main
   path; add a role/RLS test whenever permissions are touched.
6. Update `docs/PROGRESS.md` and commit.

## Quality bar

- Loads with seeded data, no console errors, no layout shift.
- Cmd/Ctrl-K palette works; visible focus rings; tables keyboard-navigable.
- WCAG AA contrast on glass surfaces.
- Money with currency; dates in the user's time zone; relative times on timelines.
- A `bd` user cannot read margins/rates/bid scores they aren't entitled to (prove it).
- The handoff and the commercial-item round trip work end-to-end against the mock
  Konnect Hub, including retry, and published payloads contain no cost/margin fields.
