import { createHmac, timingSafeEqual } from "node:crypto";

/** Max clock skew accepted on inbound webhooks. */
export const MAX_SKEW_MS = 5 * 60_000;

/**
 * X-Konnector-Signature: `t=<unix ms>,v1=<hex hmac-sha256 of "<t>.<body>">`.
 * The timestamp is signed too, so captured requests can't be replayed later.
 */
export function sign(body: string, secret: string, t: number = Date.now()): string {
  const mac = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${mac}`;
}

export function verify(
  body: string,
  header: string | null,
  secret: string,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "missing signature" };
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1) return { ok: false, reason: "malformed signature" };
  if (Math.abs(now - t) > MAX_SKEW_MS) return { ok: false, reason: "stale signature" };
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}

/**
 * Plain body signature used by the konnectortech.com website: `sha256=<hex HMAC-SHA256(secret, raw body)>`.
 * There is no timestamp, so the receiver must be idempotent (see services/website-leads.ts).
 */
export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function verifyBody(body: string, header: string | null, secret: string): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "missing signature" };
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return { ok: false, reason: "malformed signature" };
  const expected = createHmac("sha256", secret).update(body).digest();
  if (!timingSafeEqual(Buffer.from(m[1], "hex"), expected)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}
