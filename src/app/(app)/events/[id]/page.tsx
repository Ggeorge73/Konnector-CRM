import { notFound } from "next/navigation";
import { EventDetail } from "@/components/events/EventDetail";
import { ForbiddenError } from "@/lib/auth/errors";
import { recordView, usersById, visibleAccounts, visibleContacts } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { followUpDueAt, getEvent } from "@/lib/services/events";
import { peopleNames, timelineItems } from "@/lib/services/records";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx("/events");
  const { event, leads } = await getEvent(c, id).catch((e) => {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  });
  await recordView(c, "event", id, event.name);
  const [users, timeline, people, contacts, accounts] = await Promise.all([
    usersById(c),
    timelineItems(c, "event", id),
    peopleNames(c),
    visibleContacts(c),
    visibleAccounts(c),
  ]);
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  return (
    <EventDetail
      event={event}
      leads={leads.map((l) => ({
        id: l.lead.id,
        interest: l.lead.interest,
        contact: { id: l.contact.id, name: `${l.contact.first_name} ${l.contact.last_name}`, title: l.contact.title },
        account: { id: l.account.id, name: l.account.name },
        task: l.task
          ? { id: l.task.id, status: l.task.status, due_at: l.task.due_at, assignee_name: users.get(l.task.assignee_id)?.full_name ?? "—" }
          : null,
      }))}
      attendees={event.attendee_ids
        .map((uid) => users.get(uid))
        .filter((u) => !!u)
        .map((u) => ({ id: u!.id, name: u!.full_name, color: u!.avatar_color, title: u!.title }))}
      timeline={timeline}
      people={people}
      users={[...users.values()].map((u) => ({ id: u.id, name: u.full_name }))}
      contacts={contacts.map((x) => ({
        id: x.id,
        name: `${x.first_name} ${x.last_name}`,
        title: x.title,
        account: accName.get(x.account_id) ?? "",
      }))}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      dueHint={followUpDueAt(event, c.now)}
      today={c.now.toISOString().slice(0, 10)}
      currentUserId={c.user.id}
    />
  );
}
