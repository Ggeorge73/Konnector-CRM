import { describe, expect, it } from "vitest";
import { daysUntil, humanize, initials, money } from "@/lib/format";
import { scoreBid, verdictFor } from "@/lib/domain/bid";
import { DEFAULT_BID_WEIGHTS } from "@/lib/data/seed";

describe("format", () => {
  it("formats money with currency", () => {
    expect(money(2450000)).toBe("$2,450,000");
    expect(money(12.5)).toBe("$12.50");
    expect(money(2450000, "USD", { compact: true })).toBe("$2.5M");
    expect(money(0, "USD", { compact: true })).toBe("$0");
    expect(money(380000, "EUR", { compact: true })).toBe("€380K");
    expect(money(1500, "CAD", { compact: true })).toBe("1.5K CAD");
    expect(money(null)).toBe("—");
  });
  it("counts days to a deadline", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    expect(daysUntil("2026-10-21", now)).toBe(9);
    expect(daysUntil("2026-10-10", now)).toBe(-2);
    expect(daysUntil(null, now)).toBeNull();
  });
  it("humanizes and initials", () => {
    expect(humanize("bid_no_bid")).toBe("Bid no bid");
    expect(initials("Olugbenga George")).toBe("OG");
  });
});

describe("bid scoring", () => {
  it("weights scores out of 100 and picks a verdict", () => {
    const all5 = Object.fromEntries(Object.keys(DEFAULT_BID_WEIGHTS).map((k) => [k, 5])) as never;
    const all3 = Object.fromEntries(Object.keys(DEFAULT_BID_WEIGHTS).map((k) => [k, 3])) as never;
    expect(scoreBid(all5, DEFAULT_BID_WEIGHTS)).toBe(100);
    expect(scoreBid(all3, DEFAULT_BID_WEIGHTS)).toBe(60);
    expect(verdictFor(75)).toBe("bid");
    expect(verdictFor(60)).toBe("conditional");
    expect(verdictFor(40)).toBe("no_bid");
  });
});
