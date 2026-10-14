/**
 * Structured logging and error reporting with no vendor SDK (choosing one is a PO decision).
 *
 * - Every call writes one JSON line to stdout/stderr, which the host's log drain picks up.
 * - `reportError` also POSTs the same payload to ERROR_WEBHOOK_URL when it is set
 *   (fire-and-forget, 3s timeout, failures swallowed so reporting never breaks a request).
 * - Payloads are allow-listed: source, route, user id, error name, message and stack. Never
 *   request bodies, emails, tokens or record content. Messages and stacks are scrubbed too,
 *   because a driver error can quote the value that failed.
 *
 * Runtime-agnostic (no Node-only imports) so instrumentation.ts can use it in either runtime.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogValue = string | number | boolean | null | undefined;

export interface ErrorContext {
  /** Where it happened, e.g. "action", "api.v1", "cron.daily", "integration.konnect_hub". */
  source: string;
  /** Path only; query strings are dropped. */
  route?: string | null;
  userId?: string | null;
}

export interface ErrorPayload {
  ts: string;
  level: "error";
  event: "error";
  source: string;
  route: string | null;
  userId: string | null;
  name: string;
  message: string;
  stack: string | null;
}

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_FIELD = 200;
const WEBHOOK_TIMEOUT_MS = 3000;

/** Field names that may carry content or secrets; dropped from logEvent fields whatever their value. */
const BLOCKED_KEY = /(body|payload|content|email|e-mail|subject|note|description|name$|token|secret|password|key|authorization|cookie)/i;

const SCRUBBERS: [RegExp, string][] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[jwt]"],
  [/\bkcrm_[A-Za-z0-9]+_[A-Za-z0-9]+/g, "[api-key]"],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "[secret]"],
  [/\b(postgres(?:ql)?|mysql|redis):\/\/[^\s"']+/gi, "$1://[redacted]"],
  [/([?&](?:token|code|key|secret|signature|sig|state|access_token|refresh_token)=)[^&\s"']+/gi, "$1[redacted]"],
];

/** Removes emails, bearer tokens, JWTs, API keys and connection strings from free text. */
export function scrub(text: string): string {
  let out = text;
  for (const [re, sub] of SCRUBBERS) out = out.replace(re, sub);
  return out;
}

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function routeOnly(route: string | null | undefined): string | null {
  if (!route) return null;
  return clip(route.split(/[?#]/)[0], MAX_FIELD);
}

function write(level: LogLevel, line: Record<string, unknown>) {
  const s = JSON.stringify(line);
  if (level === "error") console.error(s);
  else if (level === "warn") console.warn(s);
  else console.log(s);
}

/**
 * One structured log line, e.g. `logEvent("cron.daily.completed", { durationMs: 120, expired: 3 })`.
 * Fields are primitives only; content-like keys are dropped and string values are scrubbed.
 */
export function logEvent(event: string, fields: Record<string, LogValue> = {}, level: LogLevel = "info") {
  const safe: Record<string, LogValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || BLOCKED_KEY.test(k)) continue;
    if (v !== null && typeof v === "object") continue;
    safe[k] = typeof v === "string" ? clip(scrub(v), MAX_FIELD) : v;
  }
  write(level, { ...safe, ts: new Date().toISOString(), level, event });
}

/** Builds the redacted payload. Exported for tests. */
export function errorPayload(error: unknown, context: ErrorContext, now = new Date()): ErrorPayload {
  const e = error instanceof Error ? error : null;
  const raw = e ? e.message : typeof error === "string" ? error : "Non-Error thrown";
  return {
    ts: now.toISOString(),
    level: "error",
    event: "error",
    source: clip(String(context.source ?? "unknown"), MAX_FIELD),
    route: routeOnly(context.route),
    userId: context.userId ? clip(String(context.userId), MAX_FIELD) : null,
    name: e?.name ?? typeof error,
    message: clip(scrub(raw), MAX_MESSAGE),
    stack: e?.stack ? clip(scrub(e.stack), MAX_STACK) : null,
  };
}

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;
/** Tests: replace the transport used for ERROR_WEBHOOK_URL (null restores global fetch). */
export function setReportFetch(f: Fetch | null) {
  fetchImpl = f;
}

/**
 * Logs an error as one JSON line and, when ERROR_WEBHOOK_URL is set, POSTs it there.
 * Never throws. Returns the payload (and the pending webhook send, for tests).
 */
export function reportError(error: unknown, context: ErrorContext): { payload: ErrorPayload; sent: Promise<void> } {
  let payload: ErrorPayload;
  try {
    payload = errorPayload(error, context);
  } catch {
    payload = errorPayload("Unreportable error", { source: "observability" });
  }
  write("error", payload as unknown as Record<string, unknown>);
  const url = process.env.ERROR_WEBHOOK_URL;
  let sent: Promise<void> = Promise.resolve();
  if (url) {
    const body = JSON.stringify(payload);
    sent = Promise.resolve()
      .then(() =>
        (fetchImpl ?? fetch)(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        }),
      )
      .then(
        () => undefined,
        () => undefined, // fire-and-forget: a dead error sink must not cause more errors
      );
  }
  return { payload, sent };
}
