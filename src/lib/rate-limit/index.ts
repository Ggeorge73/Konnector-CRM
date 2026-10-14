/**
 * One RateLimiter port for Copilot (per user, per hour) and the REST API (per key, per minute).
 *
 * Fixed windows: a bucket may take `limit` hits per window; the window containing `now` is
 * floor(now / windowMs) * windowMs, so every server instance agrees on it.
 * - Supabase mode: Postgres `rate_limits` + the atomic take_rate_limit() function (service role),
 *   so limits hold across instances (./supabase.ts).
 * - Demo and tests: in-memory, per process (MemoryRateLimiter).
 */
import { env } from "@/config/app";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window ends (and the bucket is full again). */
  reset: number;
  /** Seconds until the next request is allowed (only when blocked). */
  retryAfter: number;
}

export interface RateLimiter {
  /** Counts one request against `bucket` and says whether it is allowed. */
  take(bucket: string, rule: RateLimitRule, now: Date): Promise<RateLimitResult>;
}

export function windowStart(now: Date, windowMs: number): number {
  return Math.floor(now.getTime() / windowMs) * windowMs;
}

/** Turns "hits in this window, including this one" into a result. hits > limit means refused. */
export function resultFor(hits: number, rule: RateLimitRule, now: Date): RateLimitResult {
  const allowed = hits <= rule.limit;
  const reset = Math.max(1, Math.ceil((windowStart(now, rule.windowMs) + rule.windowMs - now.getTime()) / 1000));
  return {
    allowed,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - Math.min(hits, rule.limit)),
    reset,
    retryAfter: allowed ? 0 : reset,
  };
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { start: number; hits: number }>();

  async take(bucket: string, rule: RateLimitRule, now: Date): Promise<RateLimitResult> {
    const start = windowStart(now, rule.windowMs);
    const prev = this.buckets.get(bucket);
    const cur = prev && prev.start === start ? prev : { start, hits: 0 };
    // Mirrors take_rate_limit(): the counter stops at the limit; a refused hit reports limit + 1.
    const hits = cur.hits < rule.limit ? ++cur.hits : rule.limit + 1;
    this.buckets.set(bucket, cur);
    return resultFor(hits, rule, now);
  }

  /** Tests and the demo reset: forget every bucket, or those starting with `prefix`. */
  reset(prefix?: string) {
    if (!prefix) return this.buckets.clear();
    for (const k of [...this.buckets.keys()]) if (k.startsWith(prefix)) this.buckets.delete(k);
  }
}

const g = globalThis as unknown as { __kcrmRateLimiter?: MemoryRateLimiter };

/** The per-process limiter used by the demo backend and unit tests. */
export function memoryRateLimiter(): MemoryRateLimiter {
  return (g.__kcrmRateLimiter ??= new MemoryRateLimiter());
}

/** The limiter for this deployment: shared Postgres counters in Supabase mode, memory otherwise. */
export async function getRateLimiter(): Promise<RateLimiter> {
  if (env.dataBackend !== "supabase") return memoryRateLimiter();
  const { supabaseRateLimiter } = await import("./supabase");
  return supabaseRateLimiter();
}

/** Bucket names, so the two users of the limiter never collide. */
export const buckets = {
  copilot: (userId: string) => `copilot:user:${userId}`,
  api: (keyId: string) => `api:key:${keyId}`,
};
