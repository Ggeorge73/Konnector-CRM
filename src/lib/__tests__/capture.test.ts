import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { seedIds } from "@/lib/data/seed";
import { gateFor } from "@/lib/domain/stages";
import { needsMarginApproval, quoteTotals } from "@/lib/domain/quote";
import {
  approveQuote,
  bidDecisionsFor,
  createOpportunity,
  decideBid,
  getOpportunity,
  getQuote,
  moveStage,
  saveQuote,
  setQuoteStatus,
  submitBidDecision,
  submitQuote,
  updateOpportunity,
  visibleQuotes,
} from "@/lib/services/capture";
import { asUser, switchUser } from "./helpers";

const ids = seedIds();
const fives = {
  strategic_fit: 5,
  customer_relationship: 4,
  competitive_position: 4,
  capability: 4,
  staffing_availability: 4,
  margin: 4,
  risk: 4,
};

describe("stage gates", () => {
  it("requires an approved scorecard for public bids to pass Bid / No-Bid", () => {
    const o = { stage: "bid_no_bid" as const, kind: "public_bid" as const, proposal_due: "2026-11-01" };
    expect(gateFor(o, "proposal", null).map((g) => g.kind)).toContain("bid_decision");
    expect(gateFor(o, "proposal", { status: "approved", verdict: "bid" } as never)).toEqual([]);
    expect(gateFor(o, "proposal", { status: "approved", verdict: "no_bid" } as never).map((g) => g.kind)).toContain("bid_decision");
    expect(gateFor({ ...o, kind: "private_deal" }, "proposal", null)).toEqual([]);
    expect(gateFor(o, "lost", null).map((g) => g.kind)).toEqual(["bid_decision", "lost_reason"]);
    expect(gateFor({ ...o, stage: "capture" }, "no_bid", null).map((g) => g.kind)).toEqual(["no_bid_reason"]);
  });

  it("enforces gates server-side and audits stage changes", async () => {
    const bd = await asUser("bd1");
    await expect(moveStage(bd, ids.opp("dor-mvs"), { to: "proposal" })).rejects.toBeInstanceOf(ValidationError);
    await expect(moveStage(bd, ids.opp("gta-ess"), { to: "lost" })).rejects.toThrow(/lost reason/i);
    const lost = await moveStage(bd, ids.opp("gta-ess"), { to: "lost", lost_reason: "Price — incumbent undercut by 18%" });
    expect(lost.stage).toBe("lost");
    expect(lost.probability).toBe(0);
    const audit = await bd.store.list("audit_log", { where: { entity_id: ids.opp("gta-ess") } });
    expect(audit.some((a) => a.action === "opportunity.stage_changed")).toBe(true);
    await expect(moveStage(bd, ids.opp("gta-ess"), { to: "proposal" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("bd can't move or edit someone else's deal", async () => {
    const bd = await asUser("bd1");
    await expect(getOpportunity(bd, ids.opp("peach-ehr"))).rejects.toBeInstanceOf(ForbiddenError);
    const priya = await switchUser(bd, "bd2");
    // Priya is shared on DOR MVS, so she can edit it…
    await updateOpportunity(priya, ids.opp("dor-mvs"), { next_step: "Price Northwind option" });
    // …but only executives can reassign it.
    await expect(updateOpportunity(priya, ids.opp("dor-mvs"), { owner_id: ids.users.bd2 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Bid / No-Bid", () => {
  it("scores, routes to executives, and unlocks the gate on approval", async () => {
    const bd = await asUser("bd1");
    const d = await submitBidDecision(bd, ids.opp("va-sched"), { scores: fives, notes: "Strong prime relationship" });
    expect(d.total_score).toBe(84); // 20 + (4/5)×80
    expect(d.verdict).toBe("bid");
    expect((await getOpportunity(bd, ids.opp("va-sched"))).stage).toBe("bid_no_bid");
    await expect(decideBid(bd, d.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    const exec = await switchUser(bd, "exec");
    await decideBid(exec, d.id, true, "Go");
    const moved = await moveStage(bd, ids.opp("va-sched"), { to: "proposal" });
    expect(moved.stage).toBe("proposal");
  });

  it("hides bid scores from people who aren't the owner or an executive", async () => {
    const priya = await asUser("bd2");
    const o = await getOpportunity(priya, ids.opp("dor-mvs"));
    expect(await bidDecisionsFor(priya, o)).toEqual({ visible: false, decisions: [] });
    const marcus = await switchUser(priya, "bd1");
    expect((await bidDecisionsFor(marcus, o)).decisions.length).toBe(1);
  });
});

describe("quotes and margin guardrails", () => {
  it("computes totals and the floor check", () => {
    const lines = [
      { qty: 2, unit_cost: 80, unit_price: 100 },
      { qty: 1, unit_cost: 50, unit_price: 100 },
    ];
    expect(quoteTotals(lines)).toMatchObject({ cost: 210, price: 300, margin: 90 });
    expect(needsMarginApproval(lines, 18)).toBe(false);
    expect(needsMarginApproval(lines, 35)).toBe(true);
    expect(
      needsMarginApproval(
        [
          { qty: 1, unit_cost: 120, unit_price: 100 },
          { qty: 10, unit_cost: 1, unit_price: 100 },
        ],
        5,
      ),
    ).toBe(true);
  });

  it("routes below-floor quotes to executives and blocks sending until approved", async () => {
    const bd = await asUser("bd2");
    const q = await saveQuote(bd, ids.opp("mag-core"), {
      title: "Integration phase 1",
      lines: [{ item: "Integration engineer (hours)", qty: 400, unit_cost: 90, unit_price: 100 }],
    });
    expect(q.belowFloor).toBe(true);
    const submitted = await submitQuote(bd, q.id);
    expect(submitted.status).toBe("pending_approval");
    await expect(setQuoteStatus(bd, q.id, "sent")).rejects.toBeInstanceOf(ValidationError);
    await expect(approveQuote(bd, q.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    const exec = await switchUser(bd, "exec");
    expect((await approveQuote(exec, q.id, true)).status).toBe("approved");
    expect((await setQuoteStatus(bd, q.id, "sent")).status).toBe("sent");
  });

  it("auto-approves quotes above the floor", async () => {
    const bd = await asUser("bd2");
    const q = await saveQuote(bd, ids.opp("mag-core"), {
      title: "Advisory sprint",
      lines: [{ item: "Architect (days)", qty: 10, unit_cost: 700, unit_price: 1400 }],
    });
    expect((await submitQuote(bd, q.id)).status).toBe("approved");
  });

  it("redacts unit cost, margins and internal notes from a bd who doesn't own the quote", async () => {
    const exec = await asUser("exec");
    // Executive creates a quote on Priya's opportunity; Priya can see the quote but not its cost.
    const q = await saveQuote(exec, ids.opp("peach-staff"), {
      title: "Exec-priced option",
      internal_notes: "Rebate 4%",
      lines: [{ item: "Engineer", qty: 1, unit_cost: 50, unit_price: 100 }],
    });
    const priya = await switchUser(exec, "bd2");
    const seen = await getQuote(priya, q.id);
    expect(seen.canSeeCost).toBe(false);
    expect(seen.lines.every((l) => l.unit_cost === null && l.margin_pct === null)).toBe(true);
    expect(seen.totals).toMatchObject({ cost: null, margin: null, marginPct: null, price: 100 });
    expect(seen.internal_notes).toBeNull();
    // Her own quote is fully visible to her.
    const own = await getQuote(priya, ids.quote("peach-staff"));
    expect(own.canSeeCost).toBe(true);
    // Marcus can't see Peachtree quotes at all.
    const marcus = await switchUser(exec, "bd1");
    expect((await visibleQuotes(marcus)).some((x) => x.account_id === ids.account("peachtree"))).toBe(false);
  });

  it("validates opportunity input", async () => {
    const bd = await asUser("bd1");
    await expect(
      createOpportunity(bd, {
        name: "x",
        account_id: ids.account("dor"),
        kind: "public_bid",
        value: 1,
        source: "signal",
        service_lines: [],
      }),
    ).rejects.toThrow();
    const o = await createOpportunity(bd, {
      name: "DOR data warehouse",
      account_id: ids.account("dor"),
      kind: "public_bid",
      value: 500000,
      source: "signal",
      service_lines: ["systems_integration"],
      naics: "541512",
    });
    expect(o.stage).toBe("signal");
    expect(o.owner_id).toBe(bd.user.id);
  });
});
