import { expect, signIn, test } from "./fixtures";

test.describe("core CRM", () => {
  test("create an account, then log a note with an @mention", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/accounts");
    await page.getByRole("button", { name: "New account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Chatham County Government");
    await dialog.getByLabel("Sector").fill("County government");
    await dialog.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Chatham County Government" })).toBeVisible();

    await page.getByRole("tab", { name: /Timeline/ }).click();
    await page.getByLabel("Subject").fill("Intro call with county CIO");
    await page.getByLabel("Details").fill("Strong interest. @Adaeze Okafor can you join the follow-up?");
    await page.getByRole("button", { name: "Log note" }).click();
    await expect(page.getByText("Intro call with county CIO")).toBeVisible();
    await expect(page.getByText("@Adaeze Okafor").first()).toBeVisible();
  });

  test("filters accounts and saves a view", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/accounts");
    await page.getByLabel("Status").click();
    await page.getByRole("option", { name: "Active client" }).click();
    await expect(page.getByRole("link", { name: "City of Atlanta" })).toBeVisible();
    await expect(page.getByRole("link", { name: "City of Savannah" })).toHaveCount(0);
    await page.getByRole("button", { name: "Save view" }).click();
    await page.getByLabel("View name").fill("Clients only");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "Clients only" })).toBeVisible();
  });

  test("bd cannot open an account they don't own", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/accounts");
    await expect(page.getByRole("link", { name: "Peachtree Health Partners" })).toHaveCount(0);
  });

  test("adds a contact from the account page", async ({ page }) => {
    await signIn(page, "bd2");
    await page.goto("/accounts");
    await page.getByRole("link", { name: "Magnolia Community Bank" }).click();
    await page.getByRole("tab", { name: /Contacts/ }).click();
    await page.getByRole("button", { name: "Add contact" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("First name").fill("Nadia");
    await d.getByLabel("Last name").fill("Ford");
    await d.getByLabel("Email").fill("nadia.ford@magnolia.example.com");
    await d.getByRole("button", { name: "Add contact" }).click();
    await expect(page.getByRole("link", { name: "Nadia Ford" })).toBeVisible();
  });

  test("My Work: add and complete a follow-up", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/my-work");
    await page.getByRole("button", { name: "New follow-up" }).click();
    await page.getByLabel("What needs to happen?").fill("Draft DOR clarification answers");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    const box = page.getByRole("checkbox", { name: 'Mark "Draft DOR clarification answers" done' });
    await expect(box).toBeVisible();
    await box.click();
    await expect(page.getByRole("checkbox", { name: 'Mark "Draft DOR clarification answers" open' })).toBeChecked();
  });

  test("command palette jumps to a record", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard shortcut is desktop-only");
    await signIn(page, "admin");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Search" }).fill("Jasmine");
    await page.getByRole("option", { name: /Jasmine Carter/ }).click();
    await expect(page.getByRole("heading", { name: "Jasmine Carter" })).toBeVisible();
  });

  test("admin sees the audit log after an ownership change", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/accounts");
    await page.getByRole("link", { name: "City of Savannah" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByLabel("Owner").click();
    await page.getByRole("option", { name: "Marcus Bell" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await page.goto("/audit");
    await expect(page.getByText("account.owner_changed").first()).toBeVisible();
  });
});
