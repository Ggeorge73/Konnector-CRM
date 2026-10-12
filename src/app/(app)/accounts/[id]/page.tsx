import { notFound } from "next/navigation";
import { AccountDetail } from "@/components/accounts/AccountDetail";
import { ForbiddenError } from "@/lib/auth/errors";
import { canEditAccount, isLeader } from "@/lib/auth/permissions";
import { getAccount, recordView, usersById, visibleOpportunities } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { filesFor } from "@/lib/services/files";
import { peopleNames, relatedTasks, timelineItems, userOptions } from "@/lib/services/records";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx("/accounts");
  const account = await getAccount(c, id).catch((e) => {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  });
  await recordView(c, "account", id, account.name);
  const [users, contacts, opps, health, handoffs, files, tasks, people, options, items] = await Promise.all([
    usersById(c),
    c.store.list("contacts", { where: { account_id: id }, orderBy: { column: "last_name" } }),
    visibleOpportunities(c).then((o) => o.filter((x) => x.account_id === id)),
    c.store.list("project_health", { where: { account_id: id } }),
    c.store.list("handoffs"),
    filesFor(c, "account", id),
    relatedTasks(c, "account", id),
    peopleNames(c),
    userOptions(c),
    c.store.list("client_items", { where: { account_id: id }, orderBy: { column: "created_at", ascending: false } }),
  ]);
  const labels = new Map(opps.map((o) => [o.id, o.name]));
  const timeline = await timelineItems(c, "account", id, labels);
  const hubUrl = new Map(handoffs.map((h) => [h.konnect_hub_project_id, h.konnect_hub_url]));
  return (
    <AccountDetail
      account={account}
      ownerName={users.get(account.owner_id)?.full_name ?? "—"}
      contacts={contacts}
      opportunities={opps.map((o) => ({ ...o, owner_name: users.get(o.owner_id)?.full_name ?? "—" }))}
      health={health.map((h) => ({ ...h, hub_url: hubUrl.get(h.konnect_hub_project_id) ?? null }))}
      clientItems={items
        .filter((i) => i.status !== "superseded")
        .map((i) => ({ id: i.id, title: i.title, type: i.type, status: i.status, respond_by: i.respond_by, version: i.version }))}
      timeline={timeline}
      tasks={tasks}
      files={files}
      people={people}
      users={options}
      currentUserId={c.user.id}
      canEdit={canEditAccount(c.user, account)}
      canAssign={isLeader(c.user)}
      owners={options}
    />
  );
}
