import { describe, expect, it } from "vitest";
import {
  canOpenRoute,
  canSeeBidDecision,
  canSeeConsultantCost,
  canSeeOpportunity,
  canSeeQuoteCost,
  canSeeVetting,
} from "@/lib/auth/permissions";

const admin = { id: "a", role: "admin" as const };
const exec = { id: "e", role: "executive" as const };
const bd = { id: "b", role: "bd" as const };
const recruiter = { id: "r", role: "recruiter" as const };
const delivery = { id: "d", role: "delivery_lead" as const };

describe("role rules", () => {
  it("restricts cost-side data to leaders (and owners for their own quotes)", () => {
    expect(canSeeQuoteCost(exec, { owner_id: "x" })).toBe(true);
    expect(canSeeQuoteCost(bd, { owner_id: "x" })).toBe(false);
    expect(canSeeQuoteCost(bd, { owner_id: "b" })).toBe(true);
    expect(canSeeConsultantCost(bd)).toBe(false);
    expect(canSeeConsultantCost(recruiter)).toBe(true);
    expect(canSeeVetting(bd)).toBe(false);
    expect(canSeeVetting(admin)).toBe(true);
    expect(canSeeBidDecision(bd, { owner_id: "x" })).toBe(false);
    expect(canSeeBidDecision(bd, { owner_id: "b" })).toBe(true);
  });

  it("scopes opportunities by role", () => {
    const opp = { owner_id: "x", shared_with: [] as string[], kind: "public_bid" as const };
    expect(canSeeOpportunity(bd, opp)).toBe(false);
    expect(canSeeOpportunity(bd, { ...opp, shared_with: ["b"] })).toBe(true);
    expect(canSeeOpportunity(delivery, opp)).toBe(true);
    expect(canSeeOpportunity(recruiter, opp)).toBe(false);
    expect(canSeeOpportunity(recruiter, { ...opp, kind: "staffing_placement" })).toBe(true);
  });

  it("guards routes", () => {
    expect(canOpenRoute(bd, "/settings")).toBe(false);
    expect(canOpenRoute(admin, "/settings")).toBe(true);
    expect(canOpenRoute(bd, "/vetting")).toBe(false);
    expect(canOpenRoute(bd, "/bench/123")).toBe(false);
    expect(canOpenRoute(recruiter, "/bench/123")).toBe(true);
    expect(canOpenRoute(bd, "/accounts/1")).toBe(true);
  });
});
