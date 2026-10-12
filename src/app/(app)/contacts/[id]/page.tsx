import { notFound } from "next/navigation";
import { ContactDetail } from "@/components/contacts/ContactDetail";
import { ForbiddenError } from "@/lib/auth/errors";
import { getContact, recordView, usersById, visibleOpportunities } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { peopleNames, relatedTasks, timelineItems, userOptions } from "@/lib/services/records";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx("/contacts");
  const { contact, account } = await getContact(c, id).catch((e) => {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  });
  const name = `${contact.first_name} ${contact.last_name}`;
  await recordView(c, "contact", id, name);
  const [users, opps, timeline, tasks, people, options, leads] = await Promise.all([
    usersById(c),
    visibleOpportunities(c).then((o) => o.filter((x) => x.account_id === account.id)),
    timelineItems(c, "contact", id),
    relatedTasks(c, "contact", id),
    peopleNames(c),
    userOptions(c),
    c.store.list("event_leads", { where: { contact_id: id } }),
  ]);
  const events = await Promise.all(leads.map((l) => c.store.get("events", l.event_id)));
  return (
    <ContactDetail
      contact={contact}
      account={{ id: account.id, name: account.name }}
      ownerName={users.get(contact.owner_id)?.full_name ?? "—"}
      opportunities={opps.map((o) => ({ id: o.id, name: o.name, stage: o.stage, value: o.value }))}
      events={events.filter((e) => !!e).map((e) => ({ id: e!.id, name: e!.name, starts_on: e!.starts_on }))}
      timeline={timeline}
      tasks={tasks}
      people={people}
      users={options}
      currentUserId={c.user.id}
    />
  );
}
