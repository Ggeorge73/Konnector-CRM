import { expect, signIn, test } from "./fixtures";

test("redirects anonymous users to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("Pulse home loads with KPIs for an admin", async ({ page }) => {
  await signIn(page, "admin");
  await expect(page.getByRole("heading", { name: "Olugbenga" })).toBeVisible();
  await expect(page.getByText("Pipeline value")).toBeVisible();
  await expect(page.getByText("Bids due in 14 days").first()).toBeVisible();
});

test("theme toggle switches and persists", async ({ page }) => {
  await signIn(page, "exec");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("command palette opens with Ctrl+K and searches records", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcut is desktop-only");
  await signIn(page, "admin");
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Search" });
  await expect(input).toBeVisible();
  await input.fill("Georgia Tech");
  await expect(page.getByRole("option", { name: /Georgia Technology Authority/ })).toBeVisible();
});

test("role guard blocks a bd user from admin routes", async ({ page }) => {
  await signIn(page, "bd");
  await page.goto("/settings");
  await expect(page).toHaveURL(/denied=1/);
  await expect(page.getByText("isn't available for your role")).toBeVisible();
});

test("component kit renders every component", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/_kit");
  for (const name of ["Component kit", "HealthRing", "ScoreCard", "Timeline", "KanbanBoard", "EmptyState", "PulseGlobe"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
});
