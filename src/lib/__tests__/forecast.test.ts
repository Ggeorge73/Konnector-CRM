import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/data/seed";
import type { Opportunity } from "@/lib/domain/types";
import { categoryFor, computeForecast, forecastData, quartersFrom } from "@/lib/services/forecast";
import { visibleOpportunities } from "@/lib/services/core";
import { asUser, switchUser } from "./helpers";

let n = 0;
function opp(p: Partial<Opportunity>): Opportunity {
  n++;
  return {
    id: `o${n}`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    archived_at: null,
    org_id: "org",
    name: `Deal ${n}`,
    account_id: "a",
    owner_id: "u",
    kind: "private_deal",
    stage: "proposal",
    value: 100_000,
    currency: "USD",
    probability: 50,
    pwin: null,
    expected_close: "2026-11-15",
    source: "signal",
    service_lines: ["implementation"],
    next_step: null,
    next_step_due: null,
    lost_reason: null,
    no_bid_reason: null,
    shared_with: [],
    parent_opportunity_id: null,
    solicitation_no: null,
    agency_buyer: null,
    procurement_vehicle: null,
    naics: null,
    set_aside: null,
    questions_due: null,
    proposal_due: null,
    submission_method: null,
    incumbent: null,
    ...p,
  };
}

const now = new Date("2026-10-12T15:00:00Z");

describe("forecast maths", () => {
  it("categorises by probability: commit ≥60, best case ≥35", () => {
    expect(categoryFor(60)).toBe("commit");
    expect(categoryFor(100)).toBe("commit");
    expect(categoryFor(59)).toBe("best_case");
    expect(categoryFor(35)).toBe("best_case");
    expect(categoryFor(34)).toBe("pipeline");
  });

  it("builds the current quarter plus the next three", () => {
    expect(quartersFrom(now).map((q) => q.key)).toEqual(["2026-Q4", "2027-Q1", "2027-Q2", "2027-Q3"]);
    expect(quartersFrom(now)[0]).toMatchObject({ start: "2026-10-01", end: "2026-12-31", label: "Q4 2026" });
    expect(quartersFrom(now)[1]).toMatchObject({ start: "2027-01-01", end: "2027-03-31" });
  });

  it("totals unweighted vs weighted and commit / best case / pipeline over open deals only", () => {
    const f = computeForecast(
      [
        opp({ value: 200_000, probability: 60, stage: "submitted" }),
        opp({ value: 100_000, probability: 50, stage: "proposal" }),
        opp({ value: 400_000, probability: 10, stage: "qualify" }),
        opp({ value: 999_999, probability: 100, stage: "won" }),
        opp({ value: 999_999, probability: 0, stage: "lost" }),
        opp({ value: 999_999, probability: 50, archived_at: "2026-01-02T00:00:00Z" }),
      ],
      DEFAULT_SETTINGS,
      now,
    );
    expect(f.totals.count).toBe(3);
    expect(f.totals.unweighted).toBe(700_000);
    expect(f.totals.weighted).toBe(120_000 + 50_000 + 40_000);
    expect(f.totals.commit).toBe(200_000);
    expect(f.totals.bestCase).toBe(300_000);
    expect(f.totals.pipeline).toBe(700_000);
  });

  it("groups by open stage in pipeline order", () => {
    const f = computeForecast(
      [
        opp({ stage: "proposal", value: 10, probability: 50 }),
        opp({ stage: "proposal", value: 30, probability: 50 }),
        opp({ stage: "signal", value: 5, probability: 5 }),
      ],
      DEFAULT_SETTINGS,
      now,
    );
    expect(f.byStage.map((s) => s.stage)).toEqual(["signal", "qualify", "capture", "bid_no_bid", "proposal", "submitted"]);
    const proposal = f.byStage.find((s) => s.stage === "proposal")!;
    expect(proposal).toMatchObject({ count: 2, unweighted: 40, weighted: 20, label: "Proposal" });
    expect(f.byStage.find((s) => s.stage === "qualify")).toMatchObject({ count: 0, unweighted: 0 });
  });

  it("splits a multi-line deal's value evenly across its service lines", () => {
    const f = computeForecast(
      [
        opp({ value: 300_000, probability: 50, service_lines: ["implementation", "systems_integration", "advisory"] }),
        opp({ value: 100_000, probability: 20, service_lines: ["implementation"] }),
      ],
      DEFAULT_SETTINGS,
      now,
    );
    const by = Object.fromEntries(f.byServiceLine.map((l) => [l.line, l]));
    expect(by.implementation).toMatchObject({ deals: 2, unweighted: 200_000, weighted: 50_000 + 20_000 });
    expect(by.systems_integration).toMatchObject({ deals: 1, unweighted: 100_000, weighted: 50_000 });
    expect(by.staffing).toMatchObject({ deals: 0, unweighted: 0 });
    // Splitting never loses or invents value.
    expect(f.byServiceLine.reduce((s, l) => s + l.unweighted, 0)).toBe(f.totals.unweighted);
  });

  it("buckets by expected-close quarter, with overdue / later / undated kept separate", () => {
    const f = computeForecast(
      [
        opp({ value: 100, probability: 60, expected_close: "2026-12-31" }),
        opp({ value: 50, probability: 40, expected_close: "2026-10-01" }),
        opp({ value: 25, probability: 10, expected_close: "2027-02-01" }),
        opp({ value: 7, probability: 50, expected_close: "2026-09-30" }),
        opp({ value: 9, probability: 50, expected_close: "2027-10-01" }),
        opp({ value: 11, probability: 50, expected_close: null }),
      ],
      DEFAULT_SETTINGS,
      now,
    );
    const [q4, q1] = f.byQuarter;
    expect(q4).toMatchObject({ key: "2026-Q4", count: 2, unweighted: 150, weighted: 80, commit: 100, upside: 50, pipelineOnly: 0 });
    expect(q1).toMatchObject({ key: "2027-Q1", count: 1, unweighted: 25, commit: 0, upside: 0, pipelineOnly: 25 });
    expect(f.outside.overdue).toMatchObject({ count: 1, unweighted: 7 });
    expect(f.outside.later).toMatchObject({ count: 1, unweighted: 9 });
    expect(f.outside.undated).toMatchObject({ count: 1, unweighted: 11 });
    for (const q of f.byQuarter) expect(q.commit + q.upside + q.pipelineOnly).toBe(q.unweighted);
  });

  it("leaves deals in other currencies out of the totals", () => {
    const f = computeForecast([opp({ value: 100 }), opp({ value: 500, currency: "EUR" })], DEFAULT_SETTINGS, now);
    expect(f.totals.unweighted).toBe(100);
    expect(f.otherCurrency).toBe(1);
  });

  it("uses the org's stage settings (custom labels, closed stages)", () => {
    const settings = { stages: DEFAULT_SETTINGS.stages.map((s) => (s.key === "proposal" ? { ...s, label: "Writing" } : s)) };
    const f = computeForecast([opp({ stage: "proposal" })], settings, now);
    expect(f.byStage.find((s) => s.stage === "proposal")?.label).toBe("Writing");
  });
});

describe("forecastData scoping", () => {
  it("only counts deals the viewer can see", async () => {
    const exec = await asUser("exec");
    const bd = await switchUser(exec, "bd1");
    const all = await forecastData(exec);
    const mine = await forecastData(bd);
    expect(mine.totals.count).toBeLessThan(all.totals.count);
    const bdOpen = (await visibleOpportunities(bd)).filter((o) => !["won", "lost", "no_bid"].includes(o.stage));
    expect(mine.totals.unweighted).toBe(bdOpen.reduce((s, o) => s + o.value, 0));
  });
});
