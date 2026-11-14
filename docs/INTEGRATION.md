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

## Website enquiries (konnectortech.com → CRM)

A separate, one-way contract: the rebuilt website pushes each enquiry so it lands in the pipeline as a **Signal**-stage
opportunity with source **inbound**. Sender: `pushLead` in `rebuild/functions/api/contact.js`
(repo `Ggeorge73/konnectortech_website`). Receiver: `POST /api/integrations/website-enquiry` →
`receiveWebsiteEnquiry` in `src/lib/services/website-leads.ts`.

|             |                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request     | `POST {APP_URL}/api/integrations/website-enquiry`, `Content-Type: application/json`                                                                        |
| Signature   | `X-Konnector-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>`. No timestamp (unlike the Hub scheme above), so safety against replays is idempotency. |
| Secret      | CRM `LEAD_WEBHOOK_SECRET` = website `LEAD_WEBHOOK_SECRET`. No default: while it is unset the endpoint answers `503` to everything.                         |
| Website env | `LEAD_WEBHOOK_URL=https://<crm host>/api/integrations/website-enquiry` and the secret. The site only signs when the secret is set.                         |
| Idempotency | `website.enquiry:<receivedAt as UTC ISO>:<email, lower-cased>`, unique in `integration_events`. A repeat returns `200` with `"idempotent_replay": true`.   |
| Log         | `integration_events` (direction `inbound`, event `website.enquiry`), visible on `/integrations`. The payload (name, email, message) is stored there.       |

```json
{
  "event": "website.enquiry",
  "stage": "signal",
  "source": "inbound",
  "lead": {
    "name": "Ada Lovelace",
    "email": "ada@brightwater.example.com",
    "organization": "Brightwater County Schools",
    "sector": "Public sector",
    "message": "We need a student information system migrated before the new school year.",
    "deadline": "August 2027",
    "receivedAt": "2026-11-14T15:04:05.000Z",
    "page": "/contact"
  }
}
```

`sector` is `Public sector`, `Private sector` or `Not sure yet`. `deadline` and `page` may be empty. Unknown fields are
ignored, so the website can add fields without breaking the push.

| Status | Body                                                                               | When                                                                     |
| ------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 200    | `{ ok, account_id, contact_id, opportunity_id, account_created, contact_created }` | Recorded                                                                 |
| 200    | the same, plus `"idempotent_replay": true`                                         | Already recorded; nothing new is written                                 |
| 400    | `{ error: "invalid JSON" }`                                                        |                                                                          |
| 401    | `{ error: "missing signature" \| "malformed signature" \| "bad signature" }`       | Checked before the body is parsed                                        |
| 413    | `{ error: "payload too large" }`                                                   | Body over 32 KB                                                          |
| 422    | `{ error: "invalid enquiry", details: [{ path, message }] }`                       | Zod validation (`WebsiteEnquiry`)                                        |
| 500    | `{ error: "could not record the enquiry" }`                                        | Event marked `failed` with the reason; sending it again finishes the job |
| 503    | `{ error: "website enquiries are not configured" }`                                | `LEAD_WEBHOOK_SECRET` is not set                                         |

### What one enquiry creates

1. **Account** — matched on the organization name, ignoring case, punctuation and legal suffixes (`normalizeCompanyName`,
   the duplicate-detection rule). A match is reused untouched; otherwise one is created with the defaults below.
2. **Contact** — matched on email within that account; otherwise created from the name (first word = first name).
3. **Opportunity** — always a new one, `Website enquiry: <organization>`, stage `signal`, source `inbound`.
4. **Timeline** — the enquiry text as a note on the opportunity (dated `receivedAt`, with sender, sector, deadline and
   page), plus the usual "Account created" / "Opportunity created" / "Contact added" system entries. `@Name` in the
   visitor's text does not notify anyone.
5. **Audit** — `account.created`, `opportunity.created` and `website_enquiry.received` (ids, owner, `received_at`), actor
   `null` (the integration). The owner gets an in-app alert linking to the deal. Outbound webhooks
   (`account.created`, `opportunity.created`) fire as for any other new record.

### Defaults for what the form doesn't ask

Defined once in `WEBSITE_LEAD_DEFAULTS` (`src/lib/services/website-leads.ts`). They are placeholders for the owner to
correct while qualifying, and match the CSV import defaults.

| Field                          | Default                                                                                                                                                                | Why                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Account type                   | `Public sector` → `government_local`; `Private sector` / `Not sure yet` → `private`                                                                                    | The form doesn't ask the level of government             |
| Account sector                 | `Unclassified`                                                                                                                                                         | Industry unknown                                         |
| Account country                | `US`                                                                                                                                                                   | Home market                                              |
| Account tier / status          | `C` / `prospect`                                                                                                                                                       | Unqualified                                              |
| Opportunity kind               | `Public sector` → `public_bid`; otherwise `private_deal`                                                                                                               | Mirrors the account type                                 |
| Opportunity value              | `0` USD                                                                                                                                                                | Unknown; listed under "missing value" on `/data-quality` |
| Opportunity service lines      | `["advisory"]`                                                                                                                                                         | One is required; a first conversation is advisory        |
| Next step                      | "Reply to website enquiry", due the next weekday after `receivedAt`                                                                                                    | The website promises a reply within one business day     |
| Contact last name              | `(not given)` when the visitor typed a single word                                                                                                                     | The form has one name field                              |
| Owner (account, contact, deal) | Existing account → its owner. New account → `LEAD_DEFAULT_OWNER_EMAIL` if it is an active admin, executive or bd; otherwise the longest-standing admin, then executive | The integration actor can't own records                  |

Try it locally (`LEAD_WEBHOOK_SECRET=dev-secret pnpm dev`):

```bash
BODY='{"event":"website.enquiry","stage":"signal","source":"inbound","lead":{"name":"Ada Lovelace","email":"ada@example.com","organization":"Brightwater County Schools","sector":"Public sector","message":"We need a system migrated.","deadline":"","receivedAt":"2026-11-14T15:04:05.000Z","page":"/contact"}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac dev-secret -r | cut -d' ' -f1)
curl -s localhost:3000/api/integrations/website-enquiry -H "X-Konnector-Signature: sha256=$SIG" -d "$BODY"
```

Tests: `src/lib/__tests__/website-leads.test.ts` (signature rejection, validation, idempotency, created records, reuse
of existing accounts/contacts, retry after a failure).

## Other internal tools

Konnect Hub is the only system on the v1 contract above. Other internal tools (accounting, e-signature, BI) use the REST API
(`/api/v1`) and outbound webhooks, which reuse the same `X-Konnector-Signature` scheme and the same cost-field guard.
See `docs/API.md`.
