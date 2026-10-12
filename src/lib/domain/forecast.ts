/**
 * Pipeline forecast maths (pure): open pipeline by stage, service line and expected-close
 * quarter, unweighted vs weighted (value × probability), and commit / best case / pipeline.
 * Scoped to the viewer by `forecastData` in lib/services/forecast.ts.
 */
import { SERVICE_LINES, type Opportunity, type OrgSettings, type ServiceLine, type Stage } from "./types";

/** Probability thresholds (percent) for the forecast categories. */
export const COMMIT_MIN = 60;
export const BEST_CASE_MIN = 35;
export const BASE_CURRENCY = "USD";

export type ForecastCategory = "commit" | "best_case" | "pipeline";

export interface Amounts {
  unweighted: number;
  weighted: number;
}

export interface ForecastQuarter extends Amounts {
  key: string; // "2026-Q4"
  label: string; // "Q4 2026"
  start: string; // ISO date, inclusive
  end: string; // ISO date, inclusive
  count: number;
  /** Unweighted value in each exclusive band; the three sum to `unweighted`. */
  commit: number;
  upside: number;
  pipelineOnly: number;
}

export interface ForecastData {
  currency: string;
  totals: Amounts & { count: number; commit: number; bestCase: number; pipeline: number };
  byStage: Array<Amounts & { stage: Stage; label: string; probability: number; count: number }>;
  byServiceLine: Array<Amounts & { line: ServiceLine; deals: number }>;
  byQuarter: ForecastQuarter[];
  /** Open pipeline that falls outside the four quarters. */
  outside: { overdue: Amounts & { count: number }; later: Amounts & { count: number }; undated: Amounts & { count: number } };
  /** Open deals in another currency, left out of the totals rather than mixed in. */
  otherCurrency: number;
}

export function categoryFor(probability: number): ForecastCategory {
  if (probability >= COMMIT_MIN) return "commit";
  if (probability >= BEST_CASE_MIN) return "best_case";
  return "pipeline";
}

const weightedOf = (o: Pick<Opportunity, "value" | "probability">) => (o.value * o.probability) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** The current calendar quarter plus the next `n - 1`. */
export function quartersFrom(now: Date, n = 4) {
  const q0 = Math.floor(now.getUTCMonth() / 3);
  return [...Array(n)].map((_, i) => {
    const idx = q0 + i;
    const year = now.getUTCFullYear() + Math.floor(idx / 4);
    const q = idx % 4;
    return {
      key: `${year}-Q${q + 1}`,
      label: `Q${q + 1} ${year}`,
      start: iso(year, q * 3, 1),
      end: iso(year, q * 3 + 3, 0),
    };
  });
}

export function computeForecast(opps: Opportunity[], settings: Pick<OrgSettings, "stages">, now: Date): ForecastData {
  const openStages = settings.stages.filter((s) => !s.closed);
  const openKeys = new Set(openStages.map((s) => s.key));
  const all = opps.filter((o) => !o.archived_at && openKeys.has(o.stage));
  const open = all.filter((o) => o.currency === BASE_CURRENCY);

  const zero = () => ({ unweighted: 0, weighted: 0, count: 0 });
  const add = (m: { unweighted: number; weighted: number; count?: number }, o: Opportunity, share = 1) => {
    m.unweighted += o.value * share;
    m.weighted += weightedOf(o) * share;
    if (m.count !== undefined) m.count += 1;
  };

  const totals = { ...zero(), commit: 0, bestCase: 0, pipeline: 0 };
  for (const o of open) {
    add(totals, o);
    const cat = categoryFor(o.probability);
    if (cat === "commit") totals.commit += o.value;
    if (cat !== "pipeline") totals.bestCase += o.value;
    totals.pipeline += o.value;
  }

  const byStage = openStages.map((s) => {
    const m = { stage: s.key, label: s.label, probability: s.probability, ...zero() };
    for (const o of open) if (o.stage === s.key) add(m, o);
    return m;
  });

  const byServiceLine = SERVICE_LINES.map((line) => {
    const m = { line, unweighted: 0, weighted: 0, deals: 0 };
    for (const o of open) {
      const lines = o.service_lines.length ? o.service_lines : [];
      if (!lines.includes(line)) continue;
      add(m, o, 1 / lines.length);
      m.deals += 1;
    }
    return m;
  });

  const quarters = quartersFrom(now);
  const byQuarter: ForecastQuarter[] = quarters.map((q) => ({ ...q, ...zero(), commit: 0, upside: 0, pipelineOnly: 0 }));
  const outside = { overdue: zero(), later: zero(), undated: zero() };
  for (const o of open) {
    const d = o.expected_close?.slice(0, 10);
    if (!d) {
      add(outside.undated, o);
      continue;
    }
    if (d < quarters[0].start) {
      add(outside.overdue, o);
      continue;
    }
    const q = byQuarter.find((x) => d >= x.start && d <= x.end);
    if (!q) {
      add(outside.later, o);
      continue;
    }
    add(q, o);
    const cat = categoryFor(o.probability);
    if (cat === "commit") q.commit += o.value;
    else if (cat === "best_case") q.upside += o.value;
    else q.pipelineOnly += o.value;
  }

  const r = <T extends { unweighted: number; weighted: number }>(m: T): T => ({
    ...m,
    unweighted: round2(m.unweighted),
    weighted: round2(m.weighted),
  });
  return {
    currency: BASE_CURRENCY,
    totals: r(totals),
    byStage: byStage.map(r),
    byServiceLine: byServiceLine.map(r),
    byQuarter: byQuarter.map(r),
    outside: { overdue: r(outside.overdue), later: r(outside.later), undated: r(outside.undated) },
    otherCurrency: all.length - open.length,
  };
}
