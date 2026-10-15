# Operations runbook

How we know Konnector CRM is healthy in production, and what to do when it isn't. Hosting is Vercel
(KCRM-67); everything here also works on any Node host with a log drain and a scheduler.

Related: `docs/SECURITY.md` (headers, audit, secret rotation), `docs/INTEGRATION.md` (Konnect Hub contract),
`docs/API.md` (REST API and webhooks), `docs/MAIL.md` (mailbox sync), `docs/DATABASE.md`.

## 1. Health check and uptime monitoring

`GET /api/health` is public (no session, no API key) and never cached.

```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "ok", "latencyMs": 12 },
    "konnectHub": { "status": "ok", "latencyMs": 85 },
    "version": { "status": "ok", "version": "0.1.0", "commit": "57073eb" }
  }
}
```

| Overall    | HTTP | Meaning                                                                                         |
| ---------- | ---- | ----------------------------------------------------------------------------------------------- |
| `ok`       | 200  | Database answers; Konnect Hub reachable (or `mock`).                                            |
| `degraded` | 200  | Database fine, Konnect Hub unreachable. Users can work; handoffs queue in the outbox and retry. |
| `down`     | 503  | The database did not answer within 2 s. The app is unusable.                                    |

Each check has a ~2 s timeout and runs in parallel, so the endpoint answers within ~2 s even when a
dependency hangs. Failures carry only a coarse `reason` (`timeout`, `error`, `http_5xx`, `not_configured`):
no error text, hostnames or env values.

- **database**: one `select … limit 1` on `organizations` with the service role (the demo store in demo mode).
- **konnectHub**: `mock` when `MOCK_KONNECT_HUB=true` (or the flag is left on with no `KONNECT_HUB_BASE_URL`);
  otherwise a `GET` of `KONNECT_HUB_BASE_URL`. Any answer below 500 counts as reachable.
  `not_configured` means neither a URL nor the mock is set: fix the env.
- **version**: `package.json` version plus the short commit (`VERCEL_GIT_COMMIT_SHA`, or `APP_COMMIT_SHA` elsewhere).
  Use it to confirm which build is live after a deploy.

### Pointing an uptime monitor at it

Any HTTP monitor works (Better Stack, UptimeRobot, Checkly, Pingdom, Vercel's own checks):

1. URL: `https://<crm host>/api/health`, method `GET`, interval 1 min, timeout 10 s, from 2+ regions.
2. Alert when the status code is not 2xx (that is, 503 = **down**) for 2 consecutive checks. Page the on-call.
3. Optional second assertion, lower urgency: response body contains `"status":"ok"`. A failure here with HTTP
   200 means **degraded** (Konnect Hub). Notify the integration owner in Slack rather than paging.
4. Don't add auth headers: the endpoint is public by design and exposes nothing sensitive.

After every production deploy, open `/api/health` and check `version.commit` matches the deploy.

## 2. Logs and error reporting

There is no third-party error SDK (choosing a vendor is a PO decision). Instead, `src/lib/server/observability.ts`:

- writes **one JSON line per event** to stdout/stderr, which Vercel's log view and any log drain pick up;
- `reportError(err, { source, route, userId })` writes an `"event":"error"` line and, when **`ERROR_WEBHOOK_URL`**
  is set, POSTs the same JSON there (fire-and-forget, 3 s timeout). Point it at a Slack/Teams incoming webhook
  relay, an alerting tool, or a vendor's HTTP intake if one is chosen later.

Error lines carry only `ts, level, event, source, route, userId, name, message, stack`. Emails, bearer tokens,
API keys, JWTs, connection strings and sensitive query parameters are scrubbed from the message and stack.
Request bodies, headers and record content are never logged.

Wired into: server actions (`run()`, source `action`), REST API v1 (`api.v1`), cron routes (`cron.<job>`),
Konnect Hub deliveries (`integration.konnect_hub`), webhooks (`webhooks.*`), OAuth callback (`oauth.callback`),
and everything else Next.js catches via `src/instrumentation.ts` → `onRequestError` (`next.render`, `next.route`,
`next.action`, `next.middleware`).

### Reading the logs

- **Vercel dashboard** → project → **Logs**. Filter by text, e.g. `"event":"error"`, `cron.daily`, `delivery_failed`.
- **CLI**: `vercel logs <deployment-url>`; pipe through `jq` for structure:
  `vercel logs <url> --json | jq -r '.message' | grep '^{' | jq 'select(.level != "info")'`.
- **Log drain** (recommended for retention beyond Vercel's window): Project settings → Log Drains → add your
  destination; every line is already JSON so no parsing rules are needed.

| Event                         | Level | What it means                                                              |
| ----------------------------- | ----- | -------------------------------------------------------------------------- |
| `error` (any `source`)        | error | An unhandled failure. `source` + `route` say where; `userId` says who.     |
| `cron.<job>.completed`        | info  | A job ran; counts and `durationMs`. Missing lines = the scheduler stopped. |
| `cron.<job>.unauthorized`     | warn  | A call without the right `CRON_SECRET` (rotation mismatch or a probe).     |
| `konnect_hub.delivery_failed` | warn  | One failed attempt; `final: true` means it gave up (also an error line).   |
| `webhook.delivery_failed`     | warn  | A customer webhook attempt failed; `final: true` = no more retries.        |
| `health.unhealthy`            | warn  | `/api/health` returned degraded/down, with the failing check's reason.     |

## 3. Scheduled jobs

All jobs require `Authorization: Bearer $CRON_SECRET` and accept **GET** (Vercel Cron) or **POST**. Without the
secret they return 401. Each run logs `cron.<job>.completed`; a thrown error returns 500 and logs an error line.

| Job                      | Schedule                             | Does                                                                                   |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `/api/cron/integrations` | every 5 min (daily on Vercel Hobby)  | Retries due Konnect Hub events, syncs handoff status, retries due outbound webhooks.   |
| `/api/cron/mail-sync`    | every 15 min (daily on Vercel Hobby) | Pulls new mail and meetings for every active mailbox connection.                       |
| `/api/cron/daily`        | daily                                | Client-item expiry and nudges, registration/vetting reminders, email digests (Resend). |

Run any job by hand:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<crm host>/api/cron/integrations
```

### When a job fails

**All jobs return 401** → `CRON_SECRET` in the scheduler and in the app env differ (usually after a rotation).
Fix the env (see `docs/SECURITY.md`), redeploy, run the job by hand.

**No `cron.<job>.completed` lines** → the scheduler isn't calling. Vercel: Project → Settings → Cron Jobs, check
the job is enabled and look at its recent invocations. Run it by hand meanwhile.

**`/api/cron/integrations` returns 500** → check the error line's message. If `/api/health` says the database is
down, fix that first; the job is safe to re-run (retries are idempotent on `idempotency_key`).
Delayed retries only mean events reach Konnect Hub later; nothing is lost.

**`/api/cron/mail-sync`** → `failed > 0` in the completed line means some connections failed (usually expired or
revoked consent). Those users see "Reconnect" on `/connections`; nothing to do centrally unless every connection
fails, which points at the OAuth client secret (see `docs/SECURITY.md`) or the provider's status page.
Missing a run only delays sync; the next run catches up.

**`/api/cron/daily` returns 500** → the steps run in order (expiry → compliance reminders → digests). Expiry,
nudges and reminders dedupe per day, so they are safe to re-run. Digests are **not** deduped: if the 500 came after
`digestsSent` would have been logged (i.e. the digest step itself failed part-way), re-running may email some
people twice. Fix the cause and re-run the same day; accept a duplicate digest over a missed expiry.
If `digestsSent` is 0 while `digestsBuilt` > 0, `RESEND_API_KEY` is missing.

## 4. Re-running failed deliveries

### Konnect Hub (outbound `integration_events`)

Failed attempts back off 1, 2, 4, 8, 16 minutes; after 6 attempts, or on a 4xx contract error (not 408/429),
the event is marked `failed` and an error line is logged with source `integration.konnect_hub`.

1. Check Konnect Hub is reachable: `/api/health` → `konnectHub.status`.
2. For a contract error (4xx), read `last_error` on `/integrations` (admin), fix the cause (often a signing-secret
   mismatch after a rotation, see `docs/SECURITY.md`), then deploy.
3. Retry: **one event**: `/integrations` → **Retry** on the row (admins, executives and delivery leads), or **Retry** on the opportunity's
   handoff panel. **Everything pending, now**: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<crm host>/api/cron/integrations?force=1"`.
   `failed` events aren't picked up by the cron; use the Retry button. Re-sends are idempotent on
   `idempotency_key`, so the Hub never gets a duplicate project.

### Outbound webhooks (`webhook_deliveries`)

Same backoff and limits. Failures log `webhook.delivery_failed` (ids and status code only).

1. `/developer` → Webhooks → the subscription's delivery log shows status, HTTP code and last error.
2. If the receiver was down, use **Retry** on each failed delivery (admin), or force the pending ones with
   `?force=1` on the integrations job as above.
3. If every delivery to one URL fails with 401/403, the receiver probably has an old signing secret. Secrets
   can't be edited: create a new subscription for the same URL and events (its secret is shown once), give the
   secret to the receiver's owner, then delete the old subscription.

## 5. Key rotation

See `docs/SECURITY.md` → "Secret rotation runbook" for `CRON_SECRET`, `KONNECTOR_INTEGRATION_SECRET`,
`APP_ENCRYPTION_KEY` (with re-encryption of OAuth tokens and webhook secrets), `ANTHROPIC_API_KEY`, OAuth client
secrets and `SUPABASE_SERVICE_ROLE_KEY`. After any rotation: redeploy, check `/api/health`, run the integrations
job by hand, and watch the logs for 401s or `error` lines for 15 minutes.

## 6. Bootstrap a new environment (first admin)

A new staging or production database has no organization and no users. New sign-ins land in
**pending access** until an admin assigns a role, so the first admin needs a one-time bootstrap. Use that
environment's session-pooler connection string, and run the steps from a trusted machine. Never run them from CI logs.

1. After migrations, before anyone signs in, create the organization:
   `DATABASE_URL=… pnpm db:bootstrap`
2. Sign in once with your `konnectorllc.com` Google account. You will see the pending-access screen.
3. Promote yourself:
   `DATABASE_URL=… pnpm db:bootstrap --admin you@konnectorllc.com`
   The script refuses if an admin already exists, and both steps are audited.
4. Reload the app. From now on, assign roles in **Settings → Team**.

## 7. Incident checklist

1. `/api/health`: which check fails, and since when (uptime monitor history)?
2. Logs: filter `"level":"error"` around the start time; group by `source`.
3. Recent deploy? Compare `version.commit`; roll back in Vercel (Deployments → Promote previous) if it matches.
4. Database down → Supabase dashboard (status, connection limits, paused project). Konnect Hub down → tell the
   Hub team; the CRM queues and retries on its own.
5. Afterwards: re-run failed deliveries (section 4) and any missed jobs (section 3).
