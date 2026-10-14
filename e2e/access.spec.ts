import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";

/**
 * KCRM-69. The demo email sign-in runs the same server-side admitSignIn() as the production
 * OAuth / magic-link callback: domain check, then a pending (no role) user for new people.
 */
async function emailSignIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Sign in with email" }).click();
}

test.describe("sign-in hardening", () => {
  test("rejects an email outside the allowed domain on the server", async ({ page }) => {
    await emailSignIn(page, "eve@gmail.com");
    await expect(page).toHaveURL(/\/login\?error=domain/);
    await expect(page.getByText("Only @konnectorllc.com accounts can sign in.")).toBeVisible();
    // No session was created.
    await page.goto("/accounts");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a new teammate waits on the pending page until an admin assigns a role", async ({ page, browser }) => {
    await emailSignIn(page, "new.starter@konnectorllc.com");
    await expect(page).toHaveURL(/\/pending$/);
    await expect(page.getByRole("heading", { name: "Pending access" })).toBeVisible();
    await expect(page.getByText("new.starter@konnectorllc.com")).toBeVisible();

    // Every app route sends them back to /pending; no CRM data or navigation is rendered.
    for (const path of ["/", "/accounts", "/opportunities", "/settings", "/copilot"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/pending$/);
    }
    await expect(page.getByRole("navigation")).toHaveCount(0);
    const search = await page.request.get("/api/search?q=Georgia", { maxRedirects: 0 });
    expect(search.status()).not.toBe(200);

    // An admin lets them in from Settings → Team.
    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    await signIn(admin, "admin");
    await admin.goto("/settings#team");
    await expect(admin.getByText("1 waiting")).toBeVisible();
    await admin.getByRole("combobox", { name: "Role for New Starter" }).click();
    await admin.getByRole("option", { name: "Business development" }).click();
    await expect(admin.getByText("Role updated")).toBeVisible();
    await admin.goto("/audit");
    await expect(admin.getByText(/user\.role_changed/).first()).toBeVisible();
    await adminCtx.close();

    await page.goto("/pending");
    await expect(page).not.toHaveURL(/\/pending/);
    await page.goto("/accounts");
    await expect(page).toHaveURL(/\/accounts$/);
  });

  test("the role select is disabled for the admin's own row", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/settings");
    await expect(page.getByRole("combobox", { name: "Role for Olugbenga George" })).toHaveAttribute("aria-disabled", "true");
  });
});
