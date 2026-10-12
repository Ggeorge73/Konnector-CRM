import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isDemo } from "@/config/app";
import type { MailProvider } from "@/lib/domain/types";
import { createGoogleClient } from "./google";
import { createMicrosoftClient } from "./microsoft";
import { createMockClient } from "./mock";
import type { MailProviderClient } from "./types";

export * from "./types";

export const MAIL_PROVIDERS: readonly MailProvider[] = ["google", "microsoft"];
export const PROVIDER_LABEL: Record<MailProvider, string> = { google: "Google Workspace", microsoft: "Microsoft 365" };

export function isMailProvider(v: string): v is MailProvider {
  return (MAIL_PROVIDERS as readonly string[]).includes(v);
}

function credentials(provider: MailProvider) {
  return provider === "google"
    ? { clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" }
    : { clientId: process.env.MICROSOFT_CLIENT_ID ?? "", clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "" };
}

/**
 * live = real provider; mock = deterministic fake (MAIL_PROVIDER_MODE=mock, or demo backend without client ids);
 * off = not configured.
 */
export function providerMode(provider: MailProvider): "live" | "mock" | "off" {
  const forced = process.env.MAIL_PROVIDER_MODE;
  if (forced === "mock") return "mock";
  const { clientId, clientSecret } = credentials(provider);
  if (clientId && clientSecret) return "live";
  if (forced === "live") return "off";
  return isDemo() ? "mock" : "off";
}

export function redirectUri(provider: MailProvider, origin?: string): string {
  const base = (process.env.APP_URL || origin || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/oauth/${provider}/callback`;
}

/** Resolve the client for a provider. Throws when the provider isn't configured. */
export function mailClient(provider: MailProvider, origin?: string): MailProviderClient {
  const mode = providerMode(provider);
  const uri = redirectUri(provider, origin);
  if (mode === "mock") return createMockClient(provider, { redirectUri: uri });
  if (mode === "off") throw new Error(`${PROVIDER_LABEL[provider]} is not configured. Set the client id and secret (see docs/MAIL.md).`);
  const creds = credentials(provider);
  return provider === "google"
    ? createGoogleClient({ ...creds, redirectUri: uri })
    : createMicrosoftClient({ ...creds, redirectUri: uri, tenantId: process.env.MICROSOFT_TENANT_ID || "common" });
}

// ---------------- OAuth state + PKCE ----------------

const STATE_TTL_MS = 10 * 60_000;

function stateKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw && process.env.NODE_ENV === "production" && process.env.DATA_BACKEND === "supabase") {
    throw new Error("APP_ENCRYPTION_KEY is required in production");
  }
  return createHash("sha256")
    .update(`oauth-state:${raw ?? "konnector-crm-dev-only-key"}`)
    .digest();
}

const mac = (s: string) => createHmac("sha256", stateKey()).update(s).digest("base64url");

export interface OAuthState {
  uid: string;
  provider: MailProvider;
  nonce: string;
  exp: number;
}

/** Signed, short-lived state binding the round trip to the signed-in user and provider. */
export function signState(uid: string, provider: MailProvider, now = Date.now()): string {
  const body: OAuthState = { uid, provider, nonce: randomBytes(16).toString("base64url"), exp: now + STATE_TTL_MS };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

/** Returns the state if the signature is valid, it hasn't expired, and it matches the user + provider. */
export function verifyState(state: string, expect: { uid: string; provider: MailProvider }, now = Date.now()): OAuthState | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(mac(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (s.exp < now || s.uid !== expect.uid || s.provider !== expect.provider) return null;
    return s;
  } catch {
    return null;
  }
}

/** PKCE verifier derived from the signed state (server secret + nonce), so no extra cookie is needed. */
export function pkceVerifier(state: string): string {
  return createHmac("sha256", stateKey()).update(`pkce:${state}`).digest("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
