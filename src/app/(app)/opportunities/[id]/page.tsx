import { notFound } from "next/navigation";
import { OpportunityDetail } from "@/components/opportunities/OpportunityDetail";
import { ForbiddenError } from "@/lib/auth/errors";
import { canApprove, canEditOpportunity, canRunHandoff, canSeeBench, isLeader } from "@/lib/auth/permissions";
import { staffingMatches } from "@/lib/services/bench";
import { bidDecisionsFor, getOpportunity, visibleQuotes } from "@/lib/services/capture";
import { getAccount, recordView, usersById, visibleAccounts } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { filesFor } from "@/lib/services/files";
import { orgSettings } from "@/lib/services/pulse";
import { peopleNames, relatedTasks, timelineItems, userOptions } from "@/lib/services/records";

export default async function OpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; handoff?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await ctx("/opportunities");
  const o = await getOpportunity(c, id).catch((e) => {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  });
  await recordView(c, "opportunity", id, o.name);
  const [account, users, bids, quotes, settings, timeline, tasks, files, people, options, accounts, handoffs, health] = await Promise.all([
    getAccount(c, o.account_id),
    usersById(c),
    bidDecisionsFor(c, o),
    visibleQuotes(c).then((q) => q.filter((x) => x.opportunity_id === id)),
    orgSettings(c),
    timelineItems(c, "opportunity", id),
    relatedTasks(c, "opportunity", id),
    filesFor(c, "opportunity", id),
    peopleNames(c),
    userOptions(c),
    visibleAccounts(c),
    c.store.list("handoffs", { where: { opportunity_id: id }, orderBy: { column: "created_at", ascending: false } }),
    c.store.list("project_health", { where: { opportunity_id: id } }),
  ]);
  const contacts = await c.store.list("contacts", { where: { account_id: o.account_id } });
  const staffing = canSeeBench(c.user) && !["lost", "no_bid"].includes(o.stage) ? await staffingMatches(c, id) : null;
  return (
    <OpportunityDetail
      opportunity={o}
      account={{ id: account.id, name: account.name, type: account.type }}
      ownerName={users.get(o.owner_id)?.full_name ?? "—"}
      sharedNames={o.shared_with.map((u) => users.get(u)?.full_name ?? "").filter(Boolean)}
      stages={settings.stages}
      bids={bids}
      weights={settings.bid_weights}
      marginFloor={settings.margin_floor_pct}
      quotes={quotes}
      partners={accounts
        .filter((a) => a.type === "oem_vendor" || a.type === "partner_subcontractor")
        .map((a) => ({ id: a.id, name: a.name }))}
      timeline={timeline}
      tasks={tasks}
      files={files}
      people={people}
      users={options}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      handoff={handoffs[0] ?? null}
      health={health[0] ?? null}
      currentUserId={c.user.id}
      canEdit={canEditOpportunity(c.user, o)}
      canApprove={canApprove(c.user)}
      canAssign={isLeader(c.user)}
      canHandoff={canRunHandoff(c.user)}
      initialTab={sp.tab}
      openHandoff={sp.handoff === "1"}
      staffing={staffing}
      handoffCtx={{
        opportunityId: o.id,
        opportunityName: o.name,
        value: o.value,
        currency: o.currency,
        won: o.stage === "won",
        canHandoff: canRunHandoff(c.user),
        contacts: contacts.map((x) => ({ id: x.id, name: `${x.first_name} ${x.last_name}`, email: x.email, title: x.title })),
        leads: [...users.values()]
          .filter((u) => u.role === "delivery_lead" || u.role === "admin")
          .map((u) => ({ id: u.id, name: u.full_name })),
        files: files.map((f) => ({ id: f.id, name: f.name })),
        handoff: handoffs[0] ?? null,
        health: health[0] ?? null,
      }}
    />
  );
}
