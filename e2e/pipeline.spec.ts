import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";

async function drag(page: Page, cardName: string, column: string) {
  const card = page.getByRole("link", { name: cardName }).locator("xpath=ancestor::div[@role='button'][1]");
  const target = page.getByRole("region", { name: new RegExp(`^${column} column`) });
  const a = (await card.boundingBox())!;
  const b = (await target.boundingBox())!;
  // Grab the card body below the title link (the link itself stays clickable).
  const y = a.y + a.height - 8;
  await page.mouse.move(a.x + a.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, y + 10, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + 80, { steps: 15 });
  await page.mouse.up();
}

test.describe("capture pipeline", () => {
  test("kanban drag moves a deal between adjacent stages", async ({ page }) => {
    await signIn(page, "bd2");
    await page.goto("/opportunities");
    await drag(page, "Utility Billing Upgrade", "Qualify");
    await expect(page.getByRole("region", { name: /^Qualify column/ }).getByRole("link", { name: "Utility Billing Upgrade" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: /^Qualify column/ }).getByRole("link", { name: "Utility Billing Upgrade" })).toBeVisible();
  });

  test("moving to Lost opens the stage gate and requires a reason", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/opportunities?view=table");
    await page.getByRole("link", { name: "Enterprise Service Desk Modernisation" }).click();
    await page.getByRole("button", { name: "Move stage" }).click();
    await page.getByRole("menuitem", { name: "Lost" }).click();
    const dialog = page.getByRole("dialog", { name: /Move to Lost/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Say why we lost").or(page.getByText("A lost reason is required.")).first()).toBeVisible();
    await dialog.getByLabel("Why did we lose?").fill("Incumbent undercut on price");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Lost: Incumbent undercut on price")).toBeVisible();
  });

  test("public bid can't pass Bid / No-Bid until an executive approves the scorecard", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/opportunities");
    await page.getByRole("link", { name: "VA Scheduling Integration (sub to prime)" }).click();
    await page.getByRole("tab", { name: "Bid / No-Bid" }).click();
    await page.getByRole("group", { name: "Strategic fit score" }).getByRole("button", { name: "5" }).click();
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByText(/Waiting for executive approval/)).toBeVisible();

    await signIn(page, "exec");
    await page.goto("/notifications");
    await page.getByText("Bid/No-Bid approval needed: VA Scheduling Integration (sub to prime)").first().click();
    await page.getByRole("tab", { name: "Bid / No-Bid" }).click();
    await page.getByRole("button", { name: "Approve verdict" }).click();
    await expect(page.getByText("approved", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: "Move stage" }).click();
    await page.getByRole("menuitem", { name: "Proposal" }).click();
    await expect(page.getByText("Stage updated")).toBeVisible();
  });

  test("below-floor quote needs executive approval; client PDF has no cost", async ({ page }) => {
    await signIn(page, "bd2");
    await page.goto("/opportunities");
    await page.getByRole("link", { name: "Core Banking Integration" }).click();
    await page.getByRole("tab", { name: /Quotes/ }).click();
    await page.getByRole("button", { name: "New quote" }).first().click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Title").fill("Integration phase 1");
    await d.getByLabel("Line 1 item").fill("Integration engineer (hours)");
    await d.getByLabel("Line 1 quantity").fill("400");
    await d.getByLabel("Line 1 unit cost").fill("90");
    await d.getByLabel("Line 1 unit price").fill("100");
    await expect(d.getByText(/below the 18% floor/)).toBeVisible();
    await d.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Waiting for executive margin approval.")).toBeVisible();
    const url = page.url();

    const pdf = await page.request.get(`${url.replace(/\/quotes\//, "/api/quotes/")}/pdf`);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

    await signIn(page, "exec");
    await page.goto(url);
    await page.getByRole("button", { name: "Approve margin" }).click();
    await expect(page.getByRole("button", { name: "Mark sent" })).toBeVisible();
  });

  test("bd sees restricted cost on a quote they don't own", async ({ page }) => {
    await signIn(page, "exec");
    await page.goto("/quotes");
    await expect(page.getByText("Q-2026-0142")).toBeVisible();
    await signIn(page, "bd");
    await page.goto("/quotes");
    // Marcus doesn't own Magnolia deals — the quote is invisible to him.
    await expect(page.getByText("Q-2026-0142")).toHaveCount(0);
  });
});
