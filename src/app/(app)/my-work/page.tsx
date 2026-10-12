import { MyWorkView } from "@/components/work/MyWorkView";
import { myTasks, recentViews, usersById, visibleAccounts, visibleOpportunities } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { taskRows, userOptions } from "@/lib/services/records";

export const metadata = { title: "My Work" };

export default async function MyWorkPage() {
  const c = await ctx("/my-work");
  const [tasks, recent, users, opps, accounts, mentions, items] = await Promise.all([
    myTasks(c),
    recentViews(c),
    usersById(c),
    visibleOpportunities(c),
    visibleAccounts(c),
    c.store.list("mentions", { where: { user_id: c.user.id }, orderBy: { column: "created_at", ascending: false }, limit: 20 }),
    c.store.list("client_items", { where: { owner_id: c.user.id } }),
  ]);
  const labels = new Map<string, string>([...opps.map((o) => [o.id, o.name] as const), ...accounts.map((a) => [a.id, a.name] as const)]);
  const contacts = await c.store.list("contacts");
  for (const ct of contacts) labels.set(ct.id, `${ct.first_name} ${ct.last_name}`);
  const mentionActs = (await Promise.all(mentions.map((m) => c.store.get("activities", m.activity_id)))).filter((a) => !!a);
  // Seeded activities carry mentions inline too; include those for the current user.
  const inline = (await c.store.list("activities", { orderBy: { column: "occurred_at", ascending: false } })).filter((a) =>
    a.mentions.includes(c.user.id),
  );
  const allMentions = [...new Map([...mentionActs, ...inline].map((a) => [a!.id, a!])).values()].sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at),
  );
  return (
    <MyWorkView
      firstName={c.user.full_name.split(" ")[0]}
      tasks={await taskRows(c, tasks, labels)}
      mentions={allMentions.map((a) => ({
        id: a.id,
        subject: a.subject,
        body: a.body,
        occurred_at: a.occurred_at,
        actor: a.actor_id ? (users.get(a.actor_id)?.full_name ?? "") : "System",
        related_type: a.related_type,
        related_id: a.related_id,
        label: labels.get(a.related_id) ?? "",
      }))}
      recent={recent.map((r) => ({ id: r.id, related_type: r.related_type, related_id: r.related_id, label: r.label, at: r.created_at }))}
      awaiting={items
        .filter((i) => i.status === "published" || i.status === "viewed")
        .map((i) => ({ id: i.id, title: i.title, status: i.status, respond_by: i.respond_by }))}
      users={await userOptions(c)}
    />
  );
}
