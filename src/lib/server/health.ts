/**
 * Health checks behind GET /api/health (public, for uptime monitors).
 *
 * Output never carries error messages, hostnames or env values: each check reports a status,
 * its latency and, on failure, a coarse reason ("timeout" | "error" | "http_5xx" | "not_configured").
 * The database being down makes the service "down" (HTTP 503); Konnect Hub being unreachable only
 * makes it "degraded" (HTTP 200), because the outbox retries deliveries once it is back.
 */

export const CHECK_TIMEOUT_MS = 2000;

export type FailureReason = "timeout" | "error" | "http_5xx" | "not_configured";

export interface DatabaseCheck {
  status: "ok" | "down";
  latencyMs: number;
  reason?: FailureReason;
}

export interface KonnectHubCheck {
  status: "ok" | "mock" | "unreachable";
  latencyMs: number;
  reason?: FailureReason;
}

export interface VersionCheck {
  status: "ok";
  version: string;
  commit: string | null;
}

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  checks: { database: DatabaseCheck; konnectHub: KonnectHubCheck; version: VersionCheck };
}

export interface HealthDeps {
  /** Resolves when the database answers a trivial query; rejects otherwise. */
  pingDatabase: (signal: AbortSignal) => Promise<void>;
  /** "mock" when the built-in mock is in use; otherwise resolves with the HTTP status of a probe. */
  probeKonnectHub: (signal: AbortSignal) => Promise<"mock" | "not_configured" | number>;
  version: string;
  commit?: string | null;
  timeoutMs?: number;
  clock?: () => number;
}

class TimeoutError extends Error {}

/** Runs `fn` with an abort signal and rejects with TimeoutError after `ms`. */
export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new TimeoutError("timeout"));
    }, ms);
  });
  try {
    return await Promise.race([fn(ctrl.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const reasonOf = (e: unknown): FailureReason => (e instanceof TimeoutError ? "timeout" : "error");

export async function checkDatabase(deps: HealthDeps): Promise<DatabaseCheck> {
  const clock = deps.clock ?? Date.now;
  const start = clock();
  try {
    await withTimeout(deps.pingDatabase, deps.timeoutMs ?? CHECK_TIMEOUT_MS);
    return { status: "ok", latencyMs: clock() - start };
  } catch (e) {
    return { status: "down", latencyMs: clock() - start, reason: reasonOf(e) };
  }
}

export async function checkKonnectHub(deps: HealthDeps): Promise<KonnectHubCheck> {
  const clock = deps.clock ?? Date.now;
  const start = clock();
  try {
    const r = await withTimeout(deps.probeKonnectHub, deps.timeoutMs ?? CHECK_TIMEOUT_MS);
    const latencyMs = clock() - start;
    if (r === "mock") return { status: "mock", latencyMs };
    if (r === "not_configured") return { status: "unreachable", latencyMs, reason: "not_configured" };
    // Any answer below 500 (even 404/405) proves the Hub is up and reachable from here.
    return r < 500 ? { status: "ok", latencyMs } : { status: "unreachable", latencyMs, reason: "http_5xx" };
  } catch (e) {
    return { status: "unreachable", latencyMs: clock() - start, reason: reasonOf(e) };
  }
}

export async function runHealth(deps: HealthDeps): Promise<HealthReport> {
  const [database, konnectHub] = await Promise.all([checkDatabase(deps), checkKonnectHub(deps)]);
  const version: VersionCheck = { status: "ok", version: deps.version, commit: deps.commit ?? null };
  const status = database.status === "down" ? "down" : konnectHub.status === "unreachable" ? "degraded" : "ok";
  return { status, checks: { database, konnectHub, version } };
}

export const httpStatusFor = (r: HealthReport) => (r.status === "down" ? 503 : 200);
