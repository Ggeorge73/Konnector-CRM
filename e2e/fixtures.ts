import { expect, test as base, type Page } from "@playwright/test";

export const USERS = {
  admin: "Olugbenga George",
  exec: "Adaeze Okafor",
  bd: "Marcus Bell",
  bd2: "Priya Raman",
  delivery: "Lara Mitchell",
  recruiter: "Tiara Johnson",
} as const;

export async function signIn(page: Page, who: keyof typeof USERS) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(USERS[who]) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Fails the test on any uncaught page error or console error. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page, request }, use) => {
      await request.post("/api/dev/reset");
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
      });
      await use(errors);
      expect(errors, errors.join("\n")).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
