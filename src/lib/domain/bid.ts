import { BID_CRITERIA, type BidCriterion, type BidDecision } from "./types";

/** Weighted score out of 100: Σ (score/5 × weight) normalised by total weight. */
export function scoreBid(scores: Record<BidCriterion, number>, weights: Record<BidCriterion, number>): number {
  const totalWeight = BID_CRITERIA.reduce((s, c) => s + (weights[c] ?? 0), 0) || 1;
  const raw = BID_CRITERIA.reduce((s, c) => s + ((scores[c] ?? 0) / 5) * (weights[c] ?? 0), 0);
  return Math.round((raw / totalWeight) * 100);
}

export function verdictFor(total: number): BidDecision["verdict"] {
  if (total >= 70) return "bid";
  if (total >= 55) return "conditional";
  return "no_bid";
}

export function defaultScores(): Record<BidCriterion, number> {
  return Object.fromEntries(BID_CRITERIA.map((c) => [c, 3])) as Record<BidCriterion, number>;
}
