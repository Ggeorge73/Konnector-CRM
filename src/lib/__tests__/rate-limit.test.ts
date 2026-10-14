import { beforeEach, describe, expect, it } from "vitest";
import { API_RATE_RULE, rateLimitHeaders, resetRateLimits, takeApiToken } from "@/lib/api/rate-limit";
import { COPILOT_RATE_RULE, resetCopilotRateLimit } from "@/lib/copilot/run";
import { buckets, MemoryRateLimiter, memoryRateLimiter, resultFor, windowStart, type RateLimiter } from "@/lib/rate-limit";

const T0 = new Date("2026-10-12T15:00:00Z"); // on a minute and hour boundary
const at = (ms: number) => new Date(T0.getTime() + ms);
const rule = { limit: 3, windowMs: 60_000 };

describe("RateLimiter (memory)", () => {
  let rl: MemoryRateLimiter;
  beforeEach(() => {
    rl = new MemoryRateLimiter();
  });

  it("allows `limit` hits per window, then refuses with Retry-After until the window ends", async () => {
    const r1 = await rl.take("b", rule, T0);
    expect(r1).toEqual({ allowed: true, limit: 3, remaining: 2, reset: 60, retryAfter: 0 });
    await rl.take("b", rule, at(10_000));
    const r3 = await rl.take("b", rule, at(20_000));
    expect(r3).toMatchObject({ allowed: true, remaining: 0, reset: 40 });
    const blocked = await rl.take("b", rule, at(45_000));
    expect(blocked).toEqual({ allowed: false, limit: 3, remaining: 0, reset: 15, retryAfter: 15 });
    // Refused hits do not push the window further out.
    expect((await rl.take("b", rule, at(59_999))).allowed).toBe(false);
  });

  it("rolls over to a fresh allowance at the window boundary", async () => {
    for (let i = 0; i < 4; i++) await rl.take("b", rule, at(i * 1000));
    expect((await rl.take("b", rule, at(59_000))).allowed).toBe(false);
    const fresh = await rl.take("b", rule, at(60_000));
    expect(fresh).toMatchObject({ allowed: true, remaining: 2, reset: 60 });
    // A window is fixed, not sliding: hits late in one window don't count against the next.
    await rl.take("b", rule, at(119_000));
    await rl.take("b", rule, at(119_500));
    expect((await rl.take("b", rule, at(119_900))).allowed).toBe(false);
    expect((await rl.take("b", rule, at(120_000))).allowed).toBe(true);
  });

  it("keeps buckets independent and resets by prefix", async () => {
    for (let i = 0; i < 3; i++) await rl.take("api:key:a", rule, T0);
    for (let i = 0; i < 3; i++) await rl.take("copilot:user:a", rule, T0);
    expect((await rl.take("api:key:a", rule, T0)).allowed).toBe(false);
    expect((await rl.take("api:key:b", rule, T0)).allowed).toBe(true);
    rl.reset("api:");
    expect((await rl.take("api:key:a", rule, T0)).allowed).toBe(true);
    expect((await rl.take("copilot:user:a", rule, T0)).allowed).toBe(false);
    rl.reset();
    expect((await rl.take("copilot:user:a", rule, T0)).allowed).toBe(true);
  });

  it("computes windows and results the same way as take_rate_limit()", () => {
    expect(windowStart(at(61_234), 60_000)).toBe(T0.getTime() + 60_000);
    expect(resultFor(4, rule, at(30_000))).toEqual({ allowed: false, limit: 3, remaining: 0, reset: 30, retryAfter: 30 });
    expect(resultFor(1, rule, at(59_999))).toMatchObject({ allowed: true, remaining: 2, reset: 1 });
  });
});

describe("Copilot and API limits on the shared limiter", () => {
  beforeEach(() => {
    resetRateLimits();
    resetCopilotRateLimit();
  });

  it("keeps the same limits: 120/min per API key, 40/hour per Copilot user", () => {
    expect(API_RATE_RULE).toEqual({ limit: 120, windowMs: 60_000 });
    expect(COPILOT_RATE_RULE).toEqual({ limit: 40, windowMs: 3_600_000 });
    expect(buckets.api("k")).not.toBe(buckets.copilot("k"));
  });

  it("uses whichever limiter it is given (shared store in Supabase mode)", async () => {
    const calls: string[] = [];
    const fake: RateLimiter = {
      async take(bucket, r, now) {
        calls.push(bucket);
        return resultFor(r.limit + 1, r, now);
      },
    };
    const r = await takeApiToken(fake, "key-1", T0);
    expect(calls).toEqual(["api:key:key-1"]);
    expect(rateLimitHeaders(r)).toEqual({
      "RateLimit-Limit": "120",
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": "60",
      "Retry-After": "60",
    });
  });

  it("reset helpers only clear their own buckets", async () => {
    const shared = memoryRateLimiter();
    for (let i = 0; i < 40; i++) await shared.take(buckets.copilot("u"), COPILOT_RATE_RULE, T0);
    for (let i = 0; i < 120; i++) await takeApiToken(shared, "k", T0);
    resetRateLimits();
    expect((await takeApiToken(shared, "k", T0)).allowed).toBe(true);
    expect((await shared.take(buckets.copilot("u"), COPILOT_RATE_RULE, T0)).allowed).toBe(false);
    resetCopilotRateLimit();
    expect((await shared.take(buckets.copilot("u"), COPILOT_RATE_RULE, T0)).allowed).toBe(true);
  });
});
