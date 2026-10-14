/**
 * REST API v1 rate limit: RATE_LIMIT requests per key per minute (fixed window), on the shared
 * RateLimiter (src/lib/rate-limit) — Postgres in Supabase mode, so it holds across instances.
 */
import { buckets, memoryRateLimiter, type RateLimiter, type RateLimitResult, type RateLimitRule } from "@/lib/rate-limit";

export type { RateLimitResult };

export const RATE_LIMIT = 120;
export const API_RATE_RULE: RateLimitRule = { limit: RATE_LIMIT, windowMs: 60_000 };

export function takeApiToken(limiter: RateLimiter, keyId: string, now: Date): Promise<RateLimitResult> {
  return limiter.take(buckets.api(keyId), API_RATE_RULE, now);
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

/** Tests only: clears the API buckets of the in-memory limiter. */
export function resetRateLimits() {
  memoryRateLimiter().reset("api:");
}
