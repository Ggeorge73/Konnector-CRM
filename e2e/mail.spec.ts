import { expect, signIn, test } from "./fixtures";

test.describe("email & calendar (mock provider)", () => {
  test("connect Google, sync, see Denise's email on GTA, send from a contact, disconnect", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/connections");
    await expect(page.getByRole("heading", { name: "Email & calendar" })).toBeVisible();
    await expect(page.getByText("No mailbox connected yet.")).toBeVisible();

    // Mock OAuth round trip: start -> (provider) -> callback -> /connections?connected=google
    await page.getByRole("link", { name: "Connect Google Workspace" }).click();
    await page.waitForURL(/\/connections\?connected=google/);
    await expect(page.getByText("Google Workspace connected.")).toBeVisible();
    const card = page.getByTestId("connection-google");
    await expect(card.getByText("marcus@konnectorllc.com")).toBeVisible();
    await expect(card.getByText("Active")).toBeVisible();

    await card.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByText(/Synced — \d+ new items? logged/)).toBeVisible();
    const recent = page.getByRole("list", { name: "Recently synced items" });
    await expect(recent.getByText("Re: Phased migration plan for ITSM")).toBeVisible();
    await expect(recent.getByText("Permit backlog working session")).toBeVisible();
    // Personal mail is never stored.
    await expect(page.getByText("Weekend sale")).toHaveCount(0);

    // On the GTA account timeline.
    await page.goto("/accounts");
    await page.getByRole("link", { name: "Georgia Technology Authority" }).click();
    await page.getByRole("tab", { name: /Timeline/ }).click();
    await expect(page.getByText("Re: Phased migration plan for ITSM")).toBeVisible();
    await expect(page.getByText(/From Denise Walker/).first()).toBeVisible();

    // Send from a contact via ComposeEmailButton (dev harness).
    await page.goto("/contacts");
    await page.getByRole("link", { name: "Denise Walker" }).click();
    await page.waitForURL(/\/contacts\/[0-9a-f-]{36}$/);
    const contactUrl = page.url();
    const contactId = contactUrl.split("/").pop()!;
    await page.goto(`/_kit/compose?contact=${contactId}`);
    await page.getByRole("button", { name: "Send email" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: /Denise Walker/ })).toBeVisible(); // pre-selected "To" chip
    await dialog.getByLabel("Subject").fill("Cut-over rehearsal plan");
    await dialog.getByLabel("Message").fill("Hi Denise,\n\nHere is the rehearsal plan we discussed.");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Email sent and logged to the timeline")).toBeVisible();

    await page.goto(contactUrl);
    await expect(page.getByText("Cut-over rehearsal plan")).toBeVisible();
    await expect(page.getByText(/To Denise Walker/).first()).toBeVisible();

    // Disconnect wipes the connection.
    await page.goto("/connections");
    await page.getByTestId("connection-google").getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByText("Mailbox disconnected")).toBeVisible();
    await expect(page.getByText("No mailbox connected yet.")).toBeVisible();
  });

  test("compose is disabled until a mailbox is connected", async ({ page }) => {
    await signIn(page, "bd2");
    await page.goto("/_kit/compose");
    await expect(page.getByRole("button", { name: "Send email" })).toBeDisabled();
    await expect(page.getByText("— no mailbox connected")).toBeVisible();
  });

  test("cron endpoint requires the bearer secret", async ({ request }) => {
    expect((await request.post("/api/cron/mail-sync")).status()).toBe(401);
    const ok = await request.post("/api/cron/mail-sync", { headers: { Authorization: "Bearer e2e-cron" } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toMatchObject({ failed: 0 });
  });
});
