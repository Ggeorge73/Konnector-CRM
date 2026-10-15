import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";
import { seedIds } from "@/lib/data/seed";
import {
  bulkUpdateAccounts,
  createAccount,
  createTask,
  getAccount,
  logActivity,
  search,
  setTaskStatus,
  timelineFor,
  toggleReaction,
  updateAccount,
  visibleAccounts,
  visibleOpportunities,
} from "@/lib/services/core";
import { parseCsvTable } from "@/lib/import/csv";
import { importAccountsCsv } from "@/lib/services/imports";
import { asUser, switchUser } from "./helpers";

const ids = seedIds();

describe("scoping", () => {
  it("bd sees only owned/shared deals and their accounts", async () => {
    const bd = await asUser("bd1");
    const opps = await visibleOpportunities(bd);
    expect(opps.length).toBeGreaterThan(0);
    expect(opps.every((o) => o.owner_id === bd.user.id || o.shared_with.includes(bd.user.id))).toBe(true);
    const accounts = await visibleAccounts(bd);
    expect(accounts.some((a) => a.id === ids.account("peachtree"))).toBe(false);
    await expect(getAccount(bd, ids.account("peachtree"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("leaders and delivery leads see every account", async () => {
    const exec = await asUser("exec");
    const delivery = await switchUser(exec, "delivery");
    const total = (await exec.store.list("accounts")).length;
    expect((await visibleAccounts(exec)).length).toBe(total);
    expect((await visibleAccounts(delivery)).length).toBe(total);
  });

  it("recruiters only see staffing deals", async () => {
    const r = await asUser("recruiter");
    const opps = await visibleOpportunities(r);
    expect(opps.length).toBeGreaterThan(0);
    expect(opps.every((o) => o.kind === "staffing_placement")).toBe(true);
  });

  it("search respects scoping", async () => {
    const bd = await asUser("bd1");
    expect((await search(bd, "Peachtree")).length).toBe(0);
    const exec = await switchUser(bd, "exec");
    expect((await search(exec, "Peachtree")).some((h) => h.kind === "account")).toBe(true);
  });
});

describe("accounts", () => {
  it("validates, creates and audits ownership changes", async () => {
    const bd = await asUser("bd1");
    await expect(
      createAccount(bd, { name: "x", type: "private", sector: "", country: "US", tier: "B", status: "prospect" }),
    ).rejects.toThrow();
    const a = await createAccount(bd, {
      name: "Okefenokee Water Authority",
      type: "government_local",
      sector: "Utilities",
      country: "us",
      tier: "C",
      status: "prospect",
    });
    expect(a.owner_id).toBe(bd.user.id);
    expect(a.country).toBe("US");
    await expect(updateAccount(bd, a.id, { owner_id: ids.users.bd2 })).rejects.toBeInstanceOf(ForbiddenError);
    const exec = await switchUser(bd, "exec");
    await updateAccount(exec, a.id, { owner_id: ids.users.bd2 });
    const audit = await exec.store.list("audit_log", { where: { entity_id: a.id } });
    expect(audit.map((x) => x.action)).toContain("account.owner_changed");
  });

  it("bulk updates only what the actor may change", async () => {
    const exec = await asUser("exec");
    const r = await bulkUpdateAccounts(exec, [ids.account("dor"), ids.account("gdot")], { tier: "A" });
    expect(r.updated).toBe(2);
    expect((await exec.store.get("accounts", ids.account("gdot")))!.tier).toBe("A");
    await bulkUpdateAccounts(exec, [ids.account("harbor")], { archive: true });
    expect((await visibleAccounts(exec)).some((a) => a.id === ids.account("harbor"))).toBe(false);
  });

  it("imports CSV with per-row errors", async () => {
    expect(parseCsvTable('name,city\n"Acme, Inc",Atlanta\r\n').rows).toEqual([{ name: "Acme, Inc", city: "Atlanta" }]);
    const bd = await asUser("bd2");
    const r = await importAccountsCsv(
      bd,
      "name,type,sector,country,tier,status\nAlbany Utilities,government_local,Utilities,US,C,prospect\nBad Row,nope,X,US,C,prospect\n",
    );
    expect(r.created).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].row).toBe(3);
  });
});

describe("timeline, mentions, tasks", () => {
  it("logs activity, notifies mentioned users and toggles reactions", async () => {
    const bd = await asUser("bd1");
    const act = await logActivity(bd, {
      type: "note",
      subject: "Pricing",
      body: "@Adaeze Okafor please review",
      related_type: "opportunity",
      related_id: ids.opp("dor-mvs"),
      account_id: ids.account("dor"),
    });
    expect(act.mentions).toEqual([ids.users.exec]);
    const notes = await bd.store.list("notifications", { where: { user_id: ids.users.exec, kind: "mention" } });
    expect(notes.some((n) => n.title.includes("Pricing"))).toBe(true);
    await toggleReaction(bd, act.id, "👍");
    expect((await bd.store.get("activities", act.id))!.reactions["👍"]).toEqual([bd.user.id]);
    await toggleReaction(bd, act.id, "👍");
    expect((await bd.store.get("activities", act.id))!.reactions["👍"]).toEqual([]);
  });

  it("account timeline hides activity on deals the viewer can't see", async () => {
    const exec = await asUser("exec");
    const execView = await timelineFor(exec, "account", ids.account("dor"));
    const bd2 = await switchUser(exec, "bd2");
    // Priya is shared on DOR MVS (visible) and owns DOR tax (visible); nothing hidden here…
    expect((await timelineFor(bd2, "account", ids.account("dor"))).length).toBe(execView.length);
    // …but Marcus can't see Peachtree at all.
    const bd1 = await switchUser(exec, "bd1");
    await expect(getAccount(bd1, ids.account("peachtree"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("creates, assigns and completes follow-ups with permission checks", async () => {
    const bd = await asUser("bd1");
    const t = await createTask(bd, { title: "Send capability statement", assignee_id: ids.users.bd2, priority: "high" });
    expect((await bd.store.list("notifications", { where: { user_id: ids.users.bd2, kind: "assignment" } })).length).toBe(1);
    const recruiter = await switchUser(bd, "recruiter");
    await expect(setTaskStatus(recruiter, t.id, "done")).rejects.toBeInstanceOf(ForbiddenError);
    const bd2 = await switchUser(bd, "bd2");
    expect((await setTaskStatus(bd2, t.id, "done")).status).toBe("done");
  });
});
