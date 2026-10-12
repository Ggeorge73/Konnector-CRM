# Add-on prompt for Claude Code — connect Konnect Hub to Konnector CRM

> How to use: open Claude Code in the **Konnect Hub** repo
> (github.com/Ggeorge73/Konnect-hub), copy `.claude/skills/konnector-crm-builder/references/data-model.md`
> from the CRM kit into `docs/integration/crm-contract.md`, then paste everything below
> the line. Run it when Konnect Hub has its core boards, projects and client portal in
> place.

---

Konnect Hub is Konnector LLC's project delivery platform and the **only place clients
log in**. Konnector CRM is a separate internal app where the team wins work. Add the
integration that connects the two, following the contract in
`docs/integration/crm-contract.md` exactly (sections "Handoff to Konnect Hub" and
"Client commercial items"). Read this repo's `CLAUDE.md` and existing code first and fit
everything into its current stack, auth, roles, theme and patterns — do not introduce a
second auth system or a second UI style.

## 1. Integration foundation
- `/api/integrations/crm/*` endpoints. Verify the HMAC-SHA256 `X-Konnector-Signature`
  on every inbound call with a shared secret from env; reject unsigned or stale calls.
- Idempotency on `idempotency_key` / `item_id + version`; store every inbound and
  outbound event in an `integration_events` log with status, attempts and errors.
- Outbound calls to the CRM signed the same way, retried with backoff.
- An admin-only "Integrations" page showing recent events, failures and a retry button.
- A mock CRM (dev flag) so the whole flow can be tested locally.

## 2. Receive the handoff (`opportunity.won`)
- Create (or match, via `konnect_hub_client_id`) the client organization, create the
  project with name, contract no., value, dates, service lines, scope summary and
  acceptance-criteria headlines, attach the documents, assign the delivery lead.
- Invite the listed client contacts to the portal with the given roles.
- Return `konnect_hub_client_id`, `konnect_hub_project_id` and the project URL.
- Handle `project.extended` (new end date and/or value) with a visible change entry on
  the project.

## 3. Send project health (`project.health_updated`)
- Whenever schedule, budget or acceptance status changes (and at least daily), send
  health_schedule / health_budget / health_acceptance (green/amber/red),
  percent_complete, status and updated_at for each project.
- Make sure the health rules here are the single source of truth; the CRM only displays.

## 4. Commercial items in the client portal
- Store items received via `client_item.published` (quote, contract_amendment,
  renewal_offer, survey) per client organization and, when given, per project.
- Portal: a **"For your review"** section on the client dashboard and project page with
  a badge count; item page showing title, summary, price lines, total, terms, the PDF,
  respond-by date and version ("supersedes v1").
- Actions for client users with approval rights (client admin or a designated
  approver): **Accept**, **Request changes** (note required), **Decline** (note
  optional). Accept asks for name and title and records email, time and IP. If the item
  links to an e-signature envelope, show "Sign" instead and follow the envelope status.
- Surveys: a simple 0–10 score plus an optional comment.
- Send `client_item.viewed` on first open, `client_item.decided` on any decision and
  `survey.submitted` for surveys. Handle `client_item.withdrawn` by hiding the item and
  showing "withdrawn by Konnector" if someone opens an old link.
- Notify client approvers by email when a new item arrives and remind them 3 days
  before respond-by. Notify the Konnector delivery lead when a client decides.
- Internal Konnect Hub users can see these items read-only on the project, but cannot
  create or edit them — they are owned by the CRM.

## 5. Security and tests
- Client users only ever see items for their own organization.
- Commercial items never include cost or margin data; add a test that rejects any
  inbound payload containing fields outside the contract.
- End-to-end tests against the mock CRM: handoff → project created; health sent;
  item published → viewed → accepted / changes requested / declined; withdrawn; survey.
- Keep the payload shapes identical to the contract. If you need to change one, stop and
  ask me, because the CRM must change too.

Finish with typecheck, lint, tests and a run-through of the portal flow in dark and light
mode at desktop and mobile widths; update `docs/PROGRESS.md`; commit; show me
screenshots of the "For your review" flow.
