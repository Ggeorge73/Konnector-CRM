import { QuotesView } from "@/components/quotes/QuotesView";
import { visibleQuotes } from "@/lib/services/capture";
import { visibleAccounts, visibleOpportunities } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { orgSettings } from "@/lib/services/pulse";

export const metadata = { title: "Quotes" };

export default async function QuotesPage() {
  const c = await ctx("/quotes");
  const [quotes, accounts, opps, settings] = await Promise.all([
    visibleQuotes(c),
    visibleAccounts(c),
    visibleOpportunities(c),
    orgSettings(c),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const opp = new Map(opps.map((o) => [o.id, o.name]));
  return (
    <QuotesView
      marginFloor={settings.margin_floor_pct}
      rows={quotes.map((q) => ({
        id: q.id,
        number: q.number,
        title: q.title,
        status: q.status,
        account: acc.get(q.account_id) ?? "",
        opportunity: opp.get(q.opportunity_id) ?? "",
        opportunity_id: q.opportunity_id,
        price: q.totals.price,
        margin_pct: q.totals.marginPct,
        below_floor: q.belowFloor,
        currency: q.currency,
        valid_until: q.valid_until,
      }))}
    />
  );
}
