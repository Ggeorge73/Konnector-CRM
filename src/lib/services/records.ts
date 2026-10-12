import type { TimelineItem } from "@/components/kit/Timeline";
import type { RelatedType, Task } from "@/lib/domain/types";
import type { Ctx } from "./context-types";
import { hrefFor, tasksFor, timelineFor, usersById } from "./core";

/** Timeline rows with actor names resolved, ready for the client. */
export async function timelineItems(c: Ctx, type: RelatedType, id: string, labels?: Map<string, string>): Promise<TimelineItem[]> {
  const [acts, users] = await Promise.all([timelineFor(c, type, id), usersById(c)]);
  return acts.map((a) => ({
    id: a.id,
    type: a.type,
    subject: a.subject,
    body: a.body,
    occurred_at: a.occurred_at,
    actorName: a.actor_id ? (users.get(a.actor_id)?.full_name ?? "Unknown") : null,
    reactions: a.reactions,
    contextLabel: a.related_type !== type || a.related_id !== id ? labels?.get(a.related_id) : undefined,
    contextHref: a.related_type !== type || a.related_id !== id ? hrefFor(a.related_type, a.related_id) : undefined,
  }));
}

export async function taskRows(c: Ctx, tasks: Task[], labels?: Map<string, string>) {
  const users = await usersById(c);
  return tasks.map((t) => ({
    ...t,
    assignee_name: users.get(t.assignee_id)?.full_name ?? "—",
    context: t.related_id ? labels?.get(t.related_id) : undefined,
    href: t.related_type && t.related_id ? hrefFor(t.related_type, t.related_id) : null,
  }));
}

export async function relatedTasks(c: Ctx, type: RelatedType, id: string) {
  return taskRows(c, await tasksFor(c, type, id));
}

export async function peopleNames(c: Ctx) {
  return [...(await usersById(c)).values()].map((u) => u.full_name);
}

export async function userOptions(c: Ctx) {
  return [...(await usersById(c)).values()].map((u) => ({ id: u.id, name: u.full_name }));
}
