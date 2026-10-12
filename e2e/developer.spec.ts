import { expect, signIn, test } from "./fixtures";

test("a user creates an API key, uses it against /api/v1, and revokes it", async ({ page, request }) => {
  await signIn(page, "bd");
  await page.goto("/developer");
  await expect(page.getByRole("heading", { name: "API & webhooks" })).toBeVisible();
  await expect(page.getByText("No API keys yet")).toBeVisible();
  // Webhooks are admin-only.
  await expect(page.getByText("Webhook subscriptions")).toHaveCount(0);

  await page.getByRole("button", { name: "New key" }).click();
  await page.getByLabel("Name").fill("E2E script");
  await page.getByRole("button", { name: "Create key" }).click();
  const secret = page.getByRole("dialog", { name: "Your new API key" }).locator("code[data-secret]");
  await expect(secret).toBeVisible();
  const key = (await secret.textContent())!.trim();
  expect(key).toMatch(/^kcrm_[0-9a-f]{8}_[0-9a-f]{64}$/);
  await page.getByRole("button", { name: "I've saved it" }).click();
  const list = page.getByRole("list", { name: "API keys" });
  await expect(list.getByText("E2E script")).toBeVisible();
  await expect(list.getByText(`kcrm_${key.split("_")[1]}_…`)).toBeVisible();

  const headers = { Authorization: `Bearer ${key}` };
  const res = await request.get("/api/v1/accounts", { headers });
  expect(res.status()).toBe(200);
  expect(res.headers()["ratelimit-limit"]).toBe("120");
  const body = await res.json();
  expect(body.data.length).toBeGreaterThan(0);
  expect(body).toHaveProperty("next_cursor");

  // Read-only key: writes are refused.
  const write = await request.post("/api/v1/tasks", { headers, data: { title: "From the API" } });
  expect(write.status()).toBe(403);
  expect((await write.json()).error.code).toBe("insufficient_scope");
  // No key at all.
  expect((await request.get("/api/v1/accounts")).status()).toBe(401);
  // The spec is public.
  expect((await (await request.get("/api/v1/openapi.json")).json()).openapi).toBe("3.1.0");

  await list.getByRole("button", { name: "Revoke E2E script" }).click();
  await page.getByRole("button", { name: "Revoke key" }).click();
  await expect(list.getByText("Revoked", { exact: true })).toBeVisible();
  expect((await request.get("/api/v1/accounts", { headers })).status()).toBe(401);
});

test("an admin creates a webhook subscription and sends a signed test event", async ({ page, request, baseURL }) => {
  await request.delete("/api/dev/webhook-echo");
  await signIn(page, "admin");
  await page.goto("/developer");
  await expect(page.getByText("No webhooks yet")).toBeVisible();

  await page.getByRole("button", { name: "New webhook" }).click();
  await page.getByLabel("Endpoint URL").fill(`${baseURL}/api/dev/webhook-echo`);
  await page.getByLabel("Description").fill("E2E echo");
  await page.getByRole("checkbox", { name: /account\.created/ }).check();
  await page.getByRole("checkbox", { name: /opportunity\.stage_changed/ }).check();
  await page.getByRole("button", { name: "Create webhook" }).click();
  const secret = page.getByRole("dialog", { name: "Webhook signing secret" }).locator("code[data-secret]");
  await expect(secret).toBeVisible();
  expect((await secret.textContent())!.trim()).toMatch(/^whsec_[0-9a-f]{48}$/);
  await page.getByRole("button", { name: "I've saved it" }).click();

  const subs = page.getByRole("list", { name: "Webhook subscriptions" });
  await expect(subs.getByText(`${baseURL}/api/dev/webhook-echo`)).toBeVisible();
  await subs.getByRole("button", { name: "Send test event" }).click();
  await expect(page.getByText(/Test event delivered \(HTTP 200\)/)).toBeVisible();
  await expect(page.getByRole("gridcell", { name: "Delivered", exact: true })).toBeVisible();

  const echo = await (await request.get("/api/dev/webhook-echo")).json();
  expect(echo.received).toHaveLength(1);
  expect(echo.received[0]).toMatchObject({ verified: true, event: "account.created", body: { test: true, event: "account.created" } });

  // Pausing stops real events but the switch round-trips.
  await subs.getByRole("checkbox", { name: /Disable/ }).click();
  await expect(subs.getByText("Paused")).toBeVisible();
});
