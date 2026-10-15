import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";
import { MemoryStore } from "@/lib/data/memory-store";
import { buildSeed, seedIds } from "@/lib/data/seed";
import type { Store } from "@/lib/data/store";
import type { Account, Activity, Contact, Opportunity, User } from "@/lib/domain/types";
import {
  STALE_DEAL_DAYS,
  contactsWithoutEmail,
  dataQuality,
  incompleteOpportunities,
  overdueOpportunities,
  staleDeals,
  unownedAccounts,
} from "@/lib/services/data-quality";
import { asUser, NOW } from "./helpers";

const ids = seedIds();
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();
const dateIn = (n: number) => daysAgo(-n).slice(0, 10);
const names = new Map([["acc", "Acme"]]);

const opp = (id: string, o: Partial<Opportunity> = {}) =>
  ({
    id,
    name: id,
    account_id: "acc",
    stage: "qualify",
    value: 100,
    expected_close: dateIn(30),
    created_at: daysAgo(5),
    ...o,
  }) as Opportunity;
const user = (id: string, u: Partial<User> = {}) => ({ id, full_name: id, role: "bd", archived_at: null, ...u }) as User;
const account = (id: string, owner_id: string) =>
  ({ id, name: id, owner_id, city: null, country: "US", state_region: null }) as unknown as Account;

describe("data quality rules", () => {
  it("accounts without an active owner: missing, archived or pending", () => {
    const users = [user("ok"), user("gone", { archived_at: daysAgo(1) }), user("new", { role: null })];
    const rows = unownedAccounts([account("a1", "ok"), account("a2", "gone"), account("a3", "new"), account("a4", "nobody")], users);
    expect(rows.map((r) => [r.id, r.issue])).toEqual([
      ["a2", "Owner gone is deactivated"],
      ["a3", "Owner new is pending access"],
      ["a4", "No owner"],
    ]);
    expect(rows[0].href).toBe("/accounts/a2");
  });

  it("open opportunities past their expected close date", () => {
    const rows = overdueOpportunities(
      [
        opp("late", { expected_close: dateIn(-3) }),
        opp("later", { expected_close: dateIn(-10) }),
        opp("future"),
        opp("today", { expected_close: dateIn(0) }),
        opp("closed", { stage: "lost", expected_close: dateIn(-3) }),
        opp("undated", { expected_close: null }),
      ],
      names,
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["later", "late"]);
    expect(rows[1]).toMatchObject({ context: "Acme", href: "/opportunities/late" });
    expect(rows[1].issue).toMatch(/\(3 days\)/);
  });

  it("open opportunities missing a value or expected close", () => {
    const rows = incompleteOpportunities(
      [
        opp("ok"),
        opp("novalue", { value: 0 }),
        opp("noclose", { expected_close: null }),
        opp("both", { value: 0, expected_close: null }),
        opp("won", { stage: "won", value: 0 }),
      ],
      names,
    );
    expect(rows.map((r) => [r.id, r.issue])).toEqual([
      ["novalue", "Missing value"],
      ["noclose", "Missing expected close"],
      ["both", "Missing value and expected close"],
    ]);
  });

  it("contacts without an email", () => {
    const c = (id: string, email: string | null) => ({ id, first_name: "A", last_name: id, email, account_id: "acc" }) as Contact;
    expect(contactsWithoutEmail([c("x", "a@b.com"), c("y", null), c("z", "  ")], names).map((r) => r.id)).toEqual(["y", "z"]);
  });

  it(`stale deals: open with no timeline activity for more than ${STALE_DEAL_DAYS} days (configurable)`, () => {
    const act = (related_id: string, n: number) => ({ related_type: "opportunity", related_id, occurred_at: daysAgo(n) }) as Activity;
    const opps = [
      opp("quiet", { created_at: daysAgo(90) }),
      opp("busy", { created_at: daysAgo(90) }),
      opp("never", { created_at: daysAgo(40) }),
      opp("young", { created_at: daysAgo(5) }),
      opp("closed", { stage: "won", created_at: daysAgo(90) }),
    ];
    const acts = [act("quiet", 31), act("quiet", 45), act("busy", 40), act("busy", 3), act("closed", 80)];
    const rows = staleDeals(opps, acts, names, NOW);
    expect(rows.map((r) => r.id)).toEqual(["never", "quiet"]);
    expect(rows.find((r) => r.id === "quiet")!.issue).toBe("No activity for 31 days");
    expect(rows.find((r) => r.id === "never")!.issue).toBe("No activity since it was created 40 days ago");
    expect(staleDeals(opps, acts, names, NOW, 35).map((r) => r.id)).toEqual(["never"]);
    expect(
      staleDeals(opps, acts, names, NOW, 2)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["busy", "never", "quiet", "young"]);
  });
});

describe("dataQuality()", () => {
  it("reports every rule on the seed with links, plus the duplicates count", async () => {
    const exec = await asUser("exec");
    const r = await dataQuality(exec);
    expect(r.staleDays).toBe(STALE_DEAL_DAYS);
    expect(r.duplicates).toEqual({ accounts: 1, contacts: 1 });
    for (const rows of Object.values(r.rows)) for (const row of rows) expect(row.href).toMatch(/^\/(accounts|contacts|opportunities)\//);
    expect(r.rows.unowned_accounts).toEqual([]);
    // Deactivating an owner surfaces their accounts.
    await exec.store.update("users", ids.users.bd2, { archived_at: NOW.toISOString() });
    const after = await dataQuality(exec);
    const owned = exec.store.raw("accounts").filter((a) => a.owner_id === ids.users.bd2 && !a.archived_at);
    expect(after.rows.unowned_accounts.map((x) => x.id).sort()).toEqual(owned.map((a) => a.id).sort());
  });

  it("is leaders only", async () => {
    for (const role of ["bd1", "delivery", "recruiter"] as const) {
      await expect(dataQuality(await asUser(role))).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(dataQuality(await asUser("admin"))).resolves.toBeTruthy();
  });

  it("costs a fixed number of queries however many rows there are (no N+1)", async () => {
    const countCalls = async (extraOpps: number) => {
      const store = new MemoryStore(buildSeed(NOW));
      const exec = await asUser("exec", store);
      const base = (await store.list("opportunities"))[0];
      for (let i = 0; i < extraOpps; i++)
        await store.insert("opportunities", { ...base, id: undefined, name: `Bulk ${i}`, expected_close: null } as never);
      let calls = 0;
      const counting = new Proxy(store, {
        get(target, prop, receiver) {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === "function" && ["list", "get"].includes(String(prop))
            ? (...args: unknown[]) => {
                calls++;
                return (v as (...a: unknown[]) => unknown).apply(target, args);
              }
            : v;
        },
      }) as Store;
      const r = await dataQuality({ ...exec, store: counting });
      return { calls, incomplete: r.rows.incomplete_opportunities.length };
    };
    const small = await countCalls(0);
    const big = await countCalls(50);
    expect(big.incomplete).toBe(small.incomplete + 50);
    expect(big.calls).toBe(small.calls);
    expect(small.calls).toBeLessThanOrEqual(15);
  });
});
