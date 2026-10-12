import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/data/memory-store";
import { buildSeed, sid } from "@/lib/data/seed";
import { NOW } from "./helpers";

describe("MemoryStore + seed", () => {
  it("seeds every module with linked rows", async () => {
    const s = new MemoryStore(buildSeed(NOW));
    const opps = await s.list("opportunities");
    const accounts = new Set((await s.list("accounts")).map((a) => a.id));
    expect(opps.length).toBeGreaterThan(15);
    expect(opps.every((o) => accounts.has(o.account_id))).toBe(true);
    expect((await s.list("users")).map((u) => u.role).sort()).toEqual(["admin", "bd", "bd", "delivery_lead", "executive", "recruiter"]);
    expect(await s.list("consultants")).toHaveLength(12);
  });

  it("filters, orders, archives and isolates copies", async () => {
    const s = new MemoryStore(buildSeed(NOW));
    const won = await s.list("opportunities", { where: { stage: ["won"] } });
    expect(won.every((o) => o.stage === "won")).toBe(true);
    const sorted = await s.list("accounts", { orderBy: { column: "name" } });
    expect(sorted[0].name <= sorted[1].name).toBe(true);
    const id = sid("acct:harbor");
    await s.update("accounts", id, { archived_at: NOW.toISOString() });
    expect((await s.list("accounts")).some((a) => a.id === id)).toBe(false);
    expect((await s.list("accounts", { includeArchived: true })).some((a) => a.id === id)).toBe(true);
    const a = (await s.get("accounts", sid("acct:gta")))!;
    a.name = "mutated";
    expect((await s.get("accounts", sid("acct:gta")))!.name).toBe("Georgia Technology Authority");
  });

  it("produces stable ids", () => {
    expect(sid("acct:gta")).toBe(sid("acct:gta"));
    expect(sid("acct:gta")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
