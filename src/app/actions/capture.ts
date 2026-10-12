"use server";
import { run } from "@/lib/services/action";
import {
  approveQuote,
  createOpportunity,
  decideBid,
  moveStage,
  saveQuote,
  setQuoteStatus,
  submitBidDecision,
  submitQuote,
  updateOpportunity,
  type OpportunityInputT,
  type QuoteInputT,
} from "@/lib/services/capture";
import type { BidCriterion, Stage } from "@/lib/domain/types";

export async function createOpportunityAction(input: OpportunityInputT) {
  return run((c) => createOpportunity(c, input), ["/opportunities"]);
}
export async function updateOpportunityAction(id: string, patch: Partial<OpportunityInputT>) {
  return run((c) => updateOpportunity(c, id, patch), ["/opportunities", `/opportunities/${id}`]);
}
export async function moveStageAction(
  id: string,
  input: { to: Stage; lost_reason?: string; no_bid_reason?: string; proposal_due?: string | null },
) {
  return run((c) => moveStage(c, id, input), ["/opportunities", `/opportunities/${id}`, "/"]);
}
export async function submitBidAction(opportunityId: string, scores: Record<BidCriterion, number>, notes: string | null) {
  return run((c) => submitBidDecision(c, opportunityId, { scores, notes }), [`/opportunities/${opportunityId}`]);
}
export async function decideBidAction(decisionId: string, approve: boolean, note?: string) {
  return run((c) => decideBid(c, decisionId, approve, note), ["/opportunities"]);
}
export async function saveQuoteAction(opportunityId: string, input: QuoteInputT, quoteId?: string) {
  return run((c) => saveQuote(c, opportunityId, input, quoteId), ["/quotes", `/opportunities/${opportunityId}`]);
}
export async function submitQuoteAction(id: string) {
  return run((c) => submitQuote(c, id), ["/quotes", `/quotes/${id}`]);
}
export async function approveQuoteAction(id: string, approve: boolean) {
  return run((c) => approveQuote(c, id, approve), ["/quotes", `/quotes/${id}`]);
}
export async function setQuoteStatusAction(id: string, status: "sent" | "accepted" | "declined") {
  return run((c) => setQuoteStatus(c, id, status), ["/quotes", `/quotes/${id}`]);
}
