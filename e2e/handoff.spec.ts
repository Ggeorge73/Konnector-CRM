import { expect, signIn, test } from "./fixtures";

test("delivery lead hands a won deal off to Konnect Hub, then health flows back", async ({ page, request }) => {
  await signIn(page, "delivery");
  await page.goto("/opportunities?view=table&open=false");
  await page.getByRole("switch", { name: /Include closed/ }).or(page.getByLabel("Include closed")).first().check();
  await page.getByRole("link", { name: "EHR Integration Hub" }).click();
  await page.getByRole("button", { name: "Hand off to Konnect Hub" }).click();
  await page.getByRole("button", { name: "Start handoff" }).click();
  const d = page.getByRole("dialog", { name: /Hand off to Konnect Hub/ });
  await d.getByLabel("Contract number").fill("PHP-2026-044");
  await d.getByLabel("End date").fill("2027-10-31");
  await d.getByRole("button", { name: "Next" }).click();
  await d.getByRole("checkbox", { name: /Hannah Brooks/ }).check();
  await d.getByRole("button", { name: "Next" }).click();
  await d.getByLabel("Scope summary").fill("Integrate the EHR with the regional data platform.");
  await d.getByLabel("Acceptance criterion 1").fill("FHIR interfaces live at 3 facilities");
  await d.getByRole("button", { name: "Next" }).click();
  await d.getByRole("button", { name: "Send handoff" }).click();
  await expect(page.getByText("Acknowledged")).toBeVisible();
  const project = (await page.getByText(/^khp_/).first().textContent())!.trim();

  // Konnect Hub (mock) reports health back through the signed inbound webhook.
  const r = await request.post("/api/mock-konnect-hub/simulate", {
    data: { event: "project.health_updated", konnect_hub_project_id: project, health_schedule: "green", health_budget: "amber", health_acceptance: "green", percent_complete: 12, status: "in_progress", updated_at: new Date().toISOString() },
  });
  expect(r.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("12%")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open in Konnect Hub/ }).first()).toBeVisible();
});
