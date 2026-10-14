import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resultFor, type RateLimiter, type RateLimitResult, type RateLimitRule } from "./index";

/**
 * Postgres-backed limiter: one atomic upsert per request through take_rate_limit()
 * (supabase/migrations/20261014000002_rate_limits.sql). Service role only — signed-in roles
 * cannot read the table or call the function.
 */
export class SupabaseRateLimiter implements RateLimiter {
  constructor(private client: SupabaseClient) {}

  async take(bucket: string, rule: RateLimitRule, now: Date): Promise<RateLimitResult> {
    const { data, error } = await this.client.rpc("take_rate_limit", {
      p_bucket: bucket,
      p_limit: rule.limit,
      p_window_seconds: Math.round(rule.windowMs / 1000),
      p_now: now.toISOString(),
    });
    if (error) throw new Error(`take_rate_limit: ${error.message}`);
    return resultFor(Number(data), rule, now);
  }
}

let shared: SupabaseRateLimiter | null = null;

export function supabaseRateLimiter(): SupabaseRateLimiter {
  if (!shared) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for rate limiting in Supabase mode");
    shared = new SupabaseRateLimiter(createClient(url, key, { auth: { persistSession: false } }));
  }
  return shared;
}
