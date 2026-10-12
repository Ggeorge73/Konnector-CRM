import { expect, signIn, test } from "./fixtures";

test.describe("Konnector Copilot", () => {
  test("deal owner gets a Bid/No-Bid suggestion and pre-fills the scorecard", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/opportunities");
    // A scorecard waiting for executive approval can't be re-scored, so Copilot doesn't offer it.
    await page.getByRole("link", { name: "Motor Vehicle System Integration" }).first().click();
    await page.getByRole("button", { name: "Copilot" }).click();
    let drawer = page.getByRole("presentation").filter({ has: page.getByRole("heading", { name: "Konnector Copilot" }) });
    await expect(drawer.getByRole("tab", { name: "Draft follow-up" })).toBeVisible();
    await expect(drawer.getByRole("tab", { name: "Suggest Bid/No-Bid" })).toHaveCount(0);
    await drawer.getByRole("button", { name: "Close Copilot" }).click();
    await page.goto("/opportunities");
    await page.getByRole("link", { name: "Enterprise Service Desk Modernisation" }).first().click();
    await page.getByRole("button", { name: "Copilot" }).click();
    drawer = page.getByRole("presentation").filter({ has: page.getByRole("heading", { name: "Konnector Copilot" }) });
    await drawer.getByRole("tab", { name: "Suggest Bid/No-Bid" }).click();
    await drawer.getByRole("button", { name: "Suggest Bid/No-Bid" }).click();
    await expect(drawer.getByText("Demo response")).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Suggested verdict" })).toBeVisible();
    await drawer.getByRole("button", { name: "Use in scorecard" }).click();
    await expect(page.getByRole("heading", { name: "Konnector Copilot" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Bid / No-Bid", selected: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for approval" })).toBeVisible();
  });

  test("turns meeting notes into follow-ups only for the ticked items", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/opportunities");
    await page.getByRole("link", { name: "Motor Vehicle System Integration" }).first().click();
    await page.getByRole("button", { name: "Copilot" }).click();
    const drawer = page.getByRole("presentation").filter({ has: page.getByRole("heading", { name: "Konnector Copilot" }) });
    await drawer.getByRole("tab", { name: "Notes → follow-ups" }).click();
    await drawer
      .getByLabel("Meeting notes")
      .fill("Met the DOR CIO. Send the capability statement by Friday. Book a technical demo with the integration team.");
    await drawer.getByRole("button", { name: "Notes → follow-ups" }).click();
    const boxes = drawer.getByRole("checkbox");
    await expect(boxes.first()).toBeChecked();
    const count = await boxes.count();
    if (count > 1) await boxes.nth(1).uncheck();
    const expected = count > 1 ? count - 1 : 1;
    await drawer.getByRole("button", { name: new RegExp(`Create ${expected} follow-up`) }).click();
    await expect(page.getByText(new RegExp(`Created ${expected} follow-up`))).toBeVisible();
  });

  test("summarises an account and lists usage on the Copilot page", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/accounts");
    await page.getByRole("link", { name: "Georgia Technology Authority" }).first().click();
    await page.getByRole("button", { name: "Copilot" }).click();
    const drawer = page.getByRole("presentation").filter({ has: page.getByRole("heading", { name: "Konnector Copilot" }) });
    await drawer.getByRole("button", { name: "Summarise account" }).click();
    await expect(drawer.getByText("AI draft — review before use")).toBeVisible();
    await drawer.getByRole("button", { name: "Save as note" }).click();
    await expect(page.getByText("Saved to the timeline")).toBeVisible();
    await page.goto("/copilot");
    await expect(page.getByRole("heading", { name: "Copilot", level: 1 })).toBeVisible();
    await expect(page.getByRole("gridcell", { name: "Account summary" })).toBeVisible();
  });
});
