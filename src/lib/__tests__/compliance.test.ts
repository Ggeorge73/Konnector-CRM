import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ForbiddenError } from "@/lib/auth/errors";
import { DEFAULT_SETTINGS } from "@/lib/data/seed";
import {
  runComplianceReminders,
  saveRegistration,
  saveVetting,
  updateSettings,
  visibleVetting,
  type VettingInputT,
} from "@/lib/services/capture";
import { bidDeadlines, parseMonth, registrationsData, registrationStatus, vettingData } from "@/lib/services/compliance";
import { createAccount, visibleOpportunities } from "@/lib/services/core";
import { orgSettings } from "@/lib/services/pulse";
import { asUser, NOW, switchUser } from "./helpers";

const settingsInput = () => structuredClone(DEFAULT_SETTINGS);

describe("registrations", () => {
  it("classifies expiry: expired / expiring ≤30d / current / no expiry", () => {
    expect(registrationStatus("2026-10-11", NOW)).toBe("expired");
    expect(registrationStatus("2026-10-12", NOW)).toBe("expiring");
    expect(registrationStatus("2026-11-11", NOW)).toBe("expiring");
    expect(registrationStatus("2026-11-12", NOW)).toBe("current");
    expect(registrationStatus(null, NOW)).toBe("no_expiry");
  });

  it("summarises the seeded registrations, expired first", async () => {
    const bd = await asUser("bd1");
    const d = await registrationsData(bd);
    expect(d.canManage).toBe(false);
    expect(d.counts).toEqual({ current: 5, expiring: 1, expired: 1 });
    expect(d.rows[0].status).toBe("expired");
    expect(d.rows[1].status).toBe("expiring");
  });

  it("bd cannot create or edit a registration; executives can and renewals are audited", async () => {
    const bd = await asUser("bd1");
    const input = { kind: "certification" as const, name: "SBE certification", expires_on: "2027-06-30" };
    await expect(saveRegistration(bd, input)).rejects.toBeInstanceOf(ForbiddenError);
    const [cyber] = (await bd.store.list("registrations")).filter((r) => r.name.startsWith("Cyber"));
    await expect(saveRegistration(bd, { ...input, name: cyber.name }, cyber.id)).rejects.toBeInstanceOf(ForbiddenError);

    const exec = await switchUser(bd, "exec");
    expect((await registrationsData(exec)).canManage).toBe(true);
    const created = await saveRegistration(exec, input);
    expect(created).toMatchObject({ name: "SBE certification", expires_on: "2027-06-30", identifier: null });
    const renewed = await saveRegistration(exec, { kind: cyber.kind, name: cyber.name, expires_on: "2027-10-09" }, cyber.id);
    expect(registrationStatus(renewed.expires_on, NOW)).toBe("current");
    const log = await exec.store.list("audit_log", { where: { entity_id: cyber.id } });
    expect(log.some((l) => l.action === "registration.renewed")).toBe(true);
  });

  it("rejects bad dates", async () => {
    const exec = await asUser("exec");
    await expect(saveRegistration(exec, { kind: "insurance", name: "Auto", expires_on: "next year" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("partner vetting", () => {
  const input = (account_id: string): VettingInputT => ({
    account_id,
    sanctions_screen: "clear",
    pep_screen: "clear",
    beneficial_ownership: "Founder 100%",
    anti_corruption_attested: true,
    references_checked: true,
    risk_rating: "low",
    review_due: "2027-10-01",
    notes: null,
  });

  it("bd gets nothing from visibleVetting or vettingData and cannot save", async () => {
    const bd = await asUser("bd1");
    expect(await visibleVetting(bd)).toEqual([]);
    expect(await vettingData(bd)).toEqual([]);
    const [any] = await bd.store.list("partner_vetting");
    await expect(saveVetting(bd, input(any.account_id))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveVetting(bd, input(any.account_id), any.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("executives see every partner/OEM account, with not-vetted ones first, and can start vetting", async () => {
    const exec = await asUser("exec");
    const before = await vettingData(exec);
    expect(before.length).toBe(3);
    expect(before.every((r) => r.vetting)).toBe(true);
    expect(before.every((r) => ["partner_subcontractor", "oem_vendor"].includes(r.account.type))).toBe(true);

    const acct = await createAccount(exec, {
      name: "Delta Fibre Partners",
      type: "partner_subcontractor",
      sector: "Telecoms",
      country: "US",
      tier: "B",
      status: "partner",
    });
    const mid = await vettingData(exec);
    expect(mid[0]).toMatchObject({ account: { id: acct.id }, vetting: null });

    const row = await saveVetting(exec, input(acct.id));
    expect(row.reviewer_id).toBe(exec.user.id);
    const after = await vettingData(exec);
    expect(after.find((r) => r.account.id === acct.id)?.vetting?.risk_rating).toBe("low");
    expect((await exec.store.list("audit_log", { where: { entity_id: row.id } }))[0]?.action).toBe("vetting.created");
  });
});

describe("settings", () => {
  it("only admins can change settings", async () => {
    const bd = await asUser("bd1");
    await expect(updateSettings(bd, settingsInput())).rejects.toBeInstanceOf(ForbiddenError);
    const exec = await switchUser(bd, "exec");
    await expect(updateSettings(exec, settingsInput())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("weights must add up to 100", async () => {
    const admin = await asUser("admin");
    const bad = settingsInput();
    bad.bid_weights.strategic_fit += 5;
    await expect(updateSettings(admin, bad)).rejects.toThrow(/add up to 100/);
    const good = settingsInput();
    good.bid_weights.strategic_fit += 5;
    good.bid_weights.risk -= 5;
    good.margin_floor_pct = 22;
    await updateSettings(admin, good);
    const saved = await orgSettings(admin);
    expect(saved.margin_floor_pct).toBe(22);
    expect(saved.bid_weights.risk).toBe(5);
    expect((await admin.store.list("audit_log")).some((l) => l.action === "settings.updated")).toBe(true);
  });
});

describe("compliance reminders", () => {
  it("are idempotent per day and fire again the next day", async () => {
    const admin = await asUser("admin");
    const first = await runComplianceReminders(admin);
    expect(first.sent).toBeGreaterThan(0);
    expect((await runComplianceReminders(admin)).sent).toBe(0);
    const notes = await admin.store.list("notifications", { where: { user_id: admin.user.id } });
    expect(notes.some((x) => /MBE certification expires in 12 days/.test(x.title))).toBe(true);
    expect(notes.some((x) => /Vetting review overdue: Ritter/.test(x.title))).toBe(true);

    const tomorrow = { ...admin, now: new Date(NOW.getTime() + 86_400_000) };
    expect((await runComplianceReminders(tomorrow)).sent).toBeGreaterThan(0);
  });
});

describe("bid calendar", () => {
  it("lists questions/proposal deadlines for open public bids the viewer can see", async () => {
    const exec = await asUser("exec");
    const all = await bidDeadlines(exec);
    expect(all.length).toBeGreaterThan(0);
    const opps = new Map((await visibleOpportunities(exec)).map((o) => [o.id, o]));
    for (const e of all) {
      const o = opps.get(e.opportunity_id)!;
      expect(o.kind).toBe("public_bid");
      expect(["won", "lost", "no_bid"]).not.toContain(o.stage);
      expect(o[e.kind]?.slice(0, 10)).toBe(e.date);
    }
    expect([...all].sort((a, b) => a.date.localeCompare(b.date))).toEqual(all);

    const bd = await switchUser(exec, "bd1");
    const mine = await bidDeadlines(bd);
    expect(mine.length).toBeLessThan(all.length);
    const bdOpps = new Set((await visibleOpportunities(bd)).map((o) => o.id));
    expect(mine.every((e) => bdOpps.has(e.opportunity_id))).toBe(true);
  });

  it("parses ?month=YYYY-MM and falls back to the current month", () => {
    expect(parseMonth("2027-02", NOW)).toEqual({ year: 2027, month: 1 });
    expect(parseMonth("2027-13", NOW)).toEqual({ year: 2026, month: 9 });
    expect(parseMonth(undefined, NOW)).toEqual({ year: 2026, month: 9 });
  });
});
