import { daysUntil } from "@/lib/format";
import type { Stage } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/data/seed";
import type { Ctx } from "./context-types";
import { visibleAccounts, visibleOpportunities } from "./core";

const OPEN: Stage[] = ["signal", "qualify", "capture", "bid_no_bid", "proposal", "submitted"];

export async function orgSettings(c: Ctx) {
  const [org] = await c.store.list("organizations");
  return org?.settings ?? DEFAULT_SETTINGS;
}

/** Everything the Pulse home needs, scoped to what the viewer can see. */
export async function pulseData(c: Ctx) {
  const [opps, accounts, regs, health, items, settings] = await Promise.all([
    visibleOpportunities(c),
    visibleAccounts(c),
    c.store.list("registrations"),
    c.store.list("project_health"),
    c.store.list("client_items"),
    orgSettings(c),
  ]);
  const open = opps.filter((o) => OPEN.includes(o.stage));
  const pipeline = open.reduce((s, o) => s + o.value, 0);
  const weighted = open.reduce((s, o) => s + (o.value * o.probability) / 100, 0);
  const decided = opps.filter((o) => o.stage === "won" || o.stage === "lost");
  const won = decided.filter((o) => o.stage === "won");
  const winRate = decided.length ? Math.round((won.length / decided.length) * 100) : 0;
  const due14 = open
    .filter((o) => {
      const d = daysUntil(o.proposal_due, c.now);
      return d !== null && d >= 0 && d <= 14;
    })
    .sort((a, b) => (a.proposal_due ?? "").localeCompare(b.proposal_due ?? ""));
  const expiring = regs
    .filter((r) => {
      const d = daysUntil(r.expires_on, c.now);
      return d !== null && d <= 45;
    })
    .sort((a, b) => (a.expires_on ?? "").localeCompare(b.expires_on ?? ""));
  const visibleAccountIds = new Set(accounts.map((a) => a.id));
  const projects = health.filter((h) => !h.account_id || visibleAccountIds.has(h.account_id));
  const atRisk = projects.filter((h) => [h.health_schedule, h.health_budget, h.health_acceptance].some((r) => r !== "green"));
  const liveAccounts = new Set(projects.map((h) => h.account_id));
  const awaiting = items.filter((i) => (i.status === "published" || i.status === "viewed") && visibleAccountIds.has(i.account_id));

  const byStage = settings.stages
    .filter((s) => OPEN.includes(s.key))
    .map((s) => {
      const inStage = open.filter((o) => o.stage === s.key);
      return { stage: s.label, value: inStage.reduce((x, o) => x + o.value, 0), count: inStage.length };
    });

  // Won/created value over the last six months for the trend chart.
  const months = [...Array(6)].map((_, i) => {
    const d = new Date(c.now.getFullYear(), c.now.getMonth() - (5 - i), 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short" }) };
  });
  const trend = months.map((m) => ({
    month: m.label,
    created: opps.filter((o) => o.created_at.startsWith(m.key)).reduce((s, o) => s + o.value, 0),
    won: won.filter((o) => (o.expected_close ?? "").startsWith(m.key)).reduce((s, o) => s + o.value, 0),
  }));

  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  return {
    kpis: {
      pipeline,
      weighted,
      winRate,
      bidsDue14: due14.length,
      regsExpiring: expiring.length,
      projectsAtRisk: atRisk.length,
      openCount: open.length,
    },
    byStage,
    trend,
    deadlines: due14
      .slice(0, 6)
      .map((o) => ({ id: o.id, name: o.name, account: accName.get(o.account_id) ?? "", proposal_due: o.proposal_due, value: o.value })),
    expiring: expiring.map((r) => ({ id: r.id, name: r.name, expires_on: r.expires_on })),
    atRisk: atRisk.map((h) => ({ ...h, account: h.account_id ? (accName.get(h.account_id) ?? "") : "" })),
    awaiting: awaiting.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      respond_by: i.respond_by,
      account: accName.get(i.account_id) ?? "",
    })),
    globe: accounts
      .filter((a) => a.lat !== null && a.lng !== null)
      .map((a) => ({ id: a.id, name: a.name, lat: a.lat!, lng: a.lng!, live: liveAccounts.has(a.id), weight: a.tier === "A" ? 2 : 1 })),
  };
}

export type PulseData = Awaited<ReturnType<typeof pulseData>>;
