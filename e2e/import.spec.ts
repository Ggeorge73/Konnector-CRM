import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";

async function upload(page: Page, type: "Contacts" | "Pipeline" | "Accounts", name: string, csv: string) {
  await page.goto("/import");
  await page.getByRole("button", { name: type, exact: true }).click();
  await page.getByLabel("CSV file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(name)).toBeVisible();
}

test.describe("import", () => {
  test("contacts: dry run, import, visible in Contacts, then undo", async ({ page }) => {
    await signIn(page, "bd");
    const csv = [
      "First name,Last name,Email,Company,Buying role,Unit cost",
      "Imani,Okoro,imani.okoro@dor.georgia.gov,Georgia Department of Revenue,Champion,120",
      '"Bryce","Lyle, Jr",bryce@example.org,Georgia Technology Authority,,',
      "Dup,Row,IMANI.OKORO@dor.georgia.gov,Georgia Department of Revenue,,",
    ].join("\r\n");
    await upload(page, "Contacts", "bd-contacts.csv", csv);
    await expect(page.getByText(/Ignored 1 column that looks like restricted/)).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Email" })).toContainText("Email");

    await page.getByRole("button", { name: "Preview (dry run)" }).click();
    const grid = page.getByRole("region", { name: "Dry run preview" });
    await expect(grid).toBeVisible();
    await expect(page.getByText("2 to create")).toBeVisible();
    await expect(page.getByText("1 to skip")).toBeVisible();
    await expect(grid.getByText("Same email as row 2")).toBeVisible();

    // Nothing written by the dry run.
    await page.goto("/contacts");
    await expect(page.getByRole("link", { name: "Imani Okoro" })).toHaveCount(0);

    await upload(page, "Contacts", "bd-contacts.csv", csv);
    await page.getByRole("button", { name: "Preview (dry run)" }).click();
    await page.getByRole("button", { name: "Import 2 rows" }).click();
    await expect(page.getByText(/Imported 2 records from bd-contacts.csv · 1 skipped/)).toBeVisible();

    await page.getByRole("link", { name: "View contacts" }).click();
    await expect(page.getByRole("link", { name: "Imani Okoro" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bryce Lyle, Jr" })).toBeVisible();

    await page.goto("/import");
    const recent = page.getByRole("region", { name: "Recent imports" });
    await expect(recent.getByText("bd-contacts.csv")).toBeVisible();
    await recent.getByRole("button", { name: "Undo import bd-contacts.csv" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Undo import" }).click();
    await expect(recent.getByText("Undone")).toBeVisible();
    await page.goto("/contacts");
    await expect(page.getByRole("link", { name: "Imani Okoro" })).toHaveCount(0);
  });

  test("pipeline: stage mapping and stage history land on the timeline", async ({ page }) => {
    await signIn(page, "exec");
    const csv = [
      "Deal name,Account,Stage,Amount,Owner,Kind,Expected close,Stage history,Gross margin",
      "Imported Records Platform,Georgia Department of Revenue,Proposal Sent,$420k,marcus@konnectorllc.com,Private,2026-12-15,2026-03-01 Qualify; 2026-05-10 Proposal,18%",
      "Imported Lost Deal,Georgia Department of Revenue,Closed Lost,50000,nobody@elsewhere.com,Private,,,",
    ].join("\n");
    await upload(page, "Pipeline", "pipeline.csv", csv);
    await page.getByRole("button", { name: "Preview (dry run)" }).click();
    await expect(page.getByText("2 to create")).toBeVisible();
    await expect(page.getByText(/1 owner email didn't match a teammate/)).toBeVisible();
    await expect(page.getByRole("combobox", { name: /"Proposal Sent"/ })).toContainText("Submitted");
    await page.getByRole("button", { name: "Import 2 rows" }).click();
    await expect(page.getByText(/Imported 2 records from pipeline.csv/)).toBeVisible();

    await page.goto("/opportunities?view=table");
    await page.getByRole("link", { name: "Imported Records Platform" }).click();
    await page.getByRole("tab", { name: /Timeline/ }).click();
    await expect(page.getByText("Stage moved Qualify → Proposal")).toBeVisible();
    await expect(page.getByText("Stage: Qualify (imported history)")).toBeVisible();

    await page.goto("/opportunities?view=table");
    await page.getByRole("link", { name: "Imported Lost Deal" }).click();
    await expect(page.getByText("Lost: Imported")).toBeVisible();
  });

  test("accounts page links to the import", async ({ page }) => {
    await signIn(page, "bd");
    await page.goto("/accounts");
    await page.getByRole("link", { name: "Import CSV" }).click();
    await expect(page).toHaveURL(/\/import\?type=accounts/);
    await expect(page.getByRole("button", { name: "Accounts", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});
