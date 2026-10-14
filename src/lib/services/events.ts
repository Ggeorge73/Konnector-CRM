/**
 * BD events (summits, expos, procurement fairs) and lead capture. A captured lead
 * links a contact to the event and creates a follow-up task for the capturing user.
 * Leads follow the contact's account visibility (mirrors event_leads RLS).
 */
import { z } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { hasRole, isLeader, type Who } from "@/lib/auth/permissions";
import { ACCOUNT_TYPES, type Account, type BdEvent, type Contact, type EventLead, type Task } from "@/lib/domain/types";
import { audit, diff } from "./audit";
import type { Ctx } from "./context-types";
import { createAccount, createContact, createTask, getAccount, getContact, logActivity, visibleAccounts } from "./core";
import { actorId } from "./system";

export const EVENT_KINDS = ["summit", "expo", "procurement_fair", "conference", "webinar"] as const;

export const canRunEvents = (u: Who) => isLeader(u) || u.role === "bd";

function assertEvents(c: Ctx) {
  if (!canRunEvents(c.user)) throw new ForbiddenError("BD events are for business development and leadership.");
}

/** Leads the viewer may see: those whose contact's account is visible. */
async function visibleLeads(c: Ctx, where: { event_id?: string } = {}) {
  const [leads, accounts, contacts] = await Promise.all([
    c.store.list("event_leads", { where, orderBy: { column: "created_at", ascending: false } }),
    visibleAccounts(c),
    c.store.list("contacts"),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const ct = new Map(contacts.map((x) => [x.id, x]));
  const out: Array<{ lead: EventLead; contact: Contact; account: Account }> = [];
  for (const lead of leads) {
    const contact = ct.get(lead.contact_id);
    const account = contact ? acc.get(contact.account_id) : undefined;
    if (contact && account) out.push({ lead, contact, account });
  }
  return out;
}

export type EventSummary = BdEvent & { lead_count: number };

export async function listEvents(c: Ctx): Promise<EventSummary[]> {
  assertEvents(c);
  const [events, leads] = await Promise.all([c.store.list("events", { orderBy: { column: "starts_on" } }), visibleLeads(c)]);
  const counts = new Map<string, number>();
  for (const l of leads) counts.set(l.lead.event_id, (counts.get(l.lead.event_id) ?? 0) + 1);
  return events.map((e) => ({ ...e, lead_count: counts.get(e.id) ?? 0 }));
}

export interface EventLeadDetail {
  lead: EventLead;
  contact: Contact;
  account: Pick<Account, "id" | "name" | "type">;
  task: Task | null;
}

export async function getEvent(c: Ctx, id: string): Promise<{ event: BdEvent; leads: EventLeadDetail[] }> {
  assertEvents(c);
  const event = await c.store.get("events", id);
  if (!event || event.archived_at) throw new ForbiddenError("Event not found.");
  const leads = await visibleLeads(c, { event_id: id });
  const tasks = await Promise.all(leads.map((l) => (l.lead.follow_up_task_id ? c.store.get("tasks", l.lead.follow_up_task_id) : null)));
  return {
    event,
    leads: leads.map((l, i) => ({
      lead: l.lead,
      contact: l.contact,
      account: { id: l.account.id, name: l.account.name, type: l.account.type },
      task: tasks[i] ?? null,
    })),
  };
}

// ---------------- Create / edit ----------------

const ymdStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");

export const EventInput = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(160),
    kind: z.enum(EVENT_KINDS),
    starts_on: ymdStr,
    ends_on: ymdStr,
    location: z.string().trim().min(2, "Location is required").max(160),
    budget: z.number({ error: "Budget is required" }).min(0, "Budget can't be negative").max(10_000_000),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase())
      .default("USD"),
    attendee_ids: z.array(z.string().uuid()).max(50).default([]),
    notes: z
      .string()
      .trim()
      .max(4000)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
  })
  .refine((v) => v.ends_on >= v.starts_on, { message: "Ends on must be on or after the start", path: ["ends_on"] });
export type EventInputT = z.input<typeof EventInput>;

export async function saveEvent(c: Ctx, input: EventInputT, id?: string): Promise<BdEvent> {
  assertEvents(c);
  const v = EventInput.parse(input);
  const users = new Set((await c.store.list("users")).filter(hasRole).map((u) => u.id));
  const attendees = v.attendee_ids.filter((a) => users.has(a));
  if (!id) {
    const row = await c.store.insert("events", {
      org_id: c.user.org_id,
      name: v.name,
      kind: v.kind,
      starts_on: v.starts_on,
      ends_on: v.ends_on,
      location: v.location,
      budget: v.budget,
      currency: v.currency,
      attendee_ids: attendees,
      notes: v.notes ?? null,
      created_by: actorId(c),
    });
    await audit(c, "event.created", "events", row.id, null, { name: row.name, budget: row.budget, currency: row.currency });
    await logActivity(c, { type: "system", subject: "Event created", related_type: "event", related_id: row.id });
    return row;
  }
  const before = await c.store.get("events", id);
  if (!before || before.archived_at) throw new ForbiddenError("Event not found.");
  const patch: Partial<BdEvent> = {
    name: v.name,
    kind: v.kind,
    starts_on: v.starts_on,
    ends_on: v.ends_on,
    location: v.location,
    budget: v.budget,
    currency: v.currency,
    attendee_ids: attendees,
    notes: v.notes ?? null,
  };
  const d = diff(before, patch);
  if (!d.changed) return before;
  const row = await c.store.update("events", id, patch);
  if ("budget" in d.after || "currency" in d.after) {
    await audit(
      c,
      "event.budget_changed",
      "events",
      id,
      { budget: before.budget, currency: before.currency },
      { budget: row.budget, currency: row.currency },
    );
  }
  await logActivity(c, { type: "system", subject: "Event details updated", related_type: "event", related_id: id });
  return row;
}

// ---------------- Lead capture ----------------

const nullableStr = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const NewContact = z
  .object({
    account_id: z.string().uuid().nullable().optional(),
    new_account: z
      .object({
        name: z.string().trim().min(2, "Organisation name is required").max(160),
        type: z.enum(ACCOUNT_TYPES),
      })
      .nullable()
      .optional(),
    first_name: z.string().trim().min(1, "First name is required").max(80),
    last_name: z.string().trim().min(1, "Last name is required").max(80),
    title: nullableStr,
    email: z
      .string()
      .trim()
      .email("Enter a valid email")
      .or(z.literal(""))
      .transform((v) => v || null)
      .nullable()
      .optional(),
  })
  .refine((v) => !!v.account_id || !!v.new_account, { message: "Pick an account or add a new organisation", path: ["account_id"] });

export const LeadInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), contact_id: z.string().uuid("Pick a contact"), interest: nullableStr }),
  z.object({ mode: z.literal("new"), contact: NewContact, interest: nullableStr }),
]);
export type LeadInputT = z.input<typeof LeadInput>;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function addBusinessDays(dateYmd: string, n: number): string {
  const d = new Date(`${dateYmd}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return ymd(d);
}

/**
 * Follow-up due date: 2 business days after the event ends, or 2 days from now if the
 * event is already over. Due at 17:00 US Eastern (21:00 UTC) on that day.
 */
export function followUpDueAt(event: Pick<BdEvent, "ends_on">, now: Date): string {
  const today = ymd(now);
  const day = event.ends_on < today ? ymd(new Date(now.getTime() + 2 * 86_400_000)) : addBusinessDays(event.ends_on, 2);
  return `${day}T21:00:00.000Z`;
}

export async function captureLead(c: Ctx, eventId: string, input: LeadInputT): Promise<EventLead> {
  assertEvents(c);
  const event = await c.store.get("events", eventId);
  if (!event || event.archived_at) throw new ForbiddenError("Event not found.");
  const v = LeadInput.parse(input);

  let contact: Contact;
  let accountId: string;
  if (v.mode === "existing") {
    const r = await getContact(c, v.contact_id);
    contact = r.contact;
    accountId = r.account.id;
    const dup = await c.store.list("event_leads", { where: { event_id: eventId, contact_id: contact.id } });
    if (dup.length) throw new ValidationError(`${contact.first_name} ${contact.last_name} is already a lead for this event.`);
  } else {
    const n = v.contact;
    if (n.new_account) {
      const account = await createAccount(c, {
        name: n.new_account.name,
        type: n.new_account.type,
        sector: "To be confirmed",
        country: "US",
        tier: "C",
        status: "prospect",
        description: `Met at ${event.name}.`,
      });
      accountId = account.id;
    } else {
      accountId = (await getAccount(c, n.account_id!)).id;
    }
    contact = await createContact(c, {
      account_id: accountId,
      first_name: n.first_name,
      last_name: n.last_name,
      title: n.title ?? null,
      email: n.email ?? null,
    });
  }

  const name = `${contact.first_name} ${contact.last_name}`;
  const task = await createTask(c, {
    title: `Follow up with ${name} (met at ${event.name})`.slice(0, 200),
    due_at: followUpDueAt(event, c.now),
    assignee_id: c.user.id,
    priority: "medium",
    related_type: "contact",
    related_id: contact.id,
    account_id: accountId,
    notes: v.interest ?? null,
  });
  const lead = await c.store.insert("event_leads", {
    event_id: eventId,
    contact_id: contact.id,
    interest: v.interest ?? null,
    follow_up_task_id: task.id,
    created_by: actorId(c),
  });
  await logActivity(c, {
    type: "meeting",
    subject: `Met at ${event.name}`,
    body: v.interest ? `Interest: ${v.interest}` : null,
    related_type: "contact",
    related_id: contact.id,
    account_id: accountId,
  });
  await logActivity(c, {
    type: "system",
    subject: `Lead captured: ${name}`,
    related_type: "event",
    related_id: eventId,
  });
  return lead;
}
