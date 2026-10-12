import { PipelineView } from "@/components/opportunities/PipelineView";
import { canEditOpportunity, isLeader } from "@/lib/auth/permissions";
import { usersById, visibleAccounts, visibleOpportunities } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { latestBidDecision } from "@/lib/services/capture";
import { orgSettings } from "@/lib/services/pulse";
import { savedViews } from "@/lib/services/views";

export const metadata = { title: "Pipeline" };

export default async function OpportunitiesPage() {
  const c = await ctx("/opportunities");
  const [opps, accounts, users, settings, views] = await Promise.all([
    visibleOpportunities(c),
    visibleAccounts(c),
    usersById(c),
    orgSettings(c),
    savedViews(c, "opportunities"),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const decisions = await Promise.all(opps.map((o) => latestBidDecision(c, o.id)));
  return (
    <PipelineView
      rows={opps.map((o, i) => ({
        ...o,
        account_name: acc.get(o.account_id) ?? "—",
        owner_name: users.get(o.owner_id)?.full_name ?? "—",
        owner_color: users.get(o.owner_id)?.avatar_color ?? "#0075FF",
        bid_approved: decisions[i]?.status === "approved" && decisions[i]?.verdict !== "no_bid",
        can_edit: canEditOpportunity(c.user, o),
      }))}
      stages={settings.stages}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      owners={[...users.values()].filter((u) => u.role !== "delivery_lead").map((u) => ({ id: u.id, name: u.full_name }))}
      views={views.map((v) => ({ id: v.id, name: v.name, query: v.query }))}
      canAssign={isLeader(c.user)}
      canCreate={c.user.role !== "delivery_lead"}
      isRecruiter={c.user.role === "recruiter"}
    />
  );
}
