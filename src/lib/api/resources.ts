/**
 * REST API v1 resources. Every read and write goes through the same services the UI uses,
 * so role scoping, redaction, Zod validation and audit are identical. This module only adds
 * filtering, pagination and the API-specific shape of each resource.
 */
import { z } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { canSeeAccount, canSeeOpportunity, isLeader } from "@/lib/auth/permissions";
import type { Activity, RelatedType, Task } from "@/lib/domain/types";
import {
  getOpportunity,
  getQuote,
  moveStage,
  MoveInput,
  OpportunityInput,
  updateOpportunity,
  visibleQuotes,
  createOpportunity,
  type QuoteView,
} from "@/lib/services/capture";
import type { Ctx } from "@/lib/services/context-types";
import {
  AccountInput,
  ActivityInput,
  ContactInput,
  createAccount,
  createContact,
  createTask,
  getAccount,
  getContact,
  logActivity,
  setTaskStatus,
  TaskInput,
  updateAccount,
  updateContact,
  visibleAccounts,
  visibleContacts,
  visibleOpportunities,
} from "@/lib/services/core";

export const RESOURCES = ["accounts", "contacts", "opportunities", "activities", "tasks", "quotes"] as const;
export type Resource = (typeof RESOURCES)[number];

type AnyRow = { id: string; created_at: string; updated_at: string } & Record<string, unknown>;

export interface ResourceDef {
  /** Query-string filters: name → row column (equality) — `updated_since` and `q` are handled separately. */
  filters: string[];
  list(c: Ctx): Promise<AnyRow[]>;
  get(c: Ctx, id: string): Promise<AnyRow>;
  create?(c: Ctx, body: unknown): Promise<AnyRow>;
  update?(c: Ctx, id: string, body: unknown): Promise<AnyRow>;
  /** Free-text `q` search over these columns. */
  search?: string[];
}

const asRow = <T>(r: T) => r as unknown as AnyRow;

/** Thrown when a request body is not an object. */
export class BadRequest extends Error {}

const obj = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("Request body must be a JSON object.");
  return body as Record<string, unknown>;
};

/** Rejects keys the resource doesn't accept (so typos don't silently do nothing). */
function only(body: Record<string, unknown>, allowed: readonly string[]) {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw new ValidationError(`Unknown field${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}`);
  return body;
}

// ---------------- Visibility (mirrors RLS) ----------------

/** Activities: opportunity rows follow the opportunity; others follow the account (or are org-wide). */
export async function visibleActivities(c: Ctx): Promise<Activity[]> {
  const [all, opps, accounts] = await Promise.all([
    c.store.list("activities", { orderBy: { column: "occurred_at", ascending: false } }),
    visibleOpportunities(c),
    c.store.list("accounts"),
  ]);
  const oppIds = new Set(opps.map((o) => o.id));
  const allOpps = new Map((await c.store.list("opportunities")).map((o) => [o.id, o]));
  const accById = new Map(accounts.map((a) => [a.id, a]));
  return all.filter((a) => {
    if (a.related_type === "opportunity") {
      const o = allOpps.get(a.related_id);
      return !!o && (oppIds.has(o.id) || canSeeOpportunity(c.user, o));
    }
    if (!a.account_id) return true;
    const acc = accById.get(a.account_id);
    return !!acc && canSeeAccount(c.user, acc, opps);
  });
}

/** Tasks: leaders see all; everyone else sees tasks assigned to or created by them. */
export async function visibleTasks(c: Ctx): Promise<Task[]> {
  const all = await c.store.list("tasks", { orderBy: { column: "due_at" } });
  return isLeader(c.user) ? all : all.filter((t) => t.assignee_id === c.user.id || t.created_by === c.user.id);
}

/** Checks the caller can see the record an activity/task is attached to. */
async function assertRelatedVisible(
  c: Ctx,
  type: RelatedType | null | undefined,
  id: string | null | undefined,
  accountId?: string | null,
) {
  if (accountId) await getAccount(c, accountId);
  if (!type || !id) return;
  if (type === "account") await getAccount(c, id);
  else if (type === "contact") await getContact(c, id);
  else if (type === "opportunity") await getOpportunity(c, id);
  else if (type === "quote") await getQuote(c, id);
  else throw new ValidationError(`related_type "${type}" isn't supported by the API — use account, contact, opportunity or quote.`);
}

/** API quotes are client-facing: no unit cost, margin or internal notes for anyone. */
export function publicQuote(q: QuoteView) {
  const { internal_notes: _n, totals, canSeeCost: _c, belowFloor: _b, lines, ...rest } = q;
  return {
    ...rest,
    total: totals.price,
    lines: lines.map(({ unit_cost: _u, margin_pct: _m, ...l }) => l),
  };
}

// ---------------- Resources ----------------

const ACCOUNT_FIELDS = Object.keys(AccountInput.shape);
const CONTACT_FIELDS = Object.keys(ContactInput.shape);
const OPP_FIELDS = Object.keys(OpportunityInput.shape);
const MOVE_FIELDS = ["stage", "lost_reason", "no_bid_reason"];
const ACTIVITY_FIELDS = Object.keys(ActivityInput.shape);
const TASK_FIELDS = Object.keys(TaskInput.shape);

export const resources: Record<Resource, ResourceDef> = {
  accounts: {
    filters: ["status", "tier", "type", "owner_id"],
    search: ["name"],
    list: async (c) => (await visibleAccounts(c)).map(asRow),
    get: async (c, id) => asRow(await getAccount(c, id)),
    create: async (c, body) => asRow(await createAccount(c, only(obj(body), ACCOUNT_FIELDS) as never)),
    update: async (c, id, body) => asRow(await updateAccount(c, id, only(obj(body), ACCOUNT_FIELDS) as never)),
  },
  contacts: {
    filters: ["account_id", "owner_id"],
    search: ["first_name", "last_name", "email"],
    list: async (c) => (await visibleContacts(c)).map(asRow),
    get: async (c, id) => asRow((await getContact(c, id)).contact),
    create: async (c, body) => asRow(await createContact(c, only(obj(body), CONTACT_FIELDS) as never)),
    update: async (c, id, body) => {
      const b = only(obj(body), CONTACT_FIELDS);
      if ("account_id" in b) throw new ValidationError("A contact can't be moved to another account.");
      return asRow(await updateContact(c, id, b as never));
    },
  },
  opportunities: {
    filters: ["account_id", "stage", "kind", "owner_id"],
    search: ["name", "solicitation_no"],
    list: async (c) => (await visibleOpportunities(c, { includeClosed: true })).map(asRow),
    get: async (c, id) => asRow(await getOpportunity(c, id)),
    create: async (c, body) => asRow(await createOpportunity(c, only(obj(body), OPP_FIELDS) as never)),
    /** `stage` goes through moveStage (stage gates, audit); everything else through updateOpportunity. */
    update: async (c, id, body) => {
      const b = only(obj(body), [...OPP_FIELDS.filter((f) => f !== "account_id"), ...MOVE_FIELDS]);
      const { stage, lost_reason, no_bid_reason, ...rest } = b;
      if (Object.keys(rest).length) await updateOpportunity(c, id, rest as never);
      if (stage !== undefined) {
        await moveStage(
          c,
          id,
          MoveInput.parse({ to: stage, lost_reason, no_bid_reason, proposal_due: rest.proposal_due as string | undefined }),
        );
      } else if (lost_reason !== undefined || no_bid_reason !== undefined) {
        throw new ValidationError("lost_reason and no_bid_reason are only accepted together with stage.");
      }
      return asRow(await getOpportunity(c, id));
    },
  },
  activities: {
    filters: ["account_id", "related_type", "related_id", "type"],
    search: ["subject"],
    list: async (c) => (await visibleActivities(c)).map(asRow),
    get: async (c, id) => {
      const row = (await visibleActivities(c)).find((a) => a.id === id);
      if (!row) throw new ForbiddenError("Activity not found.");
      return asRow(row);
    },
    create: async (c, body) => {
      const v = ActivityInput.parse(only(obj(body), ACTIVITY_FIELDS));
      if (v.type === "system" || v.type === "stage_change" || v.type === "handoff")
        throw new ValidationError(`Activities of type "${v.type}" are recorded by the CRM itself.`);
      await assertRelatedVisible(c, v.related_type, v.related_id, v.account_id);
      return asRow(await logActivity(c, v));
    },
  },
  tasks: {
    filters: ["status", "assignee_id", "account_id", "priority", "related_type", "related_id"],
    search: ["title"],
    list: async (c) => (await visibleTasks(c)).map(asRow),
    get: async (c, id) => {
      const row = (await visibleTasks(c)).find((t) => t.id === id);
      if (!row) throw new ForbiddenError("Task not found.");
      return asRow(row);
    },
    create: async (c, body) => {
      const v = TaskInput.parse(only(obj(body), TASK_FIELDS));
      await assertRelatedVisible(c, v.related_type, v.related_id, v.account_id);
      if (v.assignee_id && !(await c.store.get("users", v.assignee_id))) throw new ValidationError("Unknown assignee.");
      return asRow(await createTask(c, v));
    },
    /** Only status can change through the API (open ↔ done). */
    update: async (c, id, body) => {
      const { status } = z
        .object({ status: z.enum(["open", "done"]) })
        .strict()
        .parse(obj(body));
      if (!(await visibleTasks(c)).some((t) => t.id === id)) throw new ForbiddenError("Task not found.");
      return asRow(await setTaskStatus(c, id, status));
    },
  },
  quotes: {
    filters: ["opportunity_id", "account_id", "status"],
    search: ["number", "title"],
    list: async (c) => (await visibleQuotes(c)).map((q) => asRow(publicQuote(q))),
    get: async (c, id) => asRow(publicQuote(await getQuote(c, id))),
  },
};

// ---------------- Listing: filters + cursor pagination ----------------

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

const encodeCursor = (r: AnyRow) => Buffer.from(JSON.stringify([r.created_at, r.id])).toString("base64url");
function decodeCursor(cursor: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "string") return [v[0], v[1]];
  } catch {
    // fall through
  }
  throw new BadRequest("Invalid cursor.");
}

/** Oldest first by (created_at, id), so cursors stay stable while new rows are added. */
export function paginate(rows: AnyRow[], def: ResourceDef, params: URLSearchParams) {
  const limitRaw = params.get("limit");
  const limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new BadRequest(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
  const known = new Set([...def.filters, "limit", "cursor", "updated_since", ...(def.search ? ["q"] : [])]);
  const unknown = [...params.keys()].filter((k) => !known.has(k));
  if (unknown.length) throw new BadRequest(`Unknown query parameter: ${unknown.join(", ")}. Supported: ${[...known].join(", ")}.`);

  let out = rows;
  for (const f of def.filters) {
    const v = params.get(f);
    if (v !== null) out = out.filter((r) => String(r[f] ?? "") === v);
  }
  const since = params.get("updated_since");
  if (since !== null) {
    const t = Date.parse(since);
    if (Number.isNaN(t)) throw new BadRequest("updated_since must be an ISO 8601 timestamp.");
    out = out.filter((r) => Date.parse(r.updated_at) >= t);
  }
  const q = params.get("q")?.trim().toLowerCase();
  if (q && def.search)
    out = out.filter((r) =>
      def.search!.some((col) =>
        String(r[col] ?? "")
          .toLowerCase()
          .includes(q),
      ),
    );

  out = [...out].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
  const cursor = params.get("cursor");
  if (cursor) {
    const [ca, id] = decodeCursor(cursor);
    out = out.filter((r) => r.created_at > ca || (r.created_at === ca && r.id > id));
  }
  const page = out.slice(0, limit);
  return { data: page, next_cursor: out.length > limit ? encodeCursor(page[page.length - 1]) : null };
}
