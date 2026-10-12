import {
  expiresAt,
  idTokenClaims,
  parseAddresses,
  readJson,
  snippet,
  type AuthUrlOptions,
  type ExchangeResult,
  type ListArgs,
  type MailProviderClient,
  type Page,
  type ProviderConfig,
  type ProviderEvent,
  type ProviderMessage,
  type ProviderTokens,
  type SendArgs,
} from "./types";

/** Gmail API + Google Calendar API over fetch. https://developers.google.com/gmail/api/reference/rest */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
] as const;

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary";
const PAGE_SIZE = 50;

// ---------- recorded REST shapes (subset) ----------

export interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

export interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

export interface GoogleEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  organizer?: { email?: string };
  attendees?: Array<{ email?: string; self?: boolean }>;
}

export interface GoogleEventsResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

// ---------- pure mappers (unit-tested against fixtures) ----------

export function mapGmailMessage(m: GmailMessage): ProviderMessage {
  const h = (name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? null;
  const dateHeader = h("Date");
  const occurredAt = m.internalDate
    ? new Date(Number(m.internalDate)).toISOString()
    : dateHeader
      ? new Date(dateHeader).toISOString()
      : new Date(0).toISOString();
  return {
    id: m.id,
    subject: h("Subject")?.trim() || "(no subject)",
    from: parseAddresses(h("From"))[0] ?? null,
    to: parseAddresses(h("To")),
    cc: parseAddresses(h("Cc")),
    occurredAt,
    snippet: snippet(m.snippet),
  };
}

export function mapGoogleEvent(e: GoogleEvent): ProviderEvent {
  const start = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
  return {
    id: e.id,
    subject: e.summary?.trim() || "(untitled meeting)",
    organizer: e.organizer?.email?.toLowerCase() ?? null,
    attendees: [...new Set((e.attendees ?? []).map((a) => a.email?.toLowerCase()).filter((x): x is string => !!x))],
    startsAt: start ? new Date(start).toISOString() : new Date(0).toISOString(),
    snippet: snippet(e.description),
    cancelled: e.status === "cancelled",
  };
}

const header = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
/** RFC 2047 encoded-word so non-ASCII subjects survive. */
const encodeWord = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);
const b64Lines = (s: string) =>
  (
    Buffer.from(s, "utf8")
      .toString("base64")
      .match(/.{1,76}/g) ?? [""]
  ).join("\r\n");

/** RFC 5322 multipart/alternative message for users.messages.send (`raw`, base64url). */
export function buildMime(args: SendArgs, boundary = "kcrm-boundary-7d1f"): string {
  const lines = [
    ...(args.from ? [`From: ${header(args.from)}`] : []),
    `To: ${args.to.map(header).join(", ")}`,
    ...(args.cc?.length ? [`Cc: ${args.cc.map(header).join(", ")}`] : []),
    `Subject: ${encodeWord(header(args.subject))}`,
    ...(args.inReplyTo ? [`In-Reply-To: ${header(args.inReplyTo)}`, `References: ${header(args.inReplyTo)}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(args.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(args.html),
    `--${boundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

export function gmailListUrl(args: ListArgs): string {
  const q = new URLSearchParams({
    q: `after:${Math.floor(new Date(args.since).getTime() / 1000)} -in:chats`,
    maxResults: String(PAGE_SIZE),
  });
  if (args.cursor) q.set("pageToken", args.cursor);
  return `${GMAIL}/messages?${q}`;
}

export function gmailGetUrl(id: string): string {
  const q = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "To", "Cc", "Subject", "Date", "Message-ID"]) q.append("metadataHeaders", h);
  return `${GMAIL}/messages/${encodeURIComponent(id)}?${q}`;
}

export function googleEventsUrl(args: ListArgs): string {
  const q = new URLSearchParams({ updatedMin: new Date(args.since).toISOString(), singleEvents: "true", maxResults: String(PAGE_SIZE) });
  if (args.cursor) q.set("pageToken", args.cursor);
  return `${CAL}/events?${q}`;
}

export function createGoogleClient(cfg: ProviderConfig): MailProviderClient {
  const f = cfg.fetch ?? fetch;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const tokenCall = async (body: Record<string, string>) =>
    readJson<GoogleTokenResponse>(
      "google",
      await f(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }),
    );
  const toTokens = (t: GoogleTokenResponse): ProviderTokens => ({
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: expiresAt(t.expires_in),
    scopes: t.scope ? t.scope.split(" ") : [...GOOGLE_SCOPES],
  });

  return {
    provider: "google",
    mode: "live",
    scopes: GOOGLE_SCOPES,
    authUrl(state: string, opts: AuthUrlOptions) {
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
        code_challenge: opts.codeChallenge,
        code_challenge_method: "S256",
      });
      if (opts.loginHint) q.set("login_hint", opts.loginHint);
      return `${AUTH}?${q}`;
    },
    async exchangeCode(code, codeVerifier): Promise<ExchangeResult> {
      const t = await tokenCall({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      });
      const email = String(idTokenClaims(t.id_token).email ?? "").toLowerCase();
      if (!email) throw new Error("Google did not return an email address for this account.");
      return { ...toTokens(t), email };
    },
    async refresh(refreshToken) {
      const t = await tokenCall({
        refresh_token: refreshToken,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: "refresh_token",
      });
      return toTokens(t);
    },
    async revoke(token) {
      const res = await f(`${REVOKE}?${new URLSearchParams({ token })}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      return res.ok;
    },
    async listMessages(accessToken, args): Promise<Page<ProviderMessage>> {
      const list = await readJson<GmailListResponse>("google", await f(gmailListUrl(args), { headers: auth(accessToken) }));
      const items: ProviderMessage[] = [];
      for (const ref of list.messages ?? []) {
        const m = await readJson<GmailMessage>("google", await f(gmailGetUrl(ref.id), { headers: auth(accessToken) }));
        items.push(mapGmailMessage(m));
      }
      return { items, nextCursor: list.nextPageToken ?? null };
    },
    async listEvents(accessToken, args): Promise<Page<ProviderEvent>> {
      const r = await readJson<GoogleEventsResponse>("google", await f(googleEventsUrl(args), { headers: auth(accessToken) }));
      return { items: (r.items ?? []).map(mapGoogleEvent), nextCursor: r.nextPageToken ?? null };
    },
    async sendMessage(accessToken, args) {
      const raw = Buffer.from(buildMime(args), "utf8").toString("base64url");
      const r = await readJson<{ id: string }>(
        "google",
        await f(`${GMAIL}/messages/send`, {
          method: "POST",
          headers: { ...auth(accessToken), "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        }),
      );
      return r.id;
    },
  };
}
