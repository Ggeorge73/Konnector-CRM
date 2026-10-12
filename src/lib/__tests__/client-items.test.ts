import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { seedIds, sid } from "@/lib/data/seed";
import { findForbiddenKeys } from "@/lib/integration/contract";
import { inboundHandlers } from "@/lib/integration/handlers";
import { handleInbound } from "@/lib/integration/inbound";
import { mockKonnectHub } from "@/lib/integration/mock-konnect-hub";
import { sign } from "@/lib/integration/signing";
import { mockTransport } from "@/lib/integration/transport";
import { approveQuote, saveQuote, submitQuote } from "@/lib/services/capture";
import { draftFromQuote, draftItem, getClientItem, publishItem, reviseItem, runExpiryJob, withdrawItem } from "@/lib/services/client-items";
import { systemCtx } from "@/lib/services/system";
import { asUser, NOW, switchUser } from "./helpers";

const ids = seedIds();
const SECRET = "dev-only-shared-secret";
const who = { name: "Denise Walker", title: "CTO", email: "denise.walker@gta.example.gov" };

async function inbound(store: Parameters<typeof systemCtx>[0], payload: object) {
  const c = await systemCtx(store, NOW);
  const body = JSON.stringify(payload);
  return handleInbound(c, body, sign(body, SECRET, NOW.getTime()), SECRET, inboundHandlers);
}

beforeEach(() => mockKonnectHub.reset());

describe("publishing", () => {
  it("publishes an approved quote with client-facing data only (no cost, margin or notes)", async () => {
    const bd = await asUser("bd1");
    const q = await saveQuote(bd, ids.opp("gta-ess"), {
      title: "ESS phase 1",
      internal_notes: "We can drop to 15% if pushed",
      lines: [{ item: "Service desk implementation", qty: 1, unit_cost: 900000, unit_price: 1250000 }],
    });
    await expect(draftFromQuote(bd, q.id, {})).rejects.toBeInstanceOf(ValidationError); // not approved yet
    await submitQuote(bd, q.id);
    const draft = await draftFromQuote(bd, q.id, { summary: "Phase 1 implementation" });
    expect(draft.status).toBe("draft");
    expect(mockKonnectHub.received()).toHaveLength(0); // nothing leaves until Publish
    const pub = await publishItem(bd, draft.id, mockTransport);
    expect(pub.status).toBe("published");
    const sent = mockKonnectHub.received()[0];
    expect(sent.event).toBe("client_item.published");
    expect(findForbiddenKeys(sent.payload)).toEqual([]);
    const json = JSON.stringify(sent.payload);
    expect(json).not.toContain("900000");
    expect(json).not.toContain("drop to 15%");
    expect(json).toContain("1250000");
    expect((await bd.store.get("quotes", q.id))!.status).toBe("sent");
  });

  it("blocks below-floor quotes until an executive approves", async () => {
    const bd = await asUser("bd1");
    const q = await saveQuote(bd, ids.opp("gta-renew"), {
      title: "Thin renewal",
      lines: [{ item: "Support", qty: 12, unit_cost: 28000, unit_price: 29500 }],
    });
    await submitQuote(bd, q.id);
    await expect(draftFromQuote(bd, q.id, {})).rejects.toThrow(/approved/);
    const exec = await switchUser(bd, "exec");
    await approveQuote(exec, q.id, true);
    expect((await draftFromQuote(bd, q.id, {})).status).toBe("draft");
  });

  it("requires a Konnect Hub client and an owner/executive", async () => {
    const bd2 = await asUser("bd2");
    await expect(draftItem(bd2, { type: "survey", account_id: ids.account("magnolia"), title: "Survey" })).rejects.toThrow(
      /Konnect Hub client/,
    );
    const bd1 = await switchUser(bd2, "bd1");
    await expect(draftItem(bd1, { type: "survey", account_id: ids.account("atl"), title: "Survey" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("versions and withdraws", async () => {
    const bd = await asUser("bd1");
    const item = sid("ci:gta-renew"); // seeded v1, status viewed
    const v2 = await reviseItem(bd, item, { amount: 360000, summary: "Revised after QBR" });
    expect(v2.version).toBe(2);
    expect(v2.lineage_id).toBe(sid("ci:gta-renew"));
    await publishItem(bd, v2.id, mockTransport);
    expect((await bd.store.get("client_items", item))!.status).toBe("superseded");
    expect(mockKonnectHub.received()[0].payload).toMatchObject({ item: { version: 2, supersedes_version: 1 } });
    const w = await withdrawItem(bd, v2.id, "Pricing error", mockTransport);
    expect(w.status).toBe("withdrawn");
    expect(mockKonnectHub.received()[1].event).toBe("client_item.withdrawn");
    const { versions } = await getClientItem(bd, v2.id);
    expect(versions.map((v) => v.status)).toEqual(["withdrawn", "superseded"]);
  });
});

describe("client decisions from Konnect Hub", () => {
  it("quote accepted → quote accepted, opportunity Won, handoff sent automatically", async () => {
    const bd = await asUser("bd1");
    const q = await saveQuote(bd, ids.opp("gta-ess"), {
      title: "ESS",
      lines: [{ item: "Service desk", qty: 1, unit_cost: 1, unit_price: 2450000 }],
    });
    await submitQuote(bd, q.id);
    const item = await publishItem(bd, (await draftFromQuote(bd, q.id, {})).id, mockTransport);
    const r = await inbound(bd.store, {
      event: "client_item.decided",
      item_id: item.id,
      version: 1,
      decision: "accepted",
      decided_by: who,
      decided_at: NOW.toISOString(),
      ip: "203.0.113.9",
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ effects: ["quote_accepted", "opportunity_won", "handoff_sent"] });
    expect((await bd.store.get("quotes", q.id))!.status).toBe("accepted");
    expect((await bd.store.get("opportunities", ids.opp("gta-ess")))!.stage).toBe("won");
    const [h] = await bd.store.list("handoffs", { where: { opportunity_id: ids.opp("gta-ess") } });
    expect(h.status).toBe("acknowledged");
    const decided = (await bd.store.get("client_items", item.id))!;
    expect(decided).toMatchObject({ status: "accepted", decided_by_email: who.email, decision_ip: "203.0.113.9" });
    // Replays are idempotent.
    expect(
      (
        await inbound(bd.store, {
          event: "client_item.decided",
          item_id: item.id,
          version: 1,
          decision: "accepted",
          decided_by: who,
          decided_at: NOW.toISOString(),
        })
      ).body,
    ).toMatchObject({ idempotent_replay: true });
  });

  it("renewal accepted → renewal opportunity Won and project.extended sent", async () => {
    const bd = await asUser("bd1");
    const r = await inbound(bd.store, {
      event: "client_item.decided",
      item_id: sid("ci:gta-renew"),
      version: 1,
      decision: "accepted",
      decided_by: who,
      decided_at: NOW.toISOString(),
    });
    expect(r.body).toMatchObject({ effects: ["quote_accepted", "opportunity_won", "project_extended"] });
    expect((await bd.store.get("opportunities", ids.opp("gta-renew")))!.stage).toBe("won");
    expect(mockKonnectHub.received().find((x) => x.event === "project.extended")!.payload).toMatchObject({
      konnect_hub_project_id: "khp_gtacloud",
      additional_value: 380000,
    });
  });

  it("amendment accepted → project.extended with new end date", async () => {
    const exec = await asUser("exec");
    const draft = await draftItem(exec, {
      type: "contract_amendment",
      account_id: ids.account("atl"),
      konnect_hub_project_id: "khp_atl311",
      title: "311 phase 2 — extra integrations",
      amount: 150000,
      new_end_date: "2027-06-30",
      respond_by: "2026-10-30",
    });
    expect(draft.opportunity_id).toBeTruthy();
    await publishItem(exec, draft.id, mockTransport);
    const r = await inbound(exec.store, {
      event: "client_item.decided",
      item_id: draft.id,
      version: 1,
      decision: "accepted",
      decided_by: { name: "Jasmine Carter", email: "jasmine.carter@atl.example.gov" },
      decided_at: NOW.toISOString(),
    });
    expect(r.body).toMatchObject({ effects: ["opportunity_won", "project_extended"] });
    const ext = mockKonnectHub.received().find((x) => x.event === "project.extended")!;
    expect(ext.payload).toMatchObject({ konnect_hub_project_id: "khp_atl311", new_end_date: "2027-06-30", additional_value: 150000 });
    expect((await exec.store.get("opportunities", draft.opportunity_id!))!.stage).toBe("won");
  });

  it("changes requested → task for the owner; low survey → alert", async () => {
    const bd = await asUser("bd1");
    const r = await inbound(bd.store, {
      event: "client_item.decided",
      item_id: sid("ci:gta-renew"),
      version: 1,
      decision: "changes_requested",
      note: "Split phase 2",
      decided_by: who,
      decided_at: NOW.toISOString(),
    });
    expect(r.body).toMatchObject({ effects: ["task_created"] });
    const tasks = await bd.store.list("tasks", { where: { assignee_id: ids.users.bd1, related_id: sid("ci:gta-renew") } });
    expect(tasks[0].notes).toBe("Split phase 2");

    const bd2 = await switchUser(bd, "bd2");
    const survey = await draftItem(bd2, { type: "survey", account_id: ids.account("atl"), title: "Q4 survey" });
    await publishItem(bd2, survey.id, mockTransport);
    const s = await inbound(bd.store, {
      event: "survey.submitted",
      item_id: survey.id,
      version: 1,
      score: 4,
      comment: "Slow responses",
      submitted_by: { name: "Brian Holloway", email: "brian.holloway@atl.example.gov" },
      submitted_at: NOW.toISOString(),
    });
    expect(s.body).toMatchObject({ alert: true });
    expect((await bd.store.get("accounts", ids.account("atl")))!.survey_score).toBe(4);
    expect(
      (await bd.store.list("notifications", { where: { user_id: ids.users.bd2, kind: "alert" } })).some((n) => n.title.includes("4/10")),
    ).toBe(true);
  });

  it("rejects unsigned events and version mismatches", async () => {
    const bd = await asUser("bd1");
    const c = await systemCtx(bd.store, NOW);
    const body = JSON.stringify({ event: "client_item.viewed", item_id: sid("ci:gta-renew"), version: 1, viewed_at: NOW.toISOString() });
    expect((await handleInbound(c, body, null, SECRET, inboundHandlers)).status).toBe(401);
    expect(
      (await inbound(bd.store, { event: "client_item.viewed", item_id: sid("ci:gta-renew"), version: 7, viewed_at: NOW.toISOString() }))
        .status,
    ).toBe(422);
  });
});

describe("daily expiry job", () => {
  it("expires overdue items and nudges owners once per day", async () => {
    const bd = await asUser("bd1");
    const later = await systemCtx(bd.store, new Date(NOW.getTime() + 20 * 86_400_000));
    expect(await runExpiryJob(later)).toMatchObject({ expired: 1 });
    expect((await bd.store.get("client_items", sid("ci:gta-renew")))!.status).toBe("expired");
    const soon = await asUser("bd1");
    const nudgeDay = await systemCtx(soon.store, new Date(NOW.getTime() + 11 * 86_400_000));
    expect((await runExpiryJob(nudgeDay)).nudged).toBe(1);
    expect((await runExpiryJob(nudgeDay)).nudged).toBe(0);
  });
});
