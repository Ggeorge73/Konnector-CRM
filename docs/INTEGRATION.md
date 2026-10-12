# Konnector CRM ⇄ Konnect Hub integration (contract v1)

Source of truth: `.claude/skills/konnector-crm-builder/references/data-model.md` and the Zod schemas in
`src/lib/integration/contract.ts`. Konnect Hub implements its side from
`docs/kit/KONNECT_HUB_ADDON_PROMPT.md`; keep payload shapes identical on both sides.

## Transport

|             |                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| CRM → Hub   | `POST {KONNECT_HUB_BASE_URL}/events` with headers `X-Konnector-Event`, `X-Konnector-Signature`                                          |
| Hub → CRM   | `POST {APP_URL}/api/integrations/konnect-hub` with `X-Konnector-Signature`                                                              |
| Signature   | `t=<unix ms>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`; receivers reject > 5 min skew                                             |
| Secret      | `KONNECTOR_INTEGRATION_SECRET` (same value on both sides)                                                                               |
| Idempotency | outbound `idempotency_key` (handoff id; `<item>:v<n>:publish` …); inbound keyed by event + item/project + version/timestamp             |
| Retries     | outbound: 1, 2, 4, 8, 16 min backoff, 6 attempts; 4xx (except 408/429) fails fast. `POST /api/cron/integrations` (Bearer `CRON_SECRET`) |
| Log         | every event in `integration_events` (direction, status, attempts, last error, payload); admin page `/integrations` with Retry           |

## Events

| Event                    | Direction | Notes                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opportunity.won`        | CRM → Hub | Handoff wizard. Hub returns `{ konnect_hub_client_id, konnect_hub_project_id, project_url }`. Documents are 7-day signed links.                                                                                                                                                                                           |
| `project.extended`       | CRM → Hub | Accepted renewal / amendment: new end date and/or additional value.                                                                                                                                                                                                                                                       |
| `client_item.published`  | CRM → Hub | Client-facing fields only: title, summary, price lines (qty × unit price), total, terms, PDF link, respond-by, version + `supersedes_version`, `requires_signature`.                                                                                                                                                      |
| `client_item.withdrawn`  | CRM → Hub | Hide the item; old links show "withdrawn by Konnector".                                                                                                                                                                                                                                                                   |
| `project.health_updated` | Hub → CRM | Schedule / budget / acceptance (green/amber/red), % complete, status. Stored read-only in `project_health`; red or worsening alerts the account owner. Stale updates ignored.                                                                                                                                             |
| `client_item.viewed`     | Hub → CRM | First open in the portal → status `viewed`, owner notified.                                                                                                                                                                                                                                                               |
| `client_item.decided`    | Hub → CRM | `accepted` / `declined` / `changes_requested` with name, title, email, time, IP. Quote accepted → quote accepted, deal Won, handoff sent automatically (task if it can't). Renewal/amendment accepted → child deal Won + `project.extended`. Changes requested → high-priority task for the owner with the client's note. |
| `survey.submitted`       | Hub → CRM | Score 0–10 stored on the item and the account; ≤ `low_survey_threshold` (default 6) alerts the owner.                                                                                                                                                                                                                     |

## Never leaves the CRM

Unit cost, margin, internal notes, consultant cost rates, bid scores/weights and vetting results. The
strict schemas reject unknown keys and `findForbiddenKeys()` blocks any payload containing them
(`src/lib/__tests__/client-items.test.ts`, `integration.test.ts`).

## Local development

`MOCK_KONNECT_HUB=true` with an empty `KONNECT_HUB_BASE_URL` routes outbound events to an in-process mock
that verifies signatures, enforces idempotency and the contract, and creates fake clients/projects.
`POST /api/mock-konnect-hub/simulate` (dev only) sends signed Hub → CRM events; client item pages have
"Simulate the client" buttons in demo mode. `{ "control": { "failNext": 2 } }` makes the next deliveries
fail to exercise retries.
