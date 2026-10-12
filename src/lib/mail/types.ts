import type { MailProvider } from "@/lib/domain/types";

/** Tokens returned by an OAuth code exchange or refresh. Plaintext only in memory — store via encrypt(). */
export interface ProviderTokens {
  accessToken: string;
  /** Not always returned on refresh (Google keeps the original). */
  refreshToken: string | null;
  /** ISO timestamp. */
  expiresAt: string | null;
  scopes: string[];
}

export interface ExchangeResult extends ProviderTokens {
  /** The mailbox address that was connected (from the OpenID id_token). */
  email: string;
}

/** A provider message, mapped to only what the CRM may keep: headers + a short snippet. Never a full body. */
export interface ProviderMessage {
  id: string;
  subject: string;
  from: string | null;
  to: string[];
  cc: string[];
  occurredAt: string;
  snippet: string;
}

export interface ProviderEvent {
  id: string;
  subject: string;
  organizer: string | null;
  attendees: string[];
  startsAt: string;
  snippet: string;
  cancelled: boolean;
}

export interface Page<T> {
  items: T[];
  /** Opaque continuation token (page token / nextLink); null when drained. */
  nextCursor: string | null;
}

export interface ListArgs {
  since: string;
  cursor?: string | null;
}

export interface SendArgs {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  /** RFC 5322 Message-ID of the message being replied to. */
  inReplyTo?: string;
  /** Used for the From header where the provider needs one. */
  from?: string;
}

export interface AuthUrlOptions {
  /** PKCE S256 challenge. */
  codeChallenge: string;
  /** Pre-selects the account at the provider (the CRM user's email). */
  loginHint?: string;
}

/**
 * One mailbox + calendar provider. Auth methods are app-level; mailbox methods take the
 * user's (decrypted) access token as their first argument.
 */
export interface MailProviderClient {
  readonly provider: MailProvider;
  readonly mode: "live" | "mock";
  readonly scopes: readonly string[];
  authUrl(state: string, opts: AuthUrlOptions): string;
  exchangeCode(code: string, codeVerifier: string): Promise<ExchangeResult>;
  refresh(refreshToken: string): Promise<ProviderTokens>;
  /** Best-effort revoke at the provider. Returns false when the provider has no revoke endpoint. */
  revoke(token: string): Promise<boolean>;
  listMessages(accessToken: string, args: ListArgs): Promise<Page<ProviderMessage>>;
  listEvents(accessToken: string, args: ListArgs): Promise<Page<ProviderEvent>>;
  /** Returns the provider message id of the sent message. */
  sendMessage(accessToken: string, args: SendArgs): Promise<string>;
}

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
}

/** Thrown for any non-2xx provider response. `status` 401/400 invalid_grant means re-connect. */
export class ProviderError extends Error {
  constructor(
    readonly provider: MailProvider,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

// ---------- helpers shared by both providers ----------

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Extract bare, lower-cased addresses from a header like `"Walker, Denise" <denise@x.gov>, bob@y.com`. */
export function parseAddresses(header: string | null | undefined): string[] {
  if (!header) return [];
  return [...new Set((header.match(EMAIL_RE) ?? []).map((a) => a.toLowerCase()))];
}

/** Collapse whitespace, strip tags and cap length. Snippets only — the CRM never stores full bodies. */
export function snippet(raw: string | null | undefined, max = 500): string {
  if (!raw) return "";
  const text = raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Decode the (unverified) payload of an id_token received directly from the provider's token endpoint over TLS. */
export function idTokenClaims(idToken: string | undefined): Record<string, unknown> {
  if (!idToken) return {};
  const part = idToken.split(".")[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function expiresAt(expiresInSeconds: number | undefined, now = Date.now()): string | null {
  return typeof expiresInSeconds === "number" ? new Date(now + expiresInSeconds * 1000).toISOString() : null;
}

export async function readJson<T>(provider: MailProvider, res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: unknown; error_description?: string };
      const e = body.error;
      detail =
        body.error_description ??
        (typeof e === "string" ? e : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ProviderError(provider, res.status, `${provider} ${res.status}: ${detail}`.slice(0, 500));
  }
  if (res.status === 202 || res.status === 204) return {} as T;
  return (await res.json()) as T;
}
