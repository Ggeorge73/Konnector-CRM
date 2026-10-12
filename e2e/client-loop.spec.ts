import { expect, signIn, test } from "./fixtures";

test.describe("client commercial loop via Konnect Hub", () => {
  test("publish an approved quote, client views and accepts → Won + automatic handoff", async ({ page }) => {
    await signIn(page, "bd");
    // Enterprise Service Desk is at GTA, an existing Konnect Hub client.
    await page.goto("/opportunities?view=table");
    await page.getByRole("link", { name: "Enterprise Service Desk Modernisation" }).click();
    await page.getByRole("tab", { name: /Quotes/ }).click();
    await page.getByRole("button", { name: "New quote" }).first().click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Title").fill("ESS implementation");
    await d.getByLabel("Line 1 item").fill("Service desk implementation");
    await d.getByLabel("Line 1 quantity").fill("1");
    await d.getByLabel("Line 1 unit cost").fill("1600000");
    await d.getByLabel("Line 1 unit price").fill("2450000");
    await d.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("button", { name: "Submit" }).click();
    await page.getByRole("button", { name: "Publish to client" }).click();

    // Draft preview shows client-facing data only.
    await expect(page.getByText("Draft — nothing has left the CRM.")).toBeVisible();
    await expect(page.getByText("$1,600,000")).toHaveCount(0);
    await page.getByRole("button", { name: "Publish to client" }).click();
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Client opens it" }).click();
    await expect(page.getByText("Viewed", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText(/Jasmine Carter .* accepted on/)).toBeVisible();

    await page.goto("/opportunities?view=table");
    await page.getByRole("switch").or(page.getByLabel("Include closed")).first().check();
    await page.getByRole("link", { name: "Enterprise Service Desk Modernisation" }).click();
    await expect(page.getByText("Won", { exact: true }).first()).toBeVisible();
    await page.getByRole("tab", { name: "Handoff" }).click();
    await expect(page.getByText("Acknowledged")).toBeVisible();
  });

  test("renewal offer: client requests changes → owner gets a follow-up", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/client-items");
    await page.getByRole("link", { name: "Service desk support renewal FY27" }).click();
    await page.getByLabel("Client note").fill("Please split the optimisation reviews out");
    await page.getByRole("button", { name: "Request changes" }).click();
    await expect(page.getByText(/requested changes|Changes requested/).first()).toBeVisible();
    await page.goto("/my-work");
    await expect(page.getByText('Revise "Service desk support renewal FY27" — client requested changes')).toBeVisible();
  });

  test("survey with a low score alerts the account owner", async ({ page }) => {
    await signIn(page, "bd2");
    await page.goto("/client-items");
    await page.getByRole("button", { name: "New client item" }).click();
    const d = page.getByRole("dialog");
    await d.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "Satisfaction survey" }).click();
    await d.getByLabel("Title").fill("Q4 satisfaction survey");
    await d.getByRole("button", { name: "Create draft" }).click();
    await page.getByRole("button", { name: "Publish to client" }).click();
    await page.getByRole("slider", { name: "Survey score" }).focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
    await page.getByRole("button", { name: "Submit survey" }).click();
    await expect(page.getByText("3/10").first()).toBeVisible();
    await page.goto("/notifications");
    await expect(page.getByText(/Low satisfaction from City of Atlanta: 3\/10/)).toBeVisible();
  });
});
