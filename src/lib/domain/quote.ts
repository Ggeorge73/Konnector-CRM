import type { QuoteLine } from "./types";

export interface QuoteTotals {
  cost: number;
  price: number;
  margin: number;
  marginPct: number;
}

type Line = Pick<QuoteLine, "qty" | "unit_cost" | "unit_price">;

export function lineTotals(l: Line) {
  const cost = l.qty * l.unit_cost;
  const price = l.qty * l.unit_price;
  return { cost, price, margin: price - cost, marginPct: price > 0 ? ((price - cost) / price) * 100 : 0 };
}

export function quoteTotals(lines: Line[]): QuoteTotals {
  const cost = lines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
  const price = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  return { cost, price, margin: price - cost, marginPct: price > 0 ? ((price - cost) / price) * 100 : 0 };
}

/** Below the floor needs executive approval before the quote can be sent or published. */
export function needsMarginApproval(lines: Line[], floorPct: number) {
  const t = quoteTotals(lines);
  return lines.length > 0 && (t.marginPct < floorPct || lines.some((l) => lineTotals(l).marginPct < 0));
}
