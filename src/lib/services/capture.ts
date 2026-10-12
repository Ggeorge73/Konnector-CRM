/**
 * Capture pipeline: opportunities, stage gates, Bid/No-Bid, quotes, registrations, vetting, settings.
 */
import { z } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import {
  canApprove,
  canEditOpportunity,
  canManageRegistrations,
  canManageSettings,
  canSeeBidDecision,
  canSeeOpportunity,
  canSeeQuoteCost,
  canSeeVetting,
  isLeader,
} from "@/lib/auth/permissions";
import { scoreBid, verdictFor } from "@/lib/domain/bid";
import { lineTotals, needsMarginApproval, quoteTotals } from "@/lib/domain/quote";
import { gateFor, isClosed } from "@/lib/domain/stages";
import {
  BID_CRITERIA,
  OPP_KINDS,
  OPP_SOURCES,
  SERVICE_LINES,
  STAGES,
  type BidCriterion,
  type BidDecision,
  type Opportunity,
  type OrgSettings,
  type PartnerVetting,
  type Quote,
  type QuoteLine,
  type Registration,
  type Stage,
} from "@/lib/domain/types";
import { audit, diff } from "./audit";
import type { Ctx } from "./context-types";
import { actorId } from "./system";
import { getAccount, logActivity, notify, visibleOpportunities } from "./core";
import { orgSettings } from "./pulse";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date")
  .nullable()
  .optional();
const optStr = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

// ---------------- Opportunities ----------------

export const OpportunityInput = z.object({
  name: z.string().trim().min(3, "Name is required").max(200),
  account_id: z.string().uuid("Pick an account"),
  kind: z.enum(OPP_KINDS),
  value: z.coerce.number().min(0, "Value can't be negative").max(1e12),
  currency: z.string().length(3).default("USD"),
  source: z.enum(OPP_SOURCES),
  service_lines: z.array(z.enum(SERVICE_LINES)).min(1, "Pick at least one service line"),
  expected_close: isoDate,
  pwin: z.coerce.number().min(0).max(100).nullable().optional(),
  next_step: optStr,
  next_step_due: isoDate,
  owner_id: z.string().uuid().optional(),
  shared_with: z.array(z.string().uuid()).optional(),
  solicitation_no: optStr,
  agency_buyer: optStr,
  procurement_vehicle: optStr,
  naics: z
    .string()
    .trim()
    .regex(/^(\d{6})?$/, "NAICS codes are 6 digits")
    .transform((v) => v || null)
    .nullable()
    .optional(),
  set_aside: optStr,
  questions_due: isoDate,
  proposal_due: isoDate,
  submission_method: optStr,
  incumbent: optStr,
});
export type OpportunityInputT = z.input<typeof OpportunityInput>;

export async function getOpportunity(c: Ctx, id: string): Promise<Opportunity> {
  const o = await c.store.get("opportunities", id);
  if (!o || o.archived_at || !canSeeOpportunity(c.user, o)) throw new ForbiddenError("Opportunity not found.");
  return o;
}

export async function createOpportunity(c: Ctx, input: OpportunityInputT): Promise<Opportunity> {
  if (!(isLeader(c.user) || c.user.role === "bd" || c.user.role === "recruiter")) throw new ForbiddenError();
  const v = OpportunityInput.parse(input);
  await getAccount(c, v.account_id);
  if (c.user.role === "recruiter" && v.kind !== "staffing_placement")
    throw new ForbiddenError("Recruiters can only create staffing opportunities.");
  const settings = await orgSettings(c);
  const row = await c.store.insert("opportunities", {
    org_id: c.user.org_id,
    name: v.name,
    account_id: v.account_id,
    owner_id: v.owner_id && isLeader(c.user) ? v.owner_id : c.user.id,
    kind: v.kind,
    stage: "signal",
    value: v.value,
    currency: v.currency,
    probability: settings.stages.find((s) => s.key === "signal")?.probability ?? 5,
    pwin: v.pwin ?? null,
    expected_close: v.expected_close ?? null,
    source: v.source,
    service_lines: v.service_lines,
    next_step: v.next_step ?? null,
    next_step_due: v.next_step_due ?? null,
    lost_reason: null,
    no_bid_reason: null,
    shared_with: v.shared_with ?? [],
    parent_opportunity_id: null,
    solicitation_no: v.solicitation_no ?? null,
    agency_buyer: v.agency_buyer ?? null,
    procurement_vehicle: v.procurement_vehicle ?? null,
    naics: v.naics ?? null,
    set_aside: v.set_aside ?? null,
    questions_due: v.questions_due ?? null,
    proposal_due: v.proposal_due ?? null,
    submission_method: v.submission_method ?? null,
    incumbent: v.incumbent ?? null,
    created_by: actorId(c),
  });
  await audit(c, "opportunity.created", "opportunities", row.id, null, { name: row.name, value: row.value, owner_id: row.owner_id });
  await logActivity(c, {
    type: "system",
    subject: "Opportunity created",
    related_type: "opportunity",
    related_id: row.id,
    account_id: row.account_id,
  });
  return row;
}

export async function updateOpportunity(c: Ctx, id: string, patch: Partial<OpportunityInputT>) {
  const o = await getOpportunity(c, id);
  if (!canEditOpportunity(c.user, o))
    throw new ForbiddenError("Only the owner, people it's shared with, or executives can edit this deal.");
  const v = OpportunityInput.partial().parse(patch);
  if (v.owner_id && v.owner_id !== o.owner_id && !isLeader(c.user)) throw new ForbiddenError("Only executives can reassign ownership.");
  const d = diff(o, v as Partial<Opportunity>);
  if (!d.changed) return o;
  const row = await c.store.update("opportunities", id, v as Partial<Opportunity>);
  const money = ["value", "currency", "owner_id", "shared_with"].filter((k) => k in d.after);
  if (money.length) await audit(c, "opportunity.updated", "opportunities", id, pick(d.before, money), pick(d.after, money));
  return row;
}

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));

export async function latestBidDecision(c: Ctx, opportunityId: string): Promise<BidDecision | null> {
  const all = await c.store.list("bid_decisions", {
    where: { opportunity_id: opportunityId },
    orderBy: { column: "created_at", ascending: false },
  });
  return all[0] ?? null;
}

export const MoveInput = z.object({
  to: z.enum(STAGES),
  lost_reason: z.string().trim().min(3, "Say why we lost").max(500).optional(),
  no_bid_reason: z.string().trim().min(3, "Say why we're not bidding").max(500).optional(),
  proposal_due: isoDate,
});

/** Move a deal between stages, enforcing the stage gates server-side. */
export async function moveStage(c: Ctx, id: string, input: z.input<typeof MoveInput>) {
  const v = MoveInput.parse(input);
  const o = await getOpportunity(c, id);
  if (!canEditOpportunity(c.user, o)) throw new ForbiddenError("You can't move this deal.");
  if (o.stage === v.to) return o;
  if (isClosed(o.stage) && !isLeader(c.user)) throw new ForbiddenError("Only executives can reopen a closed deal.");
  const decision = await latestBidDecision(c, id);
  const unmet = gateFor({ ...o, proposal_due: v.proposal_due ?? o.proposal_due }, v.to, decision).filter((g) => {
    if (g.kind === "lost_reason") return !v.lost_reason;
    if (g.kind === "no_bid_reason") return !v.no_bid_reason;
    if (g.kind === "proposal_due") return !(v.proposal_due ?? o.proposal_due);
    return g.kind === "bid_decision";
  });
  if (unmet.length) {
    const msg = {
      bid_decision: "An approved Bid/No-Bid scorecard is required to leave the Bid / No-Bid stage.",
      lost_reason: "A lost reason is required.",
      no_bid_reason: "A no-bid reason is required.",
      proposal_due: "Set the proposal due date first.",
      handoff: "",
    }[unmet[0].kind];
    throw new ValidationError(msg);
  }
  const settings = await orgSettings(c);
  const label = (s: Stage) => settings.stages.find((x) => x.key === s)?.label ?? s;
  const patch: Partial<Opportunity> = {
    stage: v.to,
    probability: settings.stages.find((s) => s.key === v.to)?.probability ?? o.probability,
    lost_reason: v.to === "lost" ? v.lost_reason! : o.lost_reason,
    no_bid_reason: v.to === "no_bid" ? v.no_bid_reason! : o.no_bid_reason,
    proposal_due: v.proposal_due ?? o.proposal_due,
  };
  if (v.to === "won") patch.expected_close = c.now.toISOString().slice(0, 10);
  const row = await c.store.update("opportunities", id, patch);
  await audit(c, "opportunity.stage_changed", "opportunities", id, { stage: o.stage }, { stage: v.to });
  await logActivity(c, {
    type: "stage_change",
    subject: `Stage moved ${label(o.stage)} → ${label(v.to)}`,
    body: v.lost_reason ?? v.no_bid_reason ?? null,
    related_type: "opportunity",
    related_id: id,
    account_id: o.account_id,
  });
  return row;
}

// ---------------- Bid / No-Bid ----------------

const Scores = z.object(
  Object.fromEntries(BID_CRITERIA.map((k) => [k, z.number().int().min(1).max(5)])) as Record<BidCriterion, z.ZodNumber>,
);

export async function submitBidDecision(
  c: Ctx,
  opportunityId: string,
  input: { scores: Record<BidCriterion, number>; notes?: string | null },
) {
  const o = await getOpportunity(c, opportunityId);
  if (!canEditOpportunity(c.user, o)) throw new ForbiddenError();
  const scores = Scores.parse(input.scores) as Record<BidCriterion, number>;
  const weights = (await orgSettings(c)).bid_weights;
  const total = scoreBid(scores, weights);
  const row = await c.store.insert("bid_decisions", {
    opportunity_id: o.id,
    scores,
    weights,
    total_score: total,
    verdict: verdictFor(total),
    notes: input.notes?.trim() || null,
    decided_by: c.user.id,
    status: "pending_approval",
    approved_by: null,
    approved_at: null,
    created_by: actorId(c),
  });
  if (o.stage !== "bid_no_bid" && !isClosed(o.stage) && ["signal", "qualify", "capture"].includes(o.stage)) {
    await c.store.update("opportunities", o.id, {
      stage: "bid_no_bid",
      probability: (await orgSettings(c)).stages.find((s) => s.key === "bid_no_bid")?.probability ?? o.probability,
    });
  }
  await audit(c, "bid_decision.submitted", "bid_decisions", row.id, null, { total_score: total, verdict: row.verdict });
  await logActivity(c, {
    type: "system",
    subject: `Bid/No-Bid scorecard submitted (${total}/100)`,
    related_type: "opportunity",
    related_id: o.id,
    account_id: o.account_id,
  });
  const leaders = (await c.store.list("users")).filter((u) => u.role === "executive");
  for (const u of leaders) await notify(c, u.id, "approval", `Bid/No-Bid approval needed: ${o.name}`, `/opportunities/${o.id}`);
  return row;
}

export async function decideBid(c: Ctx, decisionId: string, approve: boolean, note?: string) {
  if (!canApprove(c.user)) throw new ForbiddenError("Only executives can approve Bid/No-Bid decisions.");
  const d = await c.store.get("bid_decisions", decisionId);
  if (!d) throw new ForbiddenError("Decision not found.");
  if (d.status !== "pending_approval") throw new ValidationError("This decision has already been decided.");
  const o = await getOpportunity(c, d.opportunity_id);
  const row = await c.store.update("bid_decisions", decisionId, {
    status: approve ? "approved" : "rejected",
    approved_by: c.user.id,
    approved_at: c.now.toISOString(),
    notes: note ? `${d.notes ? `${d.notes}\n` : ""}Executive: ${note}` : d.notes,
  });
  await audit(
    c,
    approve ? "bid_decision.approved" : "bid_decision.rejected",
    "bid_decisions",
    decisionId,
    { status: d.status },
    { status: row.status },
  );
  await logActivity(c, {
    type: "system",
    subject: `Bid/No-Bid ${approve ? "approved" : "sent back"} by ${c.user.full_name} (${d.total_score}/100, ${d.verdict.replace("_", "-")})`,
    body: note ?? null,
    related_type: "opportunity",
    related_id: o.id,
    account_id: o.account_id,
  });
  await notify(c, o.owner_id, "approval", `Bid/No-Bid ${approve ? "approved" : "sent back"}: ${o.name}`, `/opportunities/${o.id}`);
  return row;
}

/** Decisions with scores redacted for viewers who aren't entitled to them. */
export async function bidDecisionsFor(c: Ctx, o: Opportunity) {
  if (!canSeeBidDecision(c.user, o)) return { visible: false as const, decisions: [] };
  return {
    visible: true as const,
    decisions: await c.store.list("bid_decisions", {
      where: { opportunity_id: o.id },
      orderBy: { column: "created_at", ascending: false },
    }),
  };
}

// ---------------- Quotes ----------------

export const QuoteLineInput = z.object({
  item: z.string().trim().min(1, "Describe the item").max(200),
  description: optStr,
  qty: z.coerce.number().positive("Quantity must be above zero"),
  unit_cost: z.coerce.number().min(0, "Cost can't be negative"),
  unit_price: z.coerce.number().min(0, "Price can't be negative"),
  oem_partner_account_id: z.string().uuid().nullable().optional(),
});
export const QuoteInput = z.object({
  title: z.string().trim().min(3, "Title is required").max(200),
  valid_until: isoDate,
  terms: z.string().trim().max(4000).nullable().optional(),
  internal_notes: z.string().trim().max(4000).nullable().optional(),
  lines: z.array(QuoteLineInput).min(1, "Add at least one line"),
});
export type QuoteInputT = z.input<typeof QuoteInput>;

export type RedactedLine = Omit<QuoteLine, "unit_cost"> & { unit_cost: number | null; margin_pct: number | null };
export type QuoteView = Quote & {
  lines: RedactedLine[];
  totals: { price: number; cost: number | null; margin: number | null; marginPct: number | null };
  canSeeCost: boolean;
  belowFloor: boolean | null;
};

async function quoteWithLines(c: Ctx, q: Quote): Promise<QuoteView> {
  const lines = await c.store.list("quote_lines", { where: { quote_id: q.id }, orderBy: { column: "position" } });
  const see = canSeeQuoteCost(c.user, q);
  const t = quoteTotals(lines);
  const floor = (await orgSettings(c)).margin_floor_pct;
  return {
    ...q,
    internal_notes: see ? q.internal_notes : null,
    lines: lines.map((l) => ({ ...l, unit_cost: see ? l.unit_cost : null, margin_pct: see ? lineTotals(l).marginPct : null })),
    totals: { price: t.price, cost: see ? t.cost : null, margin: see ? t.margin : null, marginPct: see ? t.marginPct : null },
    canSeeCost: see,
    belowFloor: see ? needsMarginApproval(lines, floor) : null,
  };
}

export async function getQuote(c: Ctx, id: string): Promise<QuoteView> {
  const q = await c.store.get("quotes", id);
  if (!q || q.archived_at) throw new ForbiddenError("Quote not found.");
  await getOpportunity(c, q.opportunity_id);
  return quoteWithLines(c, q);
}

export async function visibleQuotes(c: Ctx): Promise<QuoteView[]> {
  const opps = new Set((await visibleOpportunities(c)).map((o) => o.id));
  const quotes = (await c.store.list("quotes", { orderBy: { column: "created_at", ascending: false } })).filter((q) =>
    opps.has(q.opportunity_id),
  );
  return Promise.all(quotes.map((q) => quoteWithLines(c, q)));
}

async function nextQuoteNumber(c: Ctx) {
  const year = c.now.getFullYear();
  const n = (await c.store.list("quotes", { includeArchived: true }))
    .filter((q) => q.number.startsWith(`Q-${year}-`))
    .map((q) => Number(q.number.split("-")[2]) || 0);
  return `Q-${year}-${String(Math.max(100, ...n) + 1).padStart(4, "0")}`;
}

export async function saveQuote(c: Ctx, opportunityId: string, input: QuoteInputT, quoteId?: string) {
  const o = await getOpportunity(c, opportunityId);
  if (!canEditOpportunity(c.user, o)) throw new ForbiddenError();
  const v = QuoteInput.parse(input);
  let q: Quote;
  if (quoteId) {
    const existing = await c.store.get("quotes", quoteId);
    if (!existing || existing.opportunity_id !== o.id) throw new ForbiddenError("Quote not found.");
    if (!["draft", "pending_approval", "approved"].includes(existing.status))
      throw new ValidationError("Sent quotes can't be edited — create a new version.");
    if (!canSeeQuoteCost(c.user, existing)) throw new ForbiddenError("Only the quote owner or an executive can edit pricing.");
    q = await c.store.update("quotes", quoteId, {
      title: v.title,
      valid_until: v.valid_until ?? null,
      terms: v.terms ?? null,
      internal_notes: v.internal_notes ?? null,
      status: "draft",
      approved_by: null,
      approved_at: null,
    });
    for (const l of await c.store.list("quote_lines", { where: { quote_id: quoteId } })) await c.store.remove("quote_lines", l.id);
  } else {
    q = await c.store.insert("quotes", {
      org_id: c.user.org_id,
      opportunity_id: o.id,
      account_id: o.account_id,
      number: await nextQuoteNumber(c),
      title: v.title,
      currency: o.currency,
      status: "draft",
      valid_until: v.valid_until ?? null,
      terms: v.terms ?? null,
      internal_notes: v.internal_notes ?? null,
      approved_by: null,
      approved_at: null,
      owner_id: c.user.id,
      created_by: actorId(c),
    });
  }
  for (const [i, l] of v.lines.entries()) {
    await c.store.insert("quote_lines", {
      quote_id: q.id,
      position: i + 1,
      item: l.item,
      description: l.description ?? null,
      qty: l.qty,
      unit_cost: l.unit_cost,
      unit_price: l.unit_price,
      oem_partner_account_id: l.oem_partner_account_id ?? null,
    });
  }
  const t = quoteTotals(v.lines);
  await audit(c, quoteId ? "quote.updated" : "quote.created", "quotes", q.id, null, {
    price: t.price,
    margin_pct: Math.round(t.marginPct * 10) / 10,
  });
  await logActivity(c, {
    type: "system",
    subject: `Quote ${q.number} ${quoteId ? "updated" : "drafted"}`,
    related_type: "opportunity",
    related_id: o.id,
    account_id: o.account_id,
  });
  return getQuote(c, q.id);
}

/** Owner finalises the draft: auto-approved above the margin floor, otherwise routed to executives. */
export async function submitQuote(c: Ctx, id: string) {
  const q = await c.store.get("quotes", id);
  if (!q) throw new ForbiddenError("Quote not found.");
  const o = await getOpportunity(c, q.opportunity_id);
  if (!canEditOpportunity(c.user, o)) throw new ForbiddenError();
  if (q.status !== "draft") throw new ValidationError("Only drafts can be submitted.");
  const lines = await c.store.list("quote_lines", { where: { quote_id: id } });
  const floor = (await orgSettings(c)).margin_floor_pct;
  if (needsMarginApproval(lines, floor) && !canApprove(c.user)) {
    const row = await c.store.update("quotes", id, { status: "pending_approval" });
    for (const u of (await c.store.list("users")).filter((x) => x.role === "executive")) {
      await notify(c, u.id, "approval", `Quote ${q.number} needs margin approval`, `/quotes/${id}`);
    }
    await audit(c, "quote.approval_requested", "quotes", id, { status: q.status }, { status: row.status });
    return row;
  }
  const row = await c.store.update("quotes", id, { status: "approved", approved_by: c.user.id, approved_at: c.now.toISOString() });
  await audit(c, "quote.approved", "quotes", id, { status: q.status }, { status: "approved" });
  return row;
}

export async function approveQuote(c: Ctx, id: string, approve: boolean) {
  if (!canApprove(c.user)) throw new ForbiddenError("Only executives can approve margins below the floor.");
  const q = await c.store.get("quotes", id);
  if (!q || q.status !== "pending_approval") throw new ValidationError("This quote isn't waiting for approval.");
  const row = await c.store.update(
    "quotes",
    id,
    approve ? { status: "approved", approved_by: c.user.id, approved_at: c.now.toISOString() } : { status: "draft" },
  );
  await audit(c, approve ? "quote.approved" : "quote.rejected", "quotes", id, { status: q.status }, { status: row.status });
  await notify(c, q.owner_id, "approval", `Quote ${q.number} ${approve ? "approved" : "sent back for changes"}`, `/quotes/${id}`);
  return row;
}

export async function setQuoteStatus(c: Ctx, id: string, status: "sent" | "accepted" | "declined") {
  const q = await c.store.get("quotes", id);
  if (!q) throw new ForbiddenError("Quote not found.");
  const o = await getOpportunity(c, q.opportunity_id);
  if (!canEditOpportunity(c.user, o)) throw new ForbiddenError();
  if (status === "sent" && q.status !== "approved") throw new ValidationError("Quotes must be approved before they're sent.");
  const row = await c.store.update("quotes", id, { status });
  await audit(c, `quote.${status}`, "quotes", id, { status: q.status }, { status });
  await logActivity(c, {
    type: "system",
    subject: `Quote ${q.number} marked ${status}`,
    related_type: "opportunity",
    related_id: o.id,
    account_id: o.account_id,
  });
  return row;
}

// ---------------- Registrations ----------------

export const RegistrationInput = z.object({
  kind: z.enum(["sam_uei", "cage", "georgia_supplier", "certification", "insurance", "license"]),
  name: z.string().trim().min(2, "Name is required").max(200),
  identifier: optStr,
  issuer: optStr,
  issued_on: isoDate,
  expires_on: isoDate,
  notes: optStr,
});
export type RegistrationInputT = z.input<typeof RegistrationInput>;

export async function saveRegistration(c: Ctx, input: RegistrationInputT, id?: string): Promise<Registration> {
  if (!canManageRegistrations(c.user)) throw new ForbiddenError("Only executives can change registrations.");
  const v = RegistrationInput.parse(input);
  const data = {
    kind: v.kind,
    name: v.name,
    identifier: v.identifier ?? null,
    issuer: v.issuer ?? null,
    issued_on: v.issued_on ?? null,
    expires_on: v.expires_on ?? null,
    notes: v.notes ?? null,
  };
  if (id) {
    const before = await c.store.get("registrations", id);
    const row = await c.store.update("registrations", id, data);
    if (before?.expires_on !== row.expires_on)
      await audit(c, "registration.renewed", "registrations", id, { expires_on: before?.expires_on }, { expires_on: row.expires_on });
    return row;
  }
  return c.store.insert("registrations", { org_id: c.user.org_id, owner_id: c.user.id, created_by: actorId(c), ...data });
}

// ---------------- Partner vetting ----------------

export const VettingInput = z.object({
  account_id: z.string().uuid(),
  sanctions_screen: z.enum(["clear", "hit", "pending"]),
  pep_screen: z.enum(["clear", "hit", "pending"]),
  beneficial_ownership: optStr,
  anti_corruption_attested: z.boolean(),
  references_checked: z.boolean(),
  risk_rating: z.enum(["low", "medium", "high"]),
  review_due: isoDate,
  notes: optStr,
});
export type VettingInputT = z.input<typeof VettingInput>;

export async function visibleVetting(c: Ctx): Promise<PartnerVetting[]> {
  if (!canSeeVetting(c.user)) return [];
  return c.store.list("partner_vetting", { orderBy: { column: "review_due" } });
}

export async function saveVetting(c: Ctx, input: VettingInputT, id?: string) {
  if (!canSeeVetting(c.user)) throw new ForbiddenError("Partner vetting is restricted to executives.");
  const v = VettingInput.parse(input);
  const data = {
    ...v,
    beneficial_ownership: v.beneficial_ownership ?? null,
    review_due: v.review_due ?? null,
    notes: v.notes ?? null,
    reviewer_id: c.user.id,
  };
  if (id) {
    const before = await c.store.get("partner_vetting", id);
    const row = await c.store.update("partner_vetting", id, data);
    await audit(
      c,
      "vetting.updated",
      "partner_vetting",
      id,
      { risk_rating: before?.risk_rating, sanctions_screen: before?.sanctions_screen },
      { risk_rating: row.risk_rating, sanctions_screen: row.sanctions_screen },
    );
    return row;
  }
  const row = await c.store.insert("partner_vetting", { org_id: c.user.org_id, created_by: actorId(c), ...data });
  await audit(c, "vetting.created", "partner_vetting", row.id, null, { account_id: row.account_id, risk_rating: row.risk_rating });
  return row;
}

// ---------------- Reminders (registrations + vetting) ----------------

/** Notifies owners about registrations expiring within 30 days and vetting reviews due within 14. Idempotent per day. */
export async function runComplianceReminders(c: Ctx) {
  const day = c.now.toISOString().slice(0, 10);
  const existing = new Set(
    (await c.store.list("notifications")).filter((n) => n.created_at.startsWith(day)).map((n) => `${n.user_id}:${n.title}`),
  );
  let sent = 0;
  const send = async (userId: string, title: string, href: string) => {
    if (existing.has(`${userId}:${title}`)) return;
    await notify(c, userId, "expiry", title, href);
    existing.add(`${userId}:${title}`);
    sent++;
  };
  const days = (d: string) => Math.round((new Date(`${d}T12:00:00Z`).getTime() - c.now.getTime()) / 86_400_000);
  for (const r of await c.store.list("registrations")) {
    if (!r.expires_on) continue;
    const d = days(r.expires_on);
    if (d <= 30) await send(r.owner_id, d < 0 ? `${r.name} expired ${-d} days ago` : `${r.name} expires in ${d} days`, "/registrations");
  }
  const leaders = (await c.store.list("users")).filter((u) => u.role === "admin" || u.role === "executive");
  for (const v of await c.store.list("partner_vetting")) {
    if (!v.review_due) continue;
    const d = days(v.review_due);
    const acc = await c.store.get("accounts", v.account_id);
    if (d <= 14)
      for (const u of leaders) await send(u.id, `Vetting review ${d < 0 ? "overdue" : "due"}: ${acc?.name ?? "partner"}`, "/vetting");
  }
  return { sent };
}

// ---------------- Settings ----------------

export const SettingsInput = z.object({
  margin_floor_pct: z.coerce.number().min(0).max(90),
  low_survey_threshold: z.coerce.number().int().min(0).max(10),
  bid_weights: z
    .object(Object.fromEntries(BID_CRITERIA.map((k) => [k, z.coerce.number().int().min(0).max(100)])) as Record<BidCriterion, z.ZodNumber>)
    .refine((w) => Object.values(w).reduce((s, x) => s + x, 0) === 100, "Weights must add up to 100"),
  stages: z
    .array(
      z.object({
        key: z.enum(STAGES),
        label: z.string().trim().min(2).max(40),
        probability: z.coerce.number().min(0).max(100),
        wip_limit: z.coerce.number().int().min(1).nullable(),
        closed: z.boolean(),
      }),
    )
    .length(STAGES.length),
});

export async function updateSettings(c: Ctx, input: z.input<typeof SettingsInput>): Promise<OrgSettings> {
  if (!canManageSettings(c.user)) throw new ForbiddenError("Only admins can change settings.");
  const v = SettingsInput.parse(input) as OrgSettings;
  const [org] = await c.store.list("organizations");
  await c.store.update("organizations", org.id, { settings: v });
  await audit(
    c,
    "settings.updated",
    "organizations",
    org.id,
    { margin_floor_pct: org.settings.margin_floor_pct, bid_weights: org.settings.bid_weights },
    { margin_floor_pct: v.margin_floor_pct, bid_weights: v.bid_weights },
  );
  return v;
}
