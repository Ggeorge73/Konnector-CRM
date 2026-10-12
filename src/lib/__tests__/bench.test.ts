import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";
import { seedIds, sid } from "@/lib/data/seed";
import { getConsultant, saveConsultant, staffingMatches, visibleConsultants, wantedSkillsFor } from "@/lib/services/bench";
import { asUser, switchUser } from "./helpers";

const ids = seedIds();
const james = sid("cons:James Whitaker");

describe("bench visibility", () => {
  it("bd cannot read the bench at all", async () => {
    const bd = await asUser("bd1");
    await expect(visibleConsultants(bd)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getConsultant(bd, james)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staffingMatches(bd, ids.opp("mag-core"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("delivery lead sees the bench with cost rates and margins redacted", async () => {
    const dl = await asUser("delivery");
    const list = await visibleConsultants(dl);
    expect(list).toHaveLength(12);
    expect(list.every((x) => x.rate_cost === null && x.margin_pct === null)).toBe(true);
    expect(list.every((x) => x.rate_bill > 0)).toBe(true);
    expect((await getConsultant(dl, james)).rate_cost).toBeNull();
  });

  it("recruiter and executives see cost rates and derived margin", async () => {
    const r = await asUser("recruiter");
    const j = await getConsultant(r, james);
    expect(j.rate_cost).toBe(88);
    expect(j.margin_pct).toBeCloseTo(41.3, 1);
    const exec = await switchUser(r, "exec");
    expect((await visibleConsultants(exec)).every((x) => x.rate_cost !== null)).toBe(true);
  });
});

describe("saveConsultant", () => {
  const input = {
    full_name: "Sam Okoro",
    title: "MuleSoft Architect",
    email: "sam@bench.konnectorllc.com",
    skills: ["MuleSoft", "APIs", "mulesoft"],
    certifications: ["MuleSoft Certified Architect"],
    rate_cost: 100,
    rate_bill: 190,
    availability_from: "2026-10-20",
    location: "Atlanta, GA",
    status: "available" as const,
  };

  it("is forbidden for delivery leads and bd", async () => {
    const dl = await asUser("delivery");
    await expect(saveConsultant(dl, input)).rejects.toBeInstanceOf(ForbiddenError);
    const bd = await switchUser(dl, "bd1");
    await expect(saveConsultant(bd, input)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("recruiter creates, dedupes skills, and rate changes are audited", async () => {
    const r = await asUser("recruiter");
    const row = await saveConsultant(r, input);
    expect(row.skills).toEqual(["MuleSoft", "APIs"]);
    await saveConsultant(r, { ...input, rate_bill: 200 }, row.id);
    const log = await r.store.list("audit_log", { where: { entity_id: row.id } });
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["consultant.created", "consultant.rate_changed"]));
    const change = log.find((l) => l.action === "consultant.rate_changed")!;
    expect(change.before).toEqual({ rate_bill: 190 });
    expect(change.after).toEqual({ rate_bill: 200 });
    // Timeline (visible to delivery leads) never carries cost numbers.
    const acts = await r.store.list("activities", { where: { related_id: row.id } });
    expect(acts.some((a) => a.subject === "Rates updated")).toBe(true);
    expect(acts.every((a) => !/100|190|200/.test(`${a.subject} ${a.body ?? ""}`))).toBe(true);
  });

  it("rejects invalid input", async () => {
    const r = await asUser("recruiter");
    await expect(saveConsultant(r, { ...input, skills: [] })).rejects.toThrow();
    await expect(saveConsultant(r, { ...input, rate_bill: 0 })).rejects.toThrow();
  });
});

describe("staffingMatches", () => {
  it("maps service lines to skills and adds explicit ones", () => {
    const w = wantedSkillsFor({ service_lines: ["systems_integration", "staffing"] }, ["Python"]);
    expect(w).toEqual(expect.arrayContaining(["mulesoft", "integration", "apis", "python"]));
  });

  it("ranks a MuleSoft engineer first for an integration deal, with reasons", async () => {
    const dl = await asUser("delivery");
    const res = await staffingMatches(dl, ids.opp("mag-core"));
    expect(res.matches[0].consultant.full_name).toBe("James Whitaker");
    expect(res.matches[0].reasons.some((r) => /MuleSoft/.test(r))).toBe(true);
    expect(res.matches[0].reasons.some((r) => /Certified/.test(r))).toBe(true);
    expect(res.matches[0].available_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.matches[0].consultant.rate_cost).toBeNull();
    expect(res.matches[0].matched_skills).toEqual(expect.arrayContaining(["MuleSoft", "Java", "APIs"]));
    // whole-word matching: "java" must not match "JavaScript"
    expect(res.matches.find((m) => m.consultant.full_name === "Derek Owens")!.matched_skills).not.toContain("JavaScript");
    // sorted descending, no inactive consultants
    const scores = res.matches.map((m) => m.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("explicit skills and availability shift the ranking", async () => {
    const exec = await asUser("exec");
    const res = await staffingMatches(exec, ids.opp("mag-core"), { skills: ["Databricks", "Python"], availableBy: "2026-10-13" });
    const mei = res.matches.findIndex((m) => m.consultant.full_name === "Mei Chen");
    expect(mei).toBeGreaterThanOrEqual(0);
    expect(res.needBy).toBe("2026-10-13");
    const tom = res.matches.find((m) => m.consultant.full_name === "Tom Becker")!;
    expect(tom.available_in_time).toBe(false);
    expect(res.matches[0].consultant.rate_cost).not.toBeNull();
  });
});
