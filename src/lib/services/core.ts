/**
 * Core CRM services: scoping, accounts, contacts, timeline, tasks, notifications, search.
 * Pure over the Store port — unit-tested against MemoryStore without a server.
 */
import { z } from "zod";
import { canEditAccount, canSeeAccount, canSeeBench, canSeeOpportunity, hasRole, isLeader } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  ACTIVITY_TYPES,
  BUYING_ROLES,
  type Account,
  type Activity,
  type Contact,
  type Opportunity,
  type RelatedType,
  type Task,
  type User,
} from "@/lib/domain/types";
import { audit, diff } from "./audit";
import type { Ctx } from "./context-types";
import { actorId } from "./system";
import { emitEvent, webhookData } from "./webhooks";

// ---------------- Scoping ----------------

export async function visibleOpportunities(c: Ctx, opts: { includeClosed?: boolean } = {}): Promise<Opportunity[]> {
  const all = await c.store.list("opportunities");
  return all.filter((o) => canSeeOpportunity(c.user, o) && (opts.includeClosed !== false || !["won", "lost", "no_bid"].includes(o.stage)));
}

export async function visibleAccounts(c: Ctx): Promise<Account[]> {
  const [accounts, opps] = await Promise.all([c.store.list("accounts", { orderBy: { column: "name" } }), visibleOpportunities(c)]);
  return accounts.filter((a) => canSeeAccount(c.user, a, opps));
}

export async function getAccount(c: Ctx, id: string): Promise<Account> {
  const a = await c.store.get("accounts", id);
  if (!a || a.archived_at) throw new ForbiddenError("Account not found.");
  const opps = await visibleOpportunities(c);
  if (!canSeeAccount(c.user, a, opps)) throw new ForbiddenError("You don't have access to this account.");
  return a;
}

/** Everyone with a role (owners, assignees, mentions). Pending people are left out of pickers. */
export async function usersById(c: Ctx): Promise<Map<string, User>> {
  const users = (await c.store.list("users")).filter(hasRole);
  return new Map(users.map((u) => [u.id, u]));
}

// ---------------- Accounts ----------------

const nullableStr = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const AccountInput = z.object({
  name: z.string().trim().min(2, "Name is required").max(160),
  type: z.enum(ACCOUNT_TYPES),
  sector: z.string().trim().min(1, "Sector is required").max(80),
  country: z
    .string()
    .trim()
    .length(2, "Use a 2-letter country code")
    .transform((v) => v.toUpperCase()),
  state_region: nullableStr,
  city: nullableStr,
  website: z
    .string()
    .trim()
    .url("Enter a full URL")
    .or(z.literal(""))
    .transform((v) => v || null)
    .nullable()
    .optional(),
  tier: z.enum(["A", "B", "C"]),
  status: z.enum(ACCOUNT_STATUSES),
  owner_id: z.string().uuid().optional(),
  description: nullableStr,
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});
export type AccountInputT = z.input<typeof AccountInput>;

export async function createAccount(c: Ctx, input: AccountInputT): Promise<Account> {
  if (!(isLeader(c.user) || c.user.role === "bd")) throw new ForbiddenError();
  const v = AccountInput.parse(input);
  const owner = v.owner_id && isLeader(c.user) ? v.owner_id : c.user.id;
  const row = await c.store.insert("accounts", {
    org_id: c.user.org_id,
    name: v.name,
    type: v.type,
    sector: v.sector,
    country: v.country,
    state_region: v.state_region ?? null,
    city: v.city ?? null,
    lat: v.lat ?? null,
    lng: v.lng ?? null,
    website: v.website ?? null,
    logo_url: null,
    owner_id: owner,
    tier: v.tier,
    status: v.status,
    konnect_hub_client_id: null,
    survey_score: null,
    description: v.description ?? null,
    created_by: actorId(c),
  });
  await audit(c, "account.created", "accounts", row.id, null, { name: row.name, owner_id: row.owner_id });
  await logActivity(c, { type: "system", subject: "Account created", related_type: "account", related_id: row.id, account_id: row.id });
  await emitEvent(c, "account.created", webhookData.account(row));
  return row;
}

export async function updateAccount(c: Ctx, id: string, patch: Partial<AccountInputT>): Promise<Account> {
  const a = await getAccount(c, id);
  if (!canEditAccount(c.user, a)) throw new ForbiddenError("Only the owner or an executive can edit this account.");
  const v = AccountInput.partial().parse(patch);
  if (v.owner_id && v.owner_id !== a.owner_id && !isLeader(c.user)) throw new ForbiddenError("Only executives can reassign ownership.");
  const d = diff(a, v as Partial<Account>);
  if (!d.changed) return a;
  const row = await c.store.update("accounts", id, v as Partial<Account>);
  if ("owner_id" in d.after) await audit(c, "account.owner_changed", "accounts", id, d.before, d.after);
  await emitEvent(c, "account.updated", webhookData.account(row, Object.keys(d.after)));
  return row;
}

/** Bulk reassign / retier / archive from the list. Each row is permission-checked. */
export async function bulkUpdateAccounts(
  c: Ctx,
  ids: string[],
  patch: { owner_id?: string; tier?: Account["tier"]; status?: Account["status"]; archive?: boolean },
) {
  let updated = 0;
  for (const id of ids) {
    const a = await getAccount(c, id);
    if (!canEditAccount(c.user, a)) continue;
    if (patch.archive) {
      if (!isLeader(c.user)) continue;
      await c.store.update("accounts", id, { archived_at: c.now.toISOString() });
      await audit(c, "account.archived", "accounts", id, { archived_at: null }, { archived_at: c.now.toISOString() });
    } else {
      await updateAccount(c, id, { owner_id: patch.owner_id, tier: patch.tier, status: patch.status });
    }
    updated++;
  }
  return { updated };
}

export const ACCOUNT_CSV_COLUMNS = ["name", "type", "sector", "country", "state_region", "city", "website", "tier", "status"] as const;

/** Parse a CSV string (header row required). Handles quoted fields and commas inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export async function importAccountsCsv(c: Ctx, csv: string) {
  const rows = parseCsv(csv);
  const errors: Array<{ row: number; message: string }> = [];
  let created = 0;
  for (const [i, r] of rows.entries()) {
    const parsed = AccountInput.safeParse({
      name: r.name,
      type: r.type,
      sector: r.sector,
      country: r.country,
      state_region: r.state_region ?? "",
      city: r.city ?? "",
      website: r.website ?? "",
      tier: r.tier || "C",
      status: r.status || "prospect",
    });
    if (!parsed.success) {
      errors.push({ row: i + 2, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      continue;
    }
    await createAccount(c, parsed.data as AccountInputT);
    created++;
  }
  return { created, errors };
}

// ---------------- Contacts ----------------

export const ContactInput = z.object({
  account_id: z.string().uuid("Pick an account"),
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
  phone: nullableStr,
  role_in_buying: z.enum(BUYING_ROLES).nullable().optional(),
});
export type ContactInputT = z.input<typeof ContactInput>;

export async function visibleContacts(c: Ctx): Promise<Contact[]> {
  const accounts = new Set((await visibleAccounts(c)).map((a) => a.id));
  return (await c.store.list("contacts", { orderBy: { column: "last_name" } })).filter((x) => accounts.has(x.account_id));
}

export async function getContact(c: Ctx, id: string): Promise<{ contact: Contact; account: Account }> {
  const contact = await c.store.get("contacts", id);
  if (!contact || contact.archived_at) throw new ForbiddenError("Contact not found.");
  const account = await getAccount(c, contact.account_id);
  return { contact, account };
}

export async function createContact(c: Ctx, input: ContactInputT): Promise<Contact> {
  const v = ContactInput.parse(input);
  const account = await getAccount(c, v.account_id);
  if (!canEditAccount(c.user, account) && c.user.role !== "bd") throw new ForbiddenError();
  const row = await c.store.insert("contacts", {
    org_id: c.user.org_id,
    account_id: v.account_id,
    first_name: v.first_name,
    last_name: v.last_name,
    title: v.title ?? null,
    email: v.email ?? null,
    phone: v.phone ?? null,
    role_in_buying: v.role_in_buying ?? null,
    owner_id: c.user.id,
    created_by: actorId(c),
  });
  await logActivity(c, {
    type: "system",
    subject: `Contact added: ${row.first_name} ${row.last_name}`,
    related_type: "account",
    related_id: account.id,
    account_id: account.id,
  });
  return row;
}

export async function updateContact(c: Ctx, id: string, patch: Partial<ContactInputT>) {
  const { contact, account } = await getContact(c, id);
  if (!(isLeader(c.user) || contact.owner_id === c.user.id || account.owner_id === c.user.id)) throw new ForbiddenError();
  const v = ContactInput.partial().parse(patch);
  return c.store.update("contacts", id, v as Partial<Contact>);
}

// ---------------- Timeline ----------------

export const ActivityInput = z.object({
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().max(10_000).nullable().optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  related_type: z.enum([
    "account",
    "contact",
    "opportunity",
    "quote",
    "consultant",
    "event",
    "registration",
    "partner_vetting",
    "client_item",
  ]),
  related_id: z.string().uuid(),
  account_id: z.string().uuid().nullable().optional(),
});
export type ActivityInputT = z.input<typeof ActivityInput>;

/** Resolves "@First Last" mentions in a body against internal users. */
export function extractMentions(body: string | null | undefined, users: User[]): string[] {
  if (!body) return [];
  const ids = new Set<string>();
  for (const u of users) if (body.includes(`@${u.full_name}`)) ids.add(u.id);
  return [...ids];
}

export async function logActivity(c: Ctx, input: ActivityInputT): Promise<Activity> {
  const v = ActivityInput.parse(input);
  const users = (await c.store.list("users")).filter(hasRole);
  const mentions = extractMentions(v.body, users);
  const row = await c.store.insert("activities", {
    org_id: c.user.org_id,
    type: v.type,
    subject: v.subject,
    body: v.body ?? null,
    occurred_at: v.occurred_at ?? c.now.toISOString(),
    related_type: v.related_type,
    related_id: v.related_id,
    account_id: v.account_id ?? null,
    actor_id: v.type === "system" ? null : actorId(c),
    mentions,
    reactions: {},
    created_by: actorId(c),
  });
  for (const uid of mentions) {
    if (uid === c.user.id) continue;
    await c.store.insert("mentions", { activity_id: row.id, user_id: uid });
    await notify(c, uid, "mention", `${c.user.full_name} mentioned you: ${v.subject}`, hrefFor(v.related_type, v.related_id));
  }
  return row;
}

export async function toggleReaction(c: Ctx, activityId: string, emoji: string) {
  const a = await c.store.get("activities", activityId);
  if (!a) throw new ForbiddenError("Activity not found.");
  const who = new Set(a.reactions[emoji] ?? []);
  if (who.has(c.user.id)) who.delete(c.user.id);
  else who.add(c.user.id);
  return c.store.update("activities", activityId, { reactions: { ...a.reactions, [emoji]: [...who] } });
}

export function hrefFor(type: RelatedType, id: string): string {
  const map: Partial<Record<RelatedType, string>> = {
    account: "/accounts/",
    contact: "/contacts/",
    opportunity: "/opportunities/",
    quote: "/quotes/",
    consultant: "/bench/",
    event: "/events/",
    client_item: "/client-items/",
  };
  if (type === "registration") return "/registrations";
  if (type === "partner_vetting") return "/vetting";
  return `${map[type] ?? "/"}${id}`;
}

/** Timeline for a record. For accounts, includes everything tagged with the account. */
export async function timelineFor(c: Ctx, type: RelatedType, id: string): Promise<Activity[]> {
  const all = await c.store.list("activities", { orderBy: { column: "occurred_at", ascending: false } });
  const items =
    type === "account"
      ? all.filter((a) => a.account_id === id || (a.related_type === "account" && a.related_id === id))
      : all.filter((a) => a.related_type === type && a.related_id === id);
  if (type !== "account") return items;
  // Hide activity on opportunities this user can't see (e.g. a bd on someone else's deal).
  const visible = new Set((await visibleOpportunities(c)).map((o) => o.id));
  return items.filter((a) => a.related_type !== "opportunity" || visible.has(a.related_id));
}

// ---------------- Tasks ----------------

export const TaskInput = z.object({
  title: z.string().trim().min(2, "Title is required").max(200),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  assignee_id: z.string().uuid().optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  related_type: z
    .enum(["account", "contact", "opportunity", "quote", "consultant", "event", "registration", "partner_vetting", "client_item"])
    .nullable()
    .optional(),
  related_id: z.string().uuid().nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
export type TaskInputT = z.input<typeof TaskInput>;

export async function createTask(c: Ctx, input: TaskInputT): Promise<Task> {
  const v = TaskInput.parse(input);
  const assignee = v.assignee_id ?? c.user.id;
  const row = await c.store.insert("tasks", {
    org_id: c.user.org_id,
    title: v.title,
    due_at: v.due_at ?? null,
    assignee_id: assignee,
    priority: v.priority,
    status: "open",
    related_type: v.related_type ?? null,
    related_id: v.related_id ?? null,
    account_id: v.account_id ?? null,
    notes: v.notes ?? null,
    created_by: actorId(c),
  });
  if (assignee !== c.user.id) {
    await notify(
      c,
      assignee,
      "assignment",
      `${c.user.full_name} assigned you: ${row.title}`,
      row.related_type && row.related_id ? hrefFor(row.related_type, row.related_id) : "/my-work",
    );
  }
  return row;
}

export async function setTaskStatus(c: Ctx, id: string, status: Task["status"]) {
  const t = await c.store.get("tasks", id);
  if (!t) throw new ForbiddenError("Task not found.");
  if (!(t.assignee_id === c.user.id || t.created_by === c.user.id || isLeader(c.user))) throw new ForbiddenError();
  return c.store.update("tasks", id, { status });
}

export async function myTasks(c: Ctx) {
  return await c.store.list("tasks", { where: { assignee_id: c.user.id }, orderBy: { column: "due_at" } });
}

export async function tasksFor(c: Ctx, type: RelatedType, id: string) {
  return c.store.list("tasks", { where: { related_type: type, related_id: id }, orderBy: { column: "due_at" } });
}

// ---------------- Notifications ----------------

export async function notify(
  c: Ctx,
  userId: string,
  kind: import("@/lib/domain/types").Notification["kind"],
  title: string,
  href: string | null,
  body: string | null = null,
) {
  return c.store.insert("notifications", { user_id: userId, kind, title, body, href, read_at: null, created_at: c.now.toISOString() });
}

export async function myNotifications(c: Ctx) {
  return c.store.list("notifications", { where: { user_id: c.user.id }, orderBy: { column: "created_at", ascending: false } });
}

export async function unreadCount(c: Ctx) {
  return (await myNotifications(c)).filter((n) => !n.read_at).length;
}

export async function markRead(c: Ctx, ids: string[] | "all") {
  const mine = await myNotifications(c);
  for (const n of mine)
    if (!n.read_at && (ids === "all" || ids.includes(n.id))) await c.store.update("notifications", n.id, { read_at: c.now.toISOString() });
}

// ---------------- Recently viewed ----------------

export async function recordView(c: Ctx, related_type: RelatedType, related_id: string, label: string) {
  const prior = await c.store.list("recent_views", { where: { user_id: c.user.id, related_id } });
  for (const p of prior) await c.store.remove("recent_views", p.id);
  await c.store.insert("recent_views", { user_id: c.user.id, related_type, related_id, label });
}

export async function recentViews(c: Ctx, limit = 8) {
  return c.store.list("recent_views", { where: { user_id: c.user.id }, orderBy: { column: "created_at", ascending: false }, limit });
}

// ---------------- Search ----------------

export async function search(c: Ctx, q: string) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const [accounts, contacts, opps] = await Promise.all([visibleAccounts(c), visibleContacts(c), visibleOpportunities(c)]);
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const hits = [
    ...accounts
      .filter((a) => a.name.toLowerCase().includes(needle))
      .map((a) => ({
        kind: "account" as const,
        id: a.id,
        label: a.name,
        sub: a.city ? `${a.city}, ${a.state_region ?? a.country}` : a.country,
        href: `/accounts/${a.id}`,
      })),
    ...contacts
      .filter((x) => `${x.first_name} ${x.last_name} ${x.email ?? ""}`.toLowerCase().includes(needle))
      .map((x) => ({
        kind: "contact" as const,
        id: x.id,
        label: `${x.first_name} ${x.last_name}`,
        sub: `${x.title ?? ""} · ${accName.get(x.account_id) ?? ""}`,
        href: `/contacts/${x.id}`,
      })),
    ...opps
      .filter((o) => `${o.name} ${o.solicitation_no ?? ""}`.toLowerCase().includes(needle))
      .map((o) => ({
        kind: "opportunity" as const,
        id: o.id,
        label: o.name,
        sub: `${o.solicitation_no ?? o.stage} · ${accName.get(o.account_id) ?? ""}`,
        href: `/opportunities/${o.id}`,
      })),
  ];
  if (canSeeBench(c.user)) {
    const cons = await c.store.list("consultants");
    hits.push(
      ...cons
        .filter((x) => `${x.full_name} ${x.skills.join(" ")}`.toLowerCase().includes(needle))
        .map((x) => ({ kind: "consultant" as never, id: x.id, label: x.full_name, sub: x.title, href: `/bench/${x.id}` })),
    );
  }
  return hits.slice(0, 20);
}
