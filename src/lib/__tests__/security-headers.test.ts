import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, createNonce, staticSecurityHeaders } from "@/lib/security/headers";

const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

describe("Content-Security-Policy", () => {
  it("locks down defaults, frames, objects and forms", () => {
    const d = directives(contentSecurityPolicy({ nonce: "n0nce" }));
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["form-action"]).toEqual(["'self'"]);
  });

  it("uses a nonce + strict-dynamic for scripts, and no eval outside dev", () => {
    const d = directives(contentSecurityPolicy({ nonce: "n0nce" }));
    expect(d["script-src"]).toEqual(["'self'", "'nonce-n0nce'", "'strict-dynamic'"]);
    expect(d["script-src"]).not.toContain("'unsafe-inline'");
    expect(directives(contentSecurityPolicy({ nonce: "n", dev: true }))["script-src"]).toContain("'unsafe-eval'");
  });

  it("allows the Supabase origin over https and wss only when configured", () => {
    expect(directives(contentSecurityPolicy({ nonce: "n" }))["connect-src"]).toEqual(["'self'"]);
    const d = directives(contentSecurityPolicy({ nonce: "n", supabaseUrl: "https://abc.supabase.co/" }));
    expect(d["connect-src"]).toEqual(["'self'", "https://abc.supabase.co", "wss://abc.supabase.co"]);
    expect(directives(contentSecurityPolicy({ nonce: "n", supabaseUrl: "not a url" }))["connect-src"]).toEqual(["'self'"]);
  });

  it("generates a fresh base64 nonce each time", () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(a);
  });
});

describe("static security headers", () => {
  const asMap = (production: boolean) => Object.fromEntries(staticSecurityHeaders(production).map((h) => [h.key, h.value]));

  it("sets frame, sniffing, referrer and permissions policies", () => {
    const h = asMap(false);
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Permissions-Policy"]).toContain("microphone=()");
    expect(h["Permissions-Policy"]).toContain("geolocation=()");
  });

  it("sends HSTS only in production", () => {
    expect(asMap(false)).not.toHaveProperty("Strict-Transport-Security");
    expect(asMap(true)["Strict-Transport-Security"]).toMatch(/^max-age=\d{8}; includeSubDomains$/);
  });
});
