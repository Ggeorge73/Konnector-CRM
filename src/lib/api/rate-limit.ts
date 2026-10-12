/**
 * Per-key token bucket: RATE_LIMIT requests per minute, refilled continuously.
 * In-memory (per server instance) — good enough for an internal API; put a shared store
 * (Redis/Upstash) behind the same interface if the app is scaled out.
 */
export const RATE_LIMIT = 120;
const WINDOW_MS = 60_000;
const REFILL_PER_MS = RATE_LIMIT / WINDOW_MS;

interface Bucket {
  tokens: number;
  at: number;
}

const g = globalThis as unknown as { __kcrmRateBuckets?: Map<string, Bucket> };
const buckets = () => (g.__kcrmRateBuckets ??= new Map());

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the bucket is full again. */
  reset: number;
  /** Seconds until the next request is allowed (only when blocked). */
  retryAfter: number;
}

export function takeToken(key: string, now: number = Date.now()): RateLimitResult {
  const map = buckets();
  const prev = map.get(key) ?? { tokens: RATE_LIMIT, at: now };
  const tokens = Math.min(RATE_LIMIT, prev.tokens + Math.max(0, now - prev.at) * REFILL_PER_MS);
  const allowed = tokens >= 1;
  const left = allowed ? tokens - 1 : tokens;
  map.set(key, { tokens: left, at: now });
  return {
    allowed,
    limit: RATE_LIMIT,
    remaining: Math.floor(left),
    reset: Math.ceil((RATE_LIMIT - left) / REFILL_PER_MS / 1000),
    retryAfter: allowed ? 0 : Math.ceil((1 - left) / REFILL_PER_MS / 1000),
  };
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(r.reset),
  };
  if (!r.allowed) h["Retry-After"] = String(r.retryAfter);
  return h;
}

/** Tests only. */
export function resetRateLimits() {
  buckets().clear();
}
