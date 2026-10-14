# Security: headers, dependency audit and secret rotation

Related: `docs/OPERATIONS.md` (health, logs, jobs), `docs/DATABASE.md` (RLS), `docs/API.md` (API keys, webhooks).

## 1. Security headers

Static headers are set for every path in `next.config.ts`; the Content-Security-Policy needs a fresh nonce per
request, so `src/middleware.ts` builds it. Both come from `src/lib/security/headers.ts`, and are asserted by
`src/lib/__tests__/security-headers.test.ts` and `e2e/platform.spec.ts`.

| Header                      | Value                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Content-Security-Policy`   | see below                                                                                                                                              |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`, production builds only (`NODE_ENV=production`)                                                                  |
| `X-Frame-Options`           | `DENY` (plus CSP `frame-ancestors 'none'`)                                                                                                             |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                              |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                                      |
| `Permissions-Policy`        | accelerometer, autoplay, camera, display-capture, geolocation, gyroscope, magnetometer, microphone, midi, payment, usb, browsing-topics all `()` (off) |

`X-Powered-By` is turned off. HSTS has no `preload`: joining the preload list is hard to undo and is a domain-wide
decision for the PO. Add it once every `konnectorllc.com` subdomain is HTTPS-only.

### Content-Security-Policy

Production (one line in the response; `<nonce>` changes on every request):

```
default-src 'self';
script-src 'self' 'nonce-<nonce>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data: blob:;
connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co;
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
frame-src 'none';
manifest-src 'self'
```

Why each source is allowed:

- **`script-src` nonce + `'strict-dynamic'`**: middleware generates a 128-bit nonce and passes the CSP on the
  request; Next.js 15 reads it and stamps the nonce on its framework, RSC payload and chunk-loader scripts. Chunks
  loaded by those scripts are trusted through `'strict-dynamic'`. No `'unsafe-inline'` or `'unsafe-eval'` for
  scripts in production. `'self'` is only a fallback for pre-CSP3 browsers. `next dev` adds `'unsafe-eval'`
  (React dev tooling and Fast Refresh). Nonces force dynamic rendering, which costs nothing here: the root layout
  already reads cookies, so every page is dynamic.
- **`style-src 'unsafe-inline'`**: MUI/emotion insert `<style>` tags at runtime and React server-renders `style=""`
  attributes. A style nonce would make browsers ignore `'unsafe-inline'` and block those attributes, so styles
  stay `'unsafe-inline'`. Inline styles can't run script; the residual risk is CSS-based data exfiltration, limited
  by `connect-src`/`img-src` being same-origin.
- **`font-src 'self'`**: Plus Jakarta Sans and JetBrains Mono come from `next/font/google`, which downloads them at
  build time and serves them from `/_next/static/media`. The browser never calls Google Fonts.
- **`img-src data: blob:`**: data URIs used by MUI/CSS and blob URLs for file previews and canvas textures. There
  are no remote images (avatars are initials).
- **`connect-src` Supabase**: built from `NEXT_PUBLIC_SUPABASE_URL` (both `https://` for Auth and `wss://` for
  Realtime). Omitted on the demo backend. Copilot, mail providers and Resend are called server-side only.
  Host-agnostic: no Vercel-specific sources (if Vercel Analytics is ever added, it needs its own host in `connect-src`).
- **`worker-src blob:`**: headroom for three.js/react-globe.gl helpers that spin workers from blob URLs. WebGL itself
  needs no CSP source; the globe has no remote textures (the world map is bundled from `world-atlas`).
- **`form-action 'self'`**: the demo sign-in form posts to `/auth/demo`. Google/Microsoft OAuth start with
  navigations, not form posts, so they aren't affected.
- **`frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`**: nothing is embedded and
  the CRM must never be framed (clickjacking).

`upgrade-insecure-requests` is deliberately not set: HSTS already forces HTTPS in production, and the directive
would break the http://localhost production build used by the e2e suite.

**Verification**: the Playwright fixture fails any test whose page logs a console error, and CSP violations are
console errors, so the full e2e suite (every page) is the CSP regression check.

## 2. Dependency audit

Run `pnpm audit --prod` before each release (and in the S12 security review).

**14 Oct 2026, KCRM-74**:

| Finding                                                                                                              | Path                    | Action                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| postcss ≤8.5.22: 2 high (sourceMappingURL file read / path traversal), 2 moderate (XSS in stringify, incomplete fix) | `next > postcss@8.4.31` | **Fixed**: `pnpm.overrides` pins `next>postcss` to `8.5.29` (same major API; already in the lockfile via Vite). Next 15.5.28 still pins 8.4.31. |

Result after the fix: `pnpm audit --prod` → **No known vulnerabilities found**. No production waivers.

Remove the override once a Next.js release depends on postcss ≥ 8.5.23 (check with `pnpm why postcss`).

### Waivers

| Package (path)                                                                                    | Severity | Scope    | Reason                                                                                                                                                   | Review by           |
| ------------------------------------------------------------------------------------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| braces ≤3.0.3 (`eslint-config-next > @next/eslint-plugin-next > fast-glob > micromatch > braces`) | high     | dev only | Stack-exhaustion DoS on deeply nested glob patterns. Only ESLint runs it, on our own repo's globs; not shipped to production. No patched version exists. | S12 security review |

## 3. Secret rotation runbook

General rules: generate secrets with `openssl rand -hex 32` (or `-base64 32` where noted); change them in
**Vercel → Project → Settings → Environment Variables** (Production, and Preview if it uses the same backend);
**redeploy** (env changes apply only to new deployments); then check `/api/health`, run
`/api/cron/integrations` by hand and watch the logs for 401s or `"event":"error"` lines for 15 minutes.
Rotate immediately if a secret may have leaked; otherwise yearly. Record each rotation (date, who, why) in the
audit channel.

### CRON_SECRET

Used only between the scheduler and `/api/cron/*`. On Vercel, Vercel Cron reads `CRON_SECRET` from the project env,
so one change covers both sides.

1. Generate a new value; set `CRON_SECRET` in Vercel; redeploy.
2. Run each job by hand with the new value (`docs/OPERATIONS.md` §3) and expect 200; the old value must get 401.
3. If a job ran between steps, it got 401 and logged `cron.<job>.unauthorized`; just re-run it.

### KONNECTOR_INTEGRATION_SECRET

Shared HMAC secret with Konnect Hub, used in both directions (`X-Konnector-Signature`) and for signed document
links sent to the Hub. Only one secret is accepted at a time, so coordinate a short window with the Hub team.

1. Agree a time with the Hub team; generate one new value and share it via the password manager (never chat/email).
2. Set it in the CRM env and the Hub's env as close together as possible; redeploy both.
3. During the gap, outbound events get 401 from the Hub, which the outbox treats as a contract error and marks
   `failed`; inbound Hub webhooks get 401 here and the Hub retries them.
4. Afterwards: `/integrations` → **Retry** each event that failed in the window (`docs/OPERATIONS.md` §4); ask the
   Hub team to confirm their inbound retries succeeded. Signed document links issued before the switch stop working
   (they are short-lived); re-send the handoff if the Hub reports a broken link.

Follow-up (not built): accept a `KONNECTOR_INTEGRATION_SECRET_PREVIOUS` on inbound verification for zero-downtime
rotation.

### APP_ENCRYPTION_KEY

AES-256-GCM key (32 bytes, **base64**: `openssl rand -base64 32`) for secrets at rest: mailbox OAuth tokens
(`mail_connections.access_token_enc`, `refresh_token_enc`) and webhook signing secrets
(`webhook_subscriptions.secret_enc`). Changing the env var alone would make every stored value unreadable, so the
values are re-encrypted first with `scripts/rotate-encryption-key.ts`.

1. Generate the new key. Keep the old one at hand (from Vercel env).
2. Pause the jobs that read these columns: disable the `mail-sync` and `integrations` crons in Vercel (or accept a
   few failed attempts, which retry).
3. Dry run against production (direct connection string from Supabase → Settings → Database):

   ```bash
   OLD_APP_ENCRYPTION_KEY=<old> NEW_APP_ENCRYPTION_KEY=<new> DATABASE_URL=<prod url> pnpm keys:rotate-encryption
   ```

   It decrypts every value with the old key and rolls back. Any failure means the old key is wrong; stop.

4. Apply: same command with `--apply`. It runs in one transaction (all or nothing) and skips values already on the
   new key, so it's safe to re-run.
5. Immediately set `APP_ENCRYPTION_KEY=<new>` in Vercel and redeploy. Between steps 4 and 5 the running app can't
   decrypt (mail sync and webhook deliveries fail and retry), so keep the gap short.
6. Re-enable the crons, run `/api/cron/mail-sync` and `/api/cron/integrations` by hand, and send a test event from
   `/developer` to one webhook subscription. Then delete the old key from wherever it was kept.

If a token can't be recovered (old key lost), users reconnect on `/connections` and admins recreate webhook
subscriptions (new secrets go to the receivers).

### ANTHROPIC_API_KEY

Server-side only (Copilot). Without it Copilot falls back to demo mode, so there's no hard outage.

1. Anthropic Console → API keys → create a new key for the production workspace.
2. Set `ANTHROPIC_API_KEY` in Vercel; redeploy; run one Copilot prompt.
3. Revoke the old key in the Console; check the Console's usage page shows traffic only on the new key.

### OAuth client secrets

**Mailbox sync** (`GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`). Both providers allow two secrets at once,
so there's no downtime and users don't need to reconnect (refresh tokens stay valid when the client secret changes).

1. Google Cloud Console → APIs & Services → Credentials → the web client → **Add secret**. Microsoft Entra → App
   registrations → the app → Certificates & secrets → **New client secret** (note its expiry; set a reminder).
2. Set the new value in Vercel; redeploy; run `/api/cron/mail-sync` by hand and check `failed: 0`.
3. Disable/delete the old secret in the provider console.

**Sign-in** (Google OAuth for Supabase Auth): the client secret lives in Supabase → Authentication → Providers →
Google, not in our env. Add a new secret in Google Cloud, paste it into Supabase, test a sign-in, then delete the
old one.

### SUPABASE_SERVICE_ROLE_KEY

Bypasses RLS (used only by cron jobs, inbound webhooks, the API store and `/api/health`). Treat a leak as a
priority-one incident.

1. Supabase → Project Settings → API. With the new API keys, create a new **secret** key, set it as
   `SUPABASE_SERVICE_ROLE_KEY` in Vercel, redeploy, check `/api/health` (`database: ok`) and run a cron job, then
   delete the old secret key. With legacy JWT keys, rotating means **rolling the JWT secret**, which also invalidates
   the anon key and signs every user out: update both `SUPABASE_SERVICE_ROLE_KEY` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel and redeploy straight away (a rebuild is needed for the public key).
2. Review Supabase logs for use of the old key before the rotation if a leak is suspected.

### Others

`RESEND_API_KEY` (digest email): create a new key in Resend, set it, redeploy, revoke the old one. A missing key
only stops digest sending. `ERROR_WEBHOOK_URL`: if the URL embeds a token, replace it at the receiver and in Vercel.
