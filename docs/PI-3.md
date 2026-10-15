# PI-3 — Go live

**Program Increment:** PI-3 · 4 iteration sprints (S9–S12) + IP · Jira project **KCRM**
**Objective:** put Konnector CRM in front of the BD team for real work: running in production on
Supabase, loaded with Konnector's existing data, connected to the live Konnect Hub, and hardened
(security, accessibility, performance) so leadership can rely on it.

PI-1 built the CRM and PI-2 added Copilot, mailbox sync and the API. Everything still runs on demo data
and mocks. PI-3 turns it into the system the team works in every day.

## PI objectives

| #   | Objective                                                                  | Business value | Committed |
| --- | -------------------------------------------------------------------------- | -------------- | --------- |
| 1   | Production environment live with sign-in, scheduled jobs, backups, alerts  | 10             | Yes       |
| 2   | Existing accounts, contacts and pipeline imported, de-duplicated and owned | 9              | Yes       |
| 3   | Live handoff and health with Konnect Hub, verified end to end              | 8              | Yes       |
| 4   | Security, accessibility (WCAG 2.1 AA) and performance pass                 | 7              | Yes       |
| 5   | BD team pilot and feedback loop, including Copilot quality                 | 6              | Stretch   |

## Plan

| Sprint                       | Epic    | Stories          | Points | Team                       | Focus                                                                         |
| ---------------------------- | ------- | ---------------- | ------ | -------------------------- | ----------------------------------------------------------------------------- |
| S9 Production platform       | KCRM-62 | KCRM-67 … 74     | 27     | `team-platform`            | Hosting, Supabase prod, CI/CD, scheduled jobs, monitoring, shared limiter     |
| S10 Data onboarding          | KCRM-63 | KCRM-75 … 78     | 18     | `team-capture`             | Contact and pipeline import, duplicate detection and merge, data quality      |
| S11 Konnect Hub live + pilot | KCRM-64 | KCRM-79 … 82     | 16     | `team-integration`         | Staging pairing, contract tests, cutover runbook, pilot with the BD team      |
| S12 Hardening and adoption   | KCRM-65 | KCRM-83 … 88     | 23     | `team-rte`, `team-copilot` | Security review, accessibility, performance, Copilot feedback, live mailboxes |
| IP: PI-4 candidates          | KCRM-66 | KCRM-89, KCRM-90 | (16)   | —                          | E-signature and accounting connectors (needs PO approval, not committed)      |

Committed: **84 points** across S9–S12, in line with PI-2's pace (64 points in 3 sprints). The first story,
KCRM-67, is the hosting decision; the rest of S9 waits on it.

## Decisions the Product Owner owns (expensive to undo)

| Decision                        | Options                                                    | Recommendation                                                                               |
| ------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Hosting                         | Vercel · Netlify · container on Fly.io / Azure App Service | **Vercel**: native Next.js, preview deploys per PR, built-in cron for the three jobs         |
| Supabase plan                   | Free · Pro · Team                                          | **Decided:** Free for staging and the pilot, production to **Pro** before go-live (ADR 0001) |
| Production auth                 | Google only · Google + Microsoft · magic link fallback     | **Google + magic link** restricted to `konnectorllc.com` (what is built today)               |
| E-signature / accounting (PI-4) | DocuSign · Dropbox Sign; QuickBooks Online · Xero          | Decide at the PI-3 system demo, after the pilot shows where the friction is                  |

## Dependencies

- **Konnect Hub** must have the add-on from `docs/kit/KONNECT_HUB_ADDON_PROMPT.md` built and a staging URL
  before S11 starts. Until then the CRM keeps using its mock hub.
- **Google Cloud and Azure** app registrations for mail sync (owner: PO / IT) before S12-05.
- **Existing data exports** (spreadsheets or the old CRM) from the BD team before S10.

## Risks (ROAM)

| Risk                                              | ROAM           | Notes                                                                              |
| ------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| Hosting not chosen                                | **Owned** (PO) | S9-01 is the first story; the rest of S9 is host-agnostic until the choice is made |
| Konnect Hub add-on not ready for S11              | **Owned**      | S11 starts with contract tests both repos run; pilot can start on the mock hub     |
| Legacy data is messy (duplicates, missing owners) | **Mitigated**  | Dry-run import with a preview and error report; duplicate merge; data quality view |
| Per-instance rate limits once scaled out          | **Mitigated**  | S9-07 moves limits to a shared store                                               |
| Jira sprints 9–12 can't be created via the API    | **Accepted**   | Stories carry `sprint-sN` labels; PO creates and starts sprints on the board       |

## Board

Same flow as PI-1 and PI-2: `To Do → In Progress → Pull Request → Testing → Done`.
