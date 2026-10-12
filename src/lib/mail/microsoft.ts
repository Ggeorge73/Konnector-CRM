import {
  expiresAt,
  idTokenClaims,
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

/** Microsoft Graph v1.0 over fetch. https://learn.microsoft.com/graph/api/resources/message */
export const MICROSOFT_SCOPES = ["Mail.Read", "Mail.Send", "Calendars.Read", "offline_access", "openid", "email"] as const;

export const GRAPH = "https://graph.microsoft.com/v1.0";
const PAGE_SIZE = 50;
/** Immutable ids survive a move to Sent Items, so a sent message syncs back under the same id (idempotent). */
const PREFER_IMMUTABLE = { Prefer: 'IdType="ImmutableId"' };

// ---------- recorded REST shapes (subset) ----------

export interface MsTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

interface Recipient {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessage {
  id: string;
  subject?: string | null;
  bodyPreview?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  from?: Recipient | null;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
}

export interface GraphEvent {
  id: string;
  subject?: string | null;
  bodyPreview?: string;
  isCancelled?: boolean;
  start?: { dateTime: string; timeZone: string };
  organizer?: Recipient;
  attendees?: Array<Recipient & { type?: string }>;
}

export interface GraphCollection<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

// ---------- pure mappers (unit-tested against fixtures) ----------

const addr = (r: Recipient | null | undefined) => r?.emailAddress?.address?.toLowerCase() ?? null;
const addrs = (rs: Recipient[] | undefined) => [...new Set((rs ?? []).map(addr).filter((x): x is string => !!x))];

/** Graph returns event times as a naive dateTime in `timeZone` (UTC unless a Prefer header asks otherwise). */
function graphTime(t: { dateTime: string; timeZone: string } | undefined): string {
  if (!t) return new Date(0).toISOString();
  const hasOffset = /([zZ]|[+-]\d\d:?\d\d)$/.test(t.dateTime);
  return new Date(hasOffset || t.timeZone !== "UTC" ? t.dateTime : `${t.dateTime}Z`).toISOString();
}

export function mapGraphMessage(m: GraphMessage): ProviderMessage {
  return {
    id: m.id,
    subject: m.subject?.trim() || "(no subject)",
    from: addr(m.from),
    to: addrs(m.toRecipients),
    cc: addrs(m.ccRecipients),
    occurredAt: new Date(m.receivedDateTime ?? m.sentDateTime ?? 0).toISOString(),
    snippet: snippet(m.bodyPreview),
  };
}

export function mapGraphEvent(e: GraphEvent): ProviderEvent {
  return {
    id: e.id,
    subject: e.subject?.trim() || "(untitled meeting)",
    organizer: addr(e.organizer),
    attendees: addrs(e.attendees),
    startsAt: graphTime(e.start),
    snippet: snippet(e.bodyPreview),
    cancelled: !!e.isCancelled,
  };
}

/** Follow-up pages come back as absolute nextLinks; only ever follow ones on Graph itself. */
function pageUrl(first: string, cursor: string | null | undefined): string {
  if (!cursor) return first;
  if (!cursor.startsWith(`${GRAPH}/`)) throw new Error("Refusing to follow a non-Graph nextLink");
  return cursor;
}

export function graphMessagesUrl(args: ListArgs): string {
  const q = new URLSearchParams({
    $filter: `receivedDateTime ge ${new Date(args.since).toISOString()}`,
    $orderby: "receivedDateTime desc",
    $top: String(PAGE_SIZE),
    $select: "id,subject,bodyPreview,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients",
  });
  return pageUrl(`${GRAPH}/me/messages?${q}`, args.cursor);
}

export function graphEventsUrl(args: ListArgs): string {
  const q = new URLSearchParams({
    $filter: `lastModifiedDateTime ge ${new Date(args.since).toISOString()}`,
    $top: String(PAGE_SIZE),
    $select: "id,subject,bodyPreview,isCancelled,start,organizer,attendees",
  });
  return pageUrl(`${GRAPH}/me/events?${q}`, args.cursor);
}

/** Graph message resource for a draft. In-Reply-To can't be set as a custom header on Graph; replies keep the subject. */
export function graphDraft(args: SendArgs) {
  const rcpt = (a: string) => ({ emailAddress: { address: a } });
  return {
    subject: args.subject,
    body: { contentType: "HTML", content: args.html },
    toRecipients: args.to.map(rcpt),
    ccRecipients: (args.cc ?? []).map(rcpt),
  };
}

export function createMicrosoftClient(cfg: ProviderConfig & { tenantId?: string }): MailProviderClient {
  const f = cfg.fetch ?? fetch;
  const tenant = encodeURIComponent(cfg.tenantId || "common");
  const login = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  const scope = MICROSOFT_SCOPES.join(" ");
  const auth = (token: string) => ({ Authorization: `Bearer ${token}`, ...PREFER_IMMUTABLE });
  const tokenCall = async (body: Record<string, string>) =>
    readJson<MsTokenResponse>(
      "microsoft",
      await f(`${login}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      }),
    );
  const toTokens = (t: MsTokenResponse): ProviderTokens => ({
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: expiresAt(t.expires_in),
    scopes: t.scope ? t.scope.split(" ") : [...MICROSOFT_SCOPES],
  });

  return {
    provider: "microsoft",
    mode: "live",
    scopes: MICROSOFT_SCOPES,
    authUrl(state: string, opts: AuthUrlOptions) {
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        response_type: "code",
        redirect_uri: cfg.redirectUri,
        response_mode: "query",
        scope,
        state,
        code_challenge: opts.codeChallenge,
        code_challenge_method: "S256",
      });
      if (opts.loginHint) q.set("login_hint", opts.loginHint);
      return `${login}/authorize?${q}`;
    },
    async exchangeCode(code, codeVerifier): Promise<ExchangeResult> {
      const t = await tokenCall({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope,
        code,
        redirect_uri: cfg.redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      });
      const claims = idTokenClaims(t.id_token);
      const email = String(claims.email ?? claims.preferred_username ?? "").toLowerCase();
      if (!email) throw new Error("Microsoft did not return an email address for this account.");
      return { ...toTokens(t), email };
    },
    async refresh(refreshToken) {
      return toTokens(
        await tokenCall({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          scope,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      );
    },
    async revoke() {
      // The Microsoft identity platform has no per-token revoke endpoint; tokens are wiped locally and expire.
      return false;
    },
    async listMessages(accessToken, args): Promise<Page<ProviderMessage>> {
      const r = await readJson<GraphCollection<GraphMessage>>("microsoft", await f(graphMessagesUrl(args), { headers: auth(accessToken) }));
      return { items: r.value.map(mapGraphMessage), nextCursor: r["@odata.nextLink"] ?? null };
    },
    async listEvents(accessToken, args): Promise<Page<ProviderEvent>> {
      const r = await readJson<GraphCollection<GraphEvent>>("microsoft", await f(graphEventsUrl(args), { headers: auth(accessToken) }));
      return { items: r.value.map(mapGraphEvent), nextCursor: r["@odata.nextLink"] ?? null };
    },
    async sendMessage(accessToken, args) {
      // Draft + send (rather than /me/sendMail, which returns 202 with no id) so we get a stable immutable id
      // and the copy that lands in Sent Items de-duplicates on the next sync.
      const draft = await readJson<GraphMessage>(
        "microsoft",
        await f(`${GRAPH}/me/messages`, {
          method: "POST",
          headers: { ...auth(accessToken), "Content-Type": "application/json" },
          body: JSON.stringify(graphDraft(args)),
        }),
      );
      await readJson(
        "microsoft",
        await f(`${GRAPH}/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST", headers: auth(accessToken) }),
      );
      return draft.id;
    },
  };
}
