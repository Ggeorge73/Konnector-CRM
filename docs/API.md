# REST API v1 and outbound webhooks

Konnector CRM has a small REST API for scripts and other internal tools, and outbound webhooks that push CRM events to
them. Both are managed on **API & webhooks** (`/developer`). The machine-readable reference is the OpenAPI 3.1 document at
`GET /api/v1/openapi.json` (public, no data), generated in `src/lib/api/openapi.ts` from the same Zod schemas the services
validate with.

## Authentication

Every user can create personal API keys on `/developer`. A key looks like `kcrm_<8 hex prefix>_<64 hex secret>` and is
shown **once**. Only the prefix (for display) and a SHA-256 hash of the whole key are stored (`api_keys`); keys can't be
recovered, only revoked and replaced.

```bash
curl https://crm.konnectorllc.com/api/v1/opportunities?stage=proposal \
  -H "Authorization: Bearer kcrm_1a2b3c4d_…"
```

- **Scopes**: `read` allows `GET`. `write` adds `POST` and `PATCH` (and implies `read`).
- **Expiry**: optional (30 / 90 / 365 days from the UI). Expired and revoked keys get `401`.
- `last_used_at` is updated at most once per minute per key.
- Creating and revoking keys is written to `audit_log` (`api_key.created`, `api_key.revoked`). Owners revoke their own
  keys; admins can revoke anyone's.

## Security model — read this before changing anything under `src/lib/api`

A request runs **as the key's user**. The route handlers build a service context `{ user, store, now }` for that user and
call the **same services the UI uses** (`visibleAccounts`, `getOpportunity`, `createAccount`, `moveStage`, `logActivity`,
…). Role scoping, redaction, Zod validation, stage gates and audit are therefore identical to the app.

The store (`src/lib/api/store.ts`):

| Backend                    | Store used by `/api/v1`                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| demo (`DATA_BACKEND=demo`) | the shared in-memory demo store                                                                            |
| Supabase                   | a **service-role** client. API keys aren't Supabase sessions, so there is no user JWT for RLS to evaluate. |

Because the Supabase store bypasses RLS, **all access control is in the service layer** for API requests. Never read or
write `apiStore()` directly from a route handler; add a resource to `src/lib/api/resources.ts` that goes through a service
(and add a test in `src/lib/__tests__/api.test.ts` proving a `bd` key can't see what it shouldn't). The same applies to the
API-key and webhook services (`src/lib/services/privileged.ts`), which use the service role so they can read `key_hash` /
`secret_enc`, columns that `authenticated` can't select.

**Cost-side fields are never returned by the API**, to anyone: quote `unit_cost`, margins and `internal_notes`, consultant
cost rates, bid scores, vetting. Quotes are served in their client-facing shape (lines with `qty × unit_price` and a
`total`). Consultants, bid decisions and vetting have no API resource.

## Resources

All paths are under `/api/v1`. `{id}` is a UUID.

| Resource         | List / get                                               | Create (`POST`)                                                                                                                                                  | Update (`PATCH`)                                                                                       |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `/accounts`      | ✓                                                        | `createAccount` (leaders, bd)                                                                                                                                    | `updateAccount` (owner or leader; only leaders reassign)                                               |
| `/contacts`      | ✓                                                        | `createContact`                                                                                                                                                  | `updateContact` (can't move to another account)                                                        |
| `/opportunities` | ✓                                                        | `createOpportunity`                                                                                                                                              | fields → `updateOpportunity`; `stage` (+ `lost_reason` / `no_bid_reason`) → `moveStage` with its gates |
| `/activities`    | ✓                                                        | `logActivity` as the key's user. Types `note`, `email`, `call`, `meeting`, `task`, `file`; related to an account, contact, opportunity or quote the user can see | —                                                                                                      |
| `/tasks`         | ✓ (leaders: all; others: assigned to or created by them) | `createTask`                                                                                                                                                     | `{ "status": "open" \| "done" }` only (`setTaskStatus`)                                                |
| `/quotes`        | ✓ (client-facing)                                        | —                                                                                                                                                                | —                                                                                                      |

Unknown body fields are rejected (`422`), so typos don't silently do nothing.

### Lists, filters and pagination

```
GET /api/v1/opportunities?stage=proposal&owner_id=…&updated_since=2026-10-01T00:00:00Z&limit=50&cursor=…
→ 200 { "data": [ … ], "next_cursor": "WyIyMDI2LTA…" | null }
```

- Rows are ordered oldest first by `(created_at, id)`. Pass `next_cursor` back as `cursor` until it is `null`.
- `limit`: 1–200, default 50.
- `updated_since`: ISO 8601; rows updated at or after that time (for incremental sync).
- `q`: case-insensitive search (accounts: name; contacts: name, email; opportunities: name, solicitation number; …).
- Equality filters per resource: accounts `status, tier, type, owner_id`; contacts `account_id, owner_id`; opportunities
  `account_id, stage, kind, owner_id`; activities `account_id, related_type, related_id, type`; tasks `status,
assignee_id, account_id, priority, related_type, related_id`; quotes `opportunity_id, account_id, status`.
- Unknown query parameters are a `400`, not ignored.

### Errors

Always JSON: `{ "error": { "code": "…", "message": "…", "details": … } }`.

| Status | `code`                             | When                                                                                           |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| 400    | `bad_request`                      | Body isn't JSON, unknown query parameter, bad `limit` or `cursor`                              |
| 401    | `unauthorized`                     | Missing, malformed, unknown, revoked or expired key (`WWW-Authenticate: Bearer`)               |
| 403    | `insufficient_scope` / `forbidden` | Key lacks `write`; or the user's role can't do this (e.g. a delivery lead creating an account) |
| 404    | `not_found`                        | The record doesn't exist **or isn't visible to the key's user** (reads never reveal which)     |
| 405    | `method_not_allowed`               | With an `Allow` header                                                                         |
| 422    | `validation_failed`                | Zod validation (`details` = `[{ path, message }]`), unknown fields, stage gates                |
| 429    | `rate_limited`                     | See below                                                                                      |

### Rate limit

120 requests per minute per key (fixed one-minute windows). Every authenticated response carries
`RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds until the window ends); a `429` adds
`Retry-After`. Limits use the shared `RateLimiter` (`src/lib/rate-limit`): Postgres (`rate_limits` +
`take_rate_limit()`, service role) in Supabase mode, so they hold across server instances; in memory for the demo
backend and tests. Keys whose owner is archived or back to pending access are refused (`401`).

## Outbound webhooks

Admins manage subscriptions on `/developer` (`webhook_subscriptions`, admin-only by RLS). Each subscription has a URL
(`https://`; `http://localhost` allowed for development), a list of events and a signing secret (`whsec_…`) that is shown
once and stored encrypted (`secret_enc`, AES-256-GCM with `APP_ENCRYPTION_KEY`).

| Event                       | Emitted by                                                 | `data`                            |
| --------------------------- | ---------------------------------------------------------- | --------------------------------- |
| `account.created`           | `createAccount`                                            | `{ account }`                     |
| `account.updated`           | `updateAccount` (when something changed)                   | `{ account, changed: [fields] }`  |
| `opportunity.created`       | `createOpportunity`                                        | `{ opportunity }`                 |
| `opportunity.stage_changed` | `moveStage`                                                | `{ opportunity, previous_stage }` |
| `quote.status_changed`      | `submitQuote`, `approveQuote`, `setQuoteStatus`            | `{ quote, previous_status }`      |
| `client_item.decided`       | `onDecided` (client decision from Konnect Hub)             | `{ client_item }`                 |
| `handoff.acknowledged`      | Konnect Hub acknowledged the Won handoff (`applyDelivery`) | `{ handoff, account_id }`         |

Request:

```
POST <url>
Content-Type: application/json
X-Konnector-Signature: t=<unix ms>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
X-Konnector-Webhook-Event: opportunity.stage_changed
X-Konnector-Webhook-Id: <event id, same for every retry>

{ "id": "…", "event": "opportunity.stage_changed", "created_at": "…", "data": { … } }
```

The signature scheme is the one used with Konnect Hub (`src/lib/integration/signing.ts`): verify the HMAC with a
constant-time compare and reject timestamps more than 5 minutes old. Use `X-Konnector-Webhook-Id` to de-duplicate.
"Send test event" posts a sample with `"test": true`.

Delivery and retries (`src/lib/services/webhooks.ts`):

- Every matching active subscription gets a `webhook_deliveries` row, then one attempt (10 s timeout).
- `2xx` → `delivered`. `4xx` other than 408/429 → `failed` immediately. Anything else (5xx, timeout, network) →
  `pending` with `next_attempt_at` = 1, 2, 4, 8, 16 minutes (the outbox's `backoffMs`), `failed` after 6 attempts.
- `POST /api/cron/integrations` (every 5 min, `Bearer $CRON_SECRET`) retries due deliveries; admins can also retry one
  from the deliveries table.
- `emitEvent` never throws: a broken receiver or a database error is logged and recorded, and the business action
  succeeds.
- Payloads are built from explicit field lists (`webhookData` in `webhooks.ts`) and pass through `findForbiddenKeys`
  (`src/lib/integration/contract.ts`); a payload containing a cost-side key is refused.

### Local development

In demo mode `POST /api/dev/webhook-echo` is a receiver that verifies the signature against any subscription pointing at
it and keeps the last 50 bodies (`GET` to list, `DELETE` to clear). Point a subscription at
`http://localhost:3000/api/dev/webhook-echo` and use "Send test event".

## Tests

- `src/lib/__tests__/api.test.ts` — key lifecycle, scopes, `bd` scoping, no cost fields, audit on create, pagination,
  rate limit, error shapes.
- `src/lib/__tests__/webhooks.test.ts` — signatures, backoff and retries, inactive subscriptions, forbidden keys,
  failures never reaching the caller.
- `e2e/developer.spec.ts` — create a key in the UI and call `/api/v1/accounts` with it; create a webhook and send a test
  event to the echo receiver.
- `scripts/rls-test.ts` — RLS and column secrecy for `api_keys`, `webhook_subscriptions`, `webhook_deliveries` (and the
  other PI-2 tables).
