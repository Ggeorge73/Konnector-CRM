# PI-1 — Konnector CRM MVP

**Program Increment:** PI-1 · 5 iteration sprints + IP · Jira project **KCRM** (board 71)
**Objective:** ship an internal CRM that lets Konnector win government and private work and hand
won deals to Konnect Hub, with every screen working on realistic seeded data.

## SAFe team (Agile Release Train of one ART)

| SAFe role                                 | Who                               | Responsibilities                                                                      |
| ----------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| Business Owner / Product Owner            | Olugbenga George (`owner-gbenga`) | Vision, priorities, acceptance, approvals for expensive-to-undo decisions and Phase 5 |
| Release Train Engineer + System Architect | Claude Code (lead session)        | PI planning, Jira flow, architecture, integration contract, code review, merges       |
| Platform team (`team-platform`)           | Claude agents                     | Foundation, design system, core CRM, RLS                                              |
| Capture team (`team-capture`)             | Claude agents                     | Pipeline, Bid/No-Bid, quotes, compliance                                              |
| Integration team (`team-integration`)     | Claude agents                     | Konnect Hub handoff, health, client commercial loop, Pulse                            |
| System team / QA (`team-rte`)             | Claude agents                     | CI, Playwright, RLS role tests, system demo                                           |

Ceremonies are run asynchronously: each sprint ends with a green PR (= iteration review /
system demo), tickets moved to Done, and `docs/PROGRESS.md` updated (= inspect & adapt notes).

## Board (same flow as DiamondEcho delivery)

`To Do → In Progress → Pull Request → Testing → Done`

- **In Progress** when a story's implementation starts.
- **Pull Request** when the sprint PR is opened.
- **Testing** while CI (typecheck, lint, unit, build, Playwright) runs on the PR.
- **Done** when CI is green and the PR is merged to `main`.

## Plan

| Sprint                    | Epic   | Stories      | Points | Business value    |
| ------------------------- | ------ | ------------ | ------ | ----------------- |
| S1 Foundation             | KCRM-1 | KCRM-7 … 14  | 35     | 8                 |
| S2 Core CRM               | KCRM-2 | KCRM-15 … 22 | 35     | 9                 |
| S3 Capture pipeline       | KCRM-3 | KCRM-23 … 31 | 41     | 10                |
| S4 Bench, handoff, Pulse  | KCRM-4 | KCRM-32 … 37 | 34     | 9                 |
| S5 Client commercial loop | KCRM-5 | KCRM-38 … 44 | 29     | 8                 |
| IP / PI-2 candidate       | KCRM-6 | —            | —      | needs PO approval |

## Risks (ROAM)

| Risk                                                   | ROAM           | Notes                                                                                             |
| ------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------- |
| Konnect Hub API not built yet                          | **Mitigated**  | Contract in data-model.md; mock Konnect Hub behind `MOCK_KONNECT_HUB`; switch by env              |
| Hosting / shared DB / auth provider are costly to undo | **Owned** (PO) | Kit mandates Supabase; hosting not chosen — app is host-agnostic; PO to confirm before production |
| Jira sprints 2–5 can't be created via API              | **Accepted**   | PO creates/starts sprints in Jira; stories carry `sprint-sN` labels                               |
| Supabase local needs Docker                            | **Mitigated**  | Demo store for dev/CI; RLS verified against plain Postgres in tests                               |
