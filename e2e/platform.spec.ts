import { expect, signIn, test } from "./fixtures";

test("GET /api/health is public and ok on the demo backend", async ({ playwright, baseURL }) => {
  // A fresh context with no cookies: the health check must not need a session.
  const anon = await playwright.request.newContext({ baseURL });
  const res = await anon.get("/api/health");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = await res.json();
  expect(body).toMatchObject({
    status: "ok",
    checks: { database: { status: "ok" }, konnectHub: { status: "mock" }, version: { status: "ok" } },
  });
  expect(JSON.stringify(body)).not.toMatch(/localhost|secret|e2e-cron/i);
  await anon.dispose();
});

test("pages are served with strict security headers and a nonce-based CSP", async ({ page }) => {
  const res = await page.goto("/login");
  const h = res!.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toContain("camera=()");
  expect(h["strict-transport-security"]).toContain("max-age="); // e2e runs the production build
  const csp = h["content-security-policy"];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  // Next.js applies the request nonce to its own scripts.
  expect(await page.locator(`script[nonce]`).count()).toBeGreaterThan(0);
  // A new nonce per request.
  const again = await page.request.get("/login");
  expect(again.headers()["content-security-policy"]).not.toContain(nonce!);
});

test("cron jobs accept GET (Vercel Cron) with the same bearer check as POST", async ({ request }) => {
  for (const job of ["daily", "integrations", "mail-sync"]) {
    expect((await request.get(`/api/cron/${job}`)).status(), `GET ${job} without bearer`).toBe(401);
    expect((await request.get(`/api/cron/${job}`, { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
    expect((await request.post(`/api/cron/${job}`)).status(), `POST ${job} without bearer`).toBe(401);
    const ok = await request.get(`/api/cron/${job}`, { headers: { Authorization: "Bearer e2e-cron" } });
    expect(ok.status(), `GET ${job} with bearer`).toBe(200);
  }
});

test("the signed-in app renders under the CSP (globe, charts, styles)", async ({ page }) => {
  // The fixture fails the test on any console error, which includes CSP violations.
  await signIn(page, "admin");
  await expect(page.getByText("Pipeline value")).toBeVisible();
  await page.goto("/_kit");
  await expect(page.getByRole("heading", { name: "PulseGlobe", exact: true })).toBeVisible();
  await page.waitForTimeout(1500); // let the globe and charts mount
});
