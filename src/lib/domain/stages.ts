import type { BidDecision, Opportunity, Stage } from "./types";

export const OPEN_STAGES: Stage[] = ["signal", "qualify", "capture", "bid_no_bid", "proposal", "submitted"];
export const CLOSED_STAGES: Stage[] = ["won", "lost", "no_bid"];
export const isClosed = (s: Stage) => CLOSED_STAGES.includes(s);

export type GateRequirement =
  { kind: "bid_decision" } | { kind: "lost_reason" } | { kind: "no_bid_reason" } | { kind: "handoff" } | { kind: "proposal_due" };

/**
 * What must be true to move an opportunity from its stage to `to`. The UI opens a
 * stage-gate dialog for each unmet requirement; the service re-checks server-side.
 */
export function gateFor(
  o: Pick<Opportunity, "stage" | "kind" | "proposal_due">,
  to: Stage,
  approvedDecision: BidDecision | null,
): GateRequirement[] {
  const req: GateRequirement[] = [];
  const from = OPEN_STAGES.indexOf(o.stage);
  const toIdx = OPEN_STAGES.indexOf(to);
  // Leaving Bid / No-Bid forward (or skipping past it) needs an approved scorecard.
  const passesGate = (o.stage === "bid_no_bid" || (from > -1 && from < 3)) && (toIdx > 3 || to === "won" || to === "lost");
  if (
    o.kind === "public_bid" &&
    passesGate &&
    !(approvedDecision && approvedDecision.status === "approved" && approvedDecision.verdict !== "no_bid")
  ) {
    req.push({ kind: "bid_decision" });
  }
  if (to === "lost") req.push({ kind: "lost_reason" });
  if (to === "no_bid") req.push({ kind: "no_bid_reason" });
  if (o.kind === "public_bid" && to === "proposal" && !o.proposal_due) req.push({ kind: "proposal_due" });
  if (to === "won") req.push({ kind: "handoff" });
  return req;
}
