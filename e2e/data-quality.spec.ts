import { expect, signIn, test } from "./fixtures";

/** KCRM-77 duplicates + merge, KCRM-78 data quality. Seed plants "Harborline Logistics, Inc." as a duplicate. */
test.describe("duplicates and data quality", () => {
  test("a leader merges the seeded duplicate accounts and the survivor keeps everything", async ({ page }) => {
    await signIn(page, "exec");
    await page.goto("/accounts");
    await page.getByRole("link", { name: "Duplicates (1)" }).click();
    await expect(page).toHaveURL(/\/duplicates\?tab=accounts/);
    await expect(page.getByRole("heading", { name: "Duplicates", level: 1 })).toBeVisible();

    const pair = page.getByRole("listitem", { name: "Harborline Logistics and Harborline Logistics, Inc." });
    await expect(pair.getByText(/Same name once suffixes and punctuation are ignored/)).toBeVisible();
    await expect(pair.getByLabel("Score 90")).toBeVisible();
    await pair.getByRole("button", { name: /^Merge / }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: "Keep Harborline Logistics", exact: true })).toBeChecked();
    // Take the website from the duplicate.
    await dialog.getByRole("radio", { name: /Website: use https:\/\/www\.harborline\.example\.com/ }).check();
    await dialog.getByRole("button", { name: "Merge accounts" }).click();

    await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Harborline Logistics", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: /Contacts/ }).click();
    await expect(page.getByText("Samuel Porter")).toBeVisible();
    await expect(page.getByText("Dana Whitaker")).toBeVisible();
    await page.getByRole("tab", { name: /Opportunities/ }).click();
    await expect(page.getByText("Yard Telematics Pilot")).toBeVisible();
    await page.getByRole("tab", { name: /Timeline/ }).click();
    await expect(page.getByText('Merged "Harborline Logistics, Inc." into this record')).toBeVisible();

    // The duplicate is archived, so the pair is gone; the contact pair (Sam / Samuel Porter) remains.
    await page.goto("/duplicates?tab=accounts");
    await expect(page.getByText("No likely duplicate accounts.", { exact: false })).toBeVisible();
    await page.getByRole("tab", { name: "Contacts (1)" }).click();
    await expect(page.getByRole("listitem", { name: "Sam Porter and Samuel Porter" })).toBeVisible();
  });

  test("not a duplicate hides a pair until it is restored", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/duplicates?tab=contacts");
    await page.getByRole("button", { name: /^Not a duplicate: / }).click();
    await expect(page.getByText("No likely duplicate contacts.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /^Restore / }).click();
    await expect(page.getByRole("button", { name: /^Merge / })).toBeVisible();
  });

  test("the data quality page renders and a row links to the record", async ({ page }) => {
    await signIn(page, "exec");
    await page.goto("/");
    await page.getByRole("link", { name: "Data quality" }).first().click();
    await expect(page).toHaveURL(/\/data-quality$/);
    await expect(page.getByRole("heading", { name: "Data quality", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Likely duplicates: 2" })).toBeVisible();

    await page.getByRole("tab", { name: /Past close date \(1\)/ }).click();
    await page.getByRole("grid").getByRole("link", { name: "Yard Telematics Pilot", exact: true }).click();
    await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Yard Telematics Pilot" })).toBeVisible();

    await page.goto("/data-quality?tab=contacts_without_email");
    await expect(page.getByRole("grid").getByRole("link", { name: "Dana Whitaker", exact: true })).toBeVisible();
  });

  test("bd cannot open data quality or duplicates", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/data-quality");
    await expect(page).toHaveURL(/\?denied=1/);
    await expect(page.getByText("isn't available for your role")).toBeVisible();
    await page.goto("/duplicates");
    await expect(page).toHaveURL(/\?denied=1/);
    await page.goto("/accounts");
    await expect(page.getByRole("link", { name: /^Duplicates/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Data quality" })).toHaveCount(0);
  });
});
