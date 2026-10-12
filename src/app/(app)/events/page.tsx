import { EventsView } from "@/components/events/EventsView";
import { usersById } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { listEvents } from "@/lib/services/events";

export const metadata = { title: "BD events" };

export default async function EventsPage() {
  const c = await ctx("/events");
  const [events, users] = await Promise.all([listEvents(c), usersById(c)]);
  const cards = events.map((e) => ({
    ...e,
    attendees: e.attendee_ids
      .map((id) => users.get(id))
      .filter((u) => !!u)
      .map((u) => ({ id: u!.id, name: u!.full_name, color: u!.avatar_color })),
  }));
  return (
    <EventsView
      events={cards}
      today={c.now.toISOString().slice(0, 10)}
      users={[...users.values()].map((u) => ({ id: u.id, name: u.full_name }))}
      currentUserId={c.user.id}
    />
  );
}
