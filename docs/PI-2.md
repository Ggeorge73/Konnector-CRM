# PI-2 — Copilot, mailbox sync, public API

**Program Increment:** PI-2 · 3 sprints, delivered in parallel by three teams · Jira epic **KCRM-6**
**Objective:** help the BD team move faster without losing control: Claude drafts, people decide;
email and meetings land on the timeline on their own; other systems can read and react to the CRM.

Approved by the Product Owner ("continue with KCRM-6"). Same board flow as PI-1:
`To Do → In Progress → Pull Request → Testing → Done`.

## Plan

| Sprint                         | Team               | Stories      | Points |
| ------------------------------ | ------------------ | ------------ | ------ |
| S6 Konnector Copilot           | `team-copilot`     | KCRM-45 … 51 | 25     |
| S7 Workspace / M365 sync       | `team-integration` | KCRM-52 … 55 | 18     |
| S8 REST API, keys and webhooks | `team-platform`    | KCRM-56 … 60 | 19     |
| REL-02 system demo             | `team-rte`         | KCRM-61      | 2      |

## Guardrails (all sprints)

- The Claude API key and mailbox OAuth secrets live only in server env vars; nothing reaches the browser.
- Copilot builds its context only through the role-scoped services, from explicitly picked fields.
  Cost-side data (unit cost, margins, consultant cost rates, vetting) never enters a prompt.
- Nothing Copilot writes is sent or saved without a person clicking a button. Bid suggestions only
  pre-fill the scorecard; executives still approve.
- Prompts and answers are not stored. `copilot_runs` keeps usage only (task, record, status, tokens, time).
- Per-user limit of 40 Copilot requests an hour.
- OAuth tokens and webhook secrets are encrypted at rest (AES-256-GCM, `APP_ENCRYPTION_KEY`); API keys are
  stored as SHA-256 hashes.
- Without `ANTHROPIC_API_KEY`, Copilot runs in demo mode with deterministic answers built from CRM data.
