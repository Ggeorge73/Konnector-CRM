import { expect, signIn, test } from "./fixtures";

test.describe("compliance, settings, forecast and calendar", () => {
  test("admin edits a registration expiry", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/registrations");
    await expect(page.getByRole("heading", { name: "Registrations", level: 1 })).toBeVisible();
    await expect(page.getByText("Expired", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Edit Cyber liability insurance ($5M)" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Expires on").fill("2027-10-09");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("gridcell", { name: /Oct 9, 2027/ })).toBeVisible();

    await page.getByRole("button", { name: "Run reminders now" }).click();
    await expect(page.getByText(/Sent \d+ reminders?|No new reminders/)).toBeVisible();
  });

  test("bd sees registrations read-only", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/registrations");
    await expect(page.getByText("SAM.gov entity registration")).toBeVisible();
    await expect(page.getByRole("button", { name: "New registration" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  });

  test("exec opens vetting and starts or edits a review", async ({ page }) => {
    await signIn(page, "exec");
    await page.goto("/vetting");
    await expect(page.getByRole("heading", { name: "Partner vetting", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Okeke & Hart Consulting" })).toBeVisible();
    await page.getByRole("button", { name: "Edit vetting for Okeke & Hart Consulting" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Anti-corruption attestation signed").check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    const card = page.getByRole("listitem", { name: "Okeke & Hart Consulting" });
    await expect(card.getByText("Attested")).toBeVisible();
  });

  test("bd navigating to /vetting is redirected", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/vetting");
    await expect(page).toHaveURL(/\?denied=1/);
    await expect(page.getByText("isn't available for your role")).toBeVisible();
  });

  test("admin changes the margin floor in settings", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/settings");
    await expect(page.getByText("Total 100 / 100")).toBeVisible();
    await page.getByLabel("Strategic fit").fill("25");
    await expect(page.getByText("Total 105 / 100")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save settings" })).toBeDisabled();
    await page.getByLabel("Strategic fit").fill("20");
    await page.getByLabel("Margin floor").fill("21");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Margin floor")).toHaveValue("21");
  });

  test("forecast renders", async ({ page }) => {
    await signIn(page, "exec");
    await page.goto("/forecast");
    await expect(page.getByRole("heading", { name: "Forecast", level: 1 })).toBeVisible();
    await expect(page.getByText("Weighted pipeline")).toBeVisible();
    await expect(page.getByRole("heading", { name: "By expected close quarter" })).toBeVisible();
    await expect(page.getByRole("gridcell", { name: "Proposal", exact: true })).toBeVisible();
    await expect(page.getByRole("gridcell", { name: "Systems integration", exact: true })).toBeVisible();
  });

  test("calendar renders, navigates months and links to deals", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "Bid calendar", level: 1 })).toBeVisible();
    const upcoming = page.getByRole("list", { name: "Upcoming deadlines" });
    await expect(upcoming.getByRole("link").first()).toBeVisible();
    await page.getByRole("link", { name: "Next month" }).click();
    await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
    await page.getByRole("link", { name: "Previous month" }).click();
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
  });
});
