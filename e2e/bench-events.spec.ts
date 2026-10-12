import { expect, signIn, test } from "./fixtures";

test.describe("bench & BD events", () => {
  test("recruiter adds a consultant to the bench", async ({ page }) => {
    await signIn(page, "recruiter");
    await page.goto("/bench");
    await expect(page.getByRole("link", { name: "James Whitaker" })).toBeVisible();
    await page.getByRole("button", { name: "New consultant" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Full name").fill("Sam Okoro");
    await d.getByLabel("Title").fill("MuleSoft Architect");
    await d.getByLabel("Skills").fill("MuleSoft, APIs, Java");
    await d.getByLabel("Certifications").fill("MuleSoft Certified Architect");
    await d.getByLabel("Bill rate (USD/hr)").fill("190");
    await d.getByLabel("Cost rate (USD/hr)").fill("110");
    await d.getByRole("button", { name: "Add consultant" }).click();
    await expect(page.getByRole("heading", { name: "Sam Okoro" })).toBeVisible();
    await expect(page.getByText("$110").first()).toBeVisible();
    await expect(page.getByText("Added to the bench", { exact: true })).toBeVisible();
  });

  test("delivery lead sees the bench with cost rates restricted", async ({ page }) => {
    await signIn(page, "delivery");
    await page.goto("/bench");
    await expect(page.getByRole("link", { name: "James Whitaker" })).toBeVisible();
    await expect(page.getByLabel("Restricted").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "New consultant" })).toHaveCount(0);
    await page.getByRole("link", { name: "James Whitaker" }).click();
    await expect(page.getByRole("heading", { name: "James Whitaker" })).toBeVisible();
    await expect(page.getByLabel("Restricted").first()).toBeVisible();
    await expect(page.getByText("$88")).toHaveCount(0);
  });

  test("bd is redirected away from the bench", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/bench");
    await expect(page).toHaveURL(/denied=1/);
  });

  test("bd captures a lead at an event and sees the follow-up in My Work", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/events");
    await page.getByRole("link", { name: "GDOT Small Business Procurement Fair" }).click();
    await expect(page.getByRole("heading", { name: "GDOT Small Business Procurement Fair" })).toBeVisible();
    await page.getByRole("button", { name: "Capture lead" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("New organisation").check();
    await d.getByLabel("Organisation name").fill("Henry County Schools");
    await d.getByLabel("First name").fill("Dana");
    await d.getByLabel("Last name").fill("Price");
    await d.getByLabel("Job title").fill("CIO");
    await d.getByLabel("Email").fill("dana.price@henry.example.org");
    await d.getByLabel("Interest").fill("Student information system integration");
    await d.getByRole("button", { name: "Capture lead" }).click();
    await expect(page.getByRole("list", { name: "Captured leads" }).getByRole("link", { name: "Dana Price" })).toBeVisible();
    await expect(page.getByText(/Follow-up due/).first()).toBeVisible();

    await page.goto("/my-work");
    await expect(page.getByText("Follow up with Dana Price (met at GDOT Small Business Procurement Fair)")).toBeVisible();
  });
});
