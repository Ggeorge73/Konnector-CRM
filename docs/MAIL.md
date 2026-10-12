# Email & calendar sync (PI-2 Sprint 7)

Each user connects **their own** Google Workspace or Microsoft 365 mailbox at **Email & calendar**
(`/connections`). The CRM then logs email and meetings with known contacts to the timeline, and the
user can send email from a record from their own address (`ComposeEmailButton`).

Code: `src/lib/mail/` (provider clients + mock), `src/lib/services/mail.ts` (sync, send, connect,
disconnect), `src/app/api/oauth/[provider]/{start,callback}`, `src/app/api/cron/mail-sync`,
`src/components/mail/`. Tables: `mail_connections`, `synced_messages` (see `docs/DATABASE.md`).

## Privacy rule

- **Only mail and meetings with a known contact are stored.** A message or event is kept only when
  one of its participants (from/to/cc, organizer/attendees — excluding the mailbox owner) matches a
  `contacts.email` (case-insensitive). Everything else — personal mail, newsletters, internal-only
  meetings — is skipped in memory and never written anywhere.
- **Snippets only.** We store the subject and a short snippet (≤ 500 characters: Gmail `snippet`,
  Graph `bodyPreview`, event description stripped of HTML). Never full bodies or attachments.
  Gmail is read with `format=metadata`; Graph with a `$select` that excludes `body`.
- **Tokens are encrypted at rest** (`APP_ENCRYPTION_KEY`, AES-256-GCM via `src/lib/server/crypto.ts`)
  and never sent to the browser (`publicConnection()` strips them).
- **Own connection only.** Users can only see, sync, use or disconnect their own connection. The
  OAuth callback requires the CRM session and a signed `state` naming the same user.
- **Disconnect** revokes at the provider where possible (Google `oauth2.googleapis.com/revoke`;
  Microsoft has no per-token revoke endpoint), marks the row `revoked` and wipes the tokens. Items
  already on the timeline stay.
- External text can't `@mention` internal users (leading `@` is neutralised in synced snippets).

## Google Workspace (Google Cloud OAuth client)

1. Google Cloud console → APIs & Services → **Enable** _Gmail API_ and _Google Calendar API_.
2. **OAuth consent screen**: User type _Internal_ (Workspace) — no verification needed for internal
   apps. Add scopes below.
3. **Credentials → Create OAuth client ID → Web application**. Authorised redirect URI:
   `https://<APP_URL>/api/oauth/google/callback` (and `http://localhost:3000/api/oauth/google/callback`
   for local dev).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Scopes: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send`,
`https://www.googleapis.com/auth/calendar.readonly`, `openid`, `email`. Requested with
`access_type=offline&prompt=consent` (refresh token) and **PKCE S256**.

## Microsoft 365 (Azure app registration)

1. Entra admin center → App registrations → **New registration**. Supported account types: _this
   organisational directory only_ (set `MICROSOFT_TENANT_ID` to the tenant id) or multi-tenant
   (`common`).
2. Platform **Web**, redirect URI `https://<APP_URL>/api/oauth/microsoft/callback` (plus the
   localhost one for dev).
3. **Certificates & secrets** → new client secret.
4. **API permissions** → Microsoft Graph → _Delegated_: `Mail.Read`, `Mail.Send`, `Calendars.Read`,
   `offline_access`, `openid`, `email`. Grant admin consent for the tenant.
5. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (default `common`).

Graph calls: `GET /me/messages` and `GET /me/events` (with `Prefer: IdType="ImmutableId"`), and
sending via `POST /me/messages` (draft) + `POST /me/messages/{id}/send`. We use draft+send instead of
`POST /me/sendMail` because `sendMail` returns no id; the immutable draft id is the same id the
message has in Sent Items, so the next sync de-duplicates it.

## Environment

| Variable                                          | Notes                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`       | Google OAuth client                                                                                         |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Azure app registration                                                                                      |
| `MICROSOFT_TENANT_ID`                             | Tenant id or `common` (default)                                                                             |
| `MAIL_PROVIDER_MODE`                              | `auto` (default): live when the provider's id+secret are set, else mock on the demo backend; `mock`; `live` |
| `APP_URL`                                         | Base for redirect URIs (falls back to the request origin)                                                   |
| `APP_ENCRYPTION_KEY`                              | Required in production; encrypts tokens and signs OAuth `state`                                             |
| `CRON_SECRET`                                     | Bearer token for `/api/cron/mail-sync`                                                                      |

## Sync

- `POST /api/cron/mail-sync` with `Authorization: Bearer $CRON_SECRET` — schedule **every 15 minutes**.
  Syncs every `active` connection with the system context; activity is attributed to the mailbox owner.
  Users can also press **Sync now**.
- Window: since `last_synced_at` (minus a 5-minute overlap), or **30 days** on the first run. Up to
  **500 items per stream per run**; if the cap is hit, the page token is saved in `sync_cursor` and the
  next run continues from there.
- Idempotent: `synced_messages` is unique per `(connection_id, provider_message_id)`.
- Each stored item creates a timeline activity (`email` or `meeting`) on the matched contact with the
  contact's `account_id`, so it shows on the contact and the account.
- Access tokens are refreshed 2 minutes before expiry (re-encrypted). On any provider error the
  connection goes to `error` with `last_error`, and the owner gets a notification linking to
  `/connections` ("needs to be reconnected" for 400/401).

## Demo / tests

With the demo backend and no client ids, both providers use the **mock** (`src/lib/mail/mock.ts`): the
"OAuth" redirect goes straight back to the callback, and the mailbox contains mail from Denise Walker /
Robert Nguyen (GTA) and Angela Price (DOR), a meeting with Jasmine Carter (City of Atlanta), plus
personal mail and an internal stand-up that must **not** sync. Sent messages are recorded in memory.

- Unit: `src/lib/__tests__/mail.test.ts` (request building + mapping from recorded fixtures in
  `src/lib/__tests__/fixtures/mail/`, privacy filter, idempotency, encryption, permissions, disconnect).
- E2E: `e2e/mail.spec.ts`. Dev harness for the compose dialog: `/_kit/compose?contact=<id>` (demo only).
