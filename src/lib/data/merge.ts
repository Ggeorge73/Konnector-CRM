/**
 * In-memory mirror of merge_accounts() / merge_contacts() in
 * supabase/migrations/20261015000002_dedupe.sql. Runs synchronously over the dataset, so it is
 * all-or-nothing like the SQL transaction: every check happens before the first write.
 * Keep the two in step — dedupe.test.ts checks every re-pointed table.
 */
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { ACCOUNT_PATCH_KEYS, CONTACT_PATCH_KEYS } from "@/lib/domain/dedupe";
import type { Account, Contact, DedupeEntity, NewRow, RelatedType, Row, TableName } from "@/lib/domain/types";
import type { Dataset } from "./memory-store";
import type { MergeArgs, MergeResult } from "./store";

const isLeaderRole = (role: string | null) => role === "admin" || role === "executive";

function pick<T extends object>(patch: Record<string, unknown>, keys: ReadonlyArray<keyof T>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(patch, k)) out[k as string] = patch[k as string];
  return out as Partial<T>;
}

export function mergeInDataset<E extends DedupeEntity>(d: Dataset, entity: E, args: MergeArgs): MergeResult<E> {
  if (!isLeaderRole(args.actor.role)) throw new ForbiddenError("Only admins and executives can merge records.");
  return (entity === "accounts" ? mergeAccounts(d, args) : mergeContacts(d, args)) as unknown as MergeResult<E>;
}

function helpers(d: Dataset, args: MergeArgs) {
  const now = args.now.toISOString();
  const counts: Record<string, number> = {};
  /** Applies `fn` to every row of `table` matching `where`; returns how many changed. */
  const repoint = <T extends TableName>(table: T, where: (r: Row<T>) => boolean, fn: (r: Row<T>) => Partial<Row<T>>) => {
    const rows = d[table] as Row<T>[];
    let n = 0;
    rows.forEach((r, i) => {
      if (!where(r)) return;
      rows[i] = { ...r, ...fn(r), updated_at: now };
      n++;
    });
    counts[table] = n;
    return n;
  };
  const drop = <T extends TableName>(table: T, where: (r: Row<T>) => boolean) => {
    const rows = d[table] as Row<T>[];
    for (let i = rows.length - 1; i >= 0; i--) if (where(rows[i])) rows.splice(i, 1);
  };
  const insert = <T extends TableName>(table: T, row: NewRow<T>) => {
    (d[table] as Row<T>[]).push({
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      created_by: args.actor.id,
      archived_at: null,
      ...row,
    } as Row<T>);
  };
  const isRel = (type: RelatedType, id: string) => (r: { related_type: RelatedType | null; related_id: string | null }) =>
    r.related_type === type && r.related_id === id;
  /** Unique (x, related_type, related_id) join rows: drop the loser's copy if the survivor has one. */
  const dedupeJoin = <T extends "record_tags" | "recent_views">(table: T, type: RelatedType, other: (r: Row<T>) => string) => {
    const survivorKeys = new Set((d[table] as Row<T>[]).filter(isRel(type, args.survivorId)).map(other));
    drop(table, (r) => isRel(type, args.loserId)(r) && survivorKeys.has(other(r)));
  };
  const relinkNotifications = (prefix: string) =>
    repoint(
      "notifications",
      (r) => !!r.href && r.href.includes(`${prefix}${args.loserId}`),
      (r) => ({ href: r.href!.split(`${prefix}${args.loserId}`).join(`${prefix}${args.survivorId}`) }),
    );
  return { now, counts, repoint, drop, insert, isRel, dedupeJoin, relinkNotifications };
}

function active<T extends "accounts" | "contacts">(d: Dataset, table: T, id: string, org: string, what: string): Row<T> {
  const r = (d[table] as Row<T>[]).find((x) => x.id === id);
  if (!r || r.archived_at || r.org_id !== org) throw new ValidationError(`Both ${what} must exist and be active.`);
  return r;
}

function mergeAccounts(d: Dataset, args: MergeArgs): MergeResult<"accounts"> {
  const { survivorId: S, loserId: L } = args;
  if (S === L) throw new ValidationError("Pick two different accounts to merge.");
  const s = active(d, "accounts", S, args.actor.org_id, "accounts");
  const l = active(d, "accounts", L, args.actor.org_id, "accounts");
  if (s.konnect_hub_client_id && l.konnect_hub_client_id && s.konnect_hub_client_id !== l.konnect_hub_client_id) {
    throw new ValidationError(
      `These accounts are linked to different Konnect Hub clients (${s.konnect_hub_client_id} and ${l.konnect_hub_client_id}).`,
    );
  }
  const h = helpers(d, args);
  const after: Account = {
    ...s,
    ...pick<Account>(args.patch, ACCOUNT_PATCH_KEYS),
    konnect_hub_client_id: s.konnect_hub_client_id ?? l.konnect_hub_client_id,
    survey_score: s.survey_score ?? l.survey_score,
    logo_url: s.logo_url ?? l.logo_url,
    updated_at: h.now,
  };
  const accounts = d.accounts;
  accounts[accounts.findIndex((a) => a.id === S)] = after;

  h.repoint(
    "contacts",
    (r) => r.account_id === L,
    () => ({ account_id: S }),
  );
  h.repoint(
    "opportunities",
    (r) => r.account_id === L,
    () => ({ account_id: S }),
  );
  h.repoint(
    "quotes",
    (r) => r.account_id === L,
    () => ({ account_id: S }),
  );
  h.repoint(
    "quote_lines",
    (r) => r.oem_partner_account_id === L,
    () => ({ oem_partner_account_id: S }),
  );
  h.repoint(
    "partner_vetting",
    (r) => r.account_id === L,
    () => ({ account_id: S }),
  );
  h.repoint(
    "project_health",
    (r) => r.account_id === L,
    () => ({ account_id: S }),
  );
  h.repoint(
    "client_items",
    (r) => r.account_id === L,
    () => ({ account_id: S }),
  );
  h.repoint(
    "synced_messages",
    (r) => r.account_id === L,
    () => ({ account_id: S }),
  );
  for (const t of ["activities", "tasks"] as const) {
    h.repoint(
      t,
      (r) => r.account_id === L || h.isRel("account", L)(r),
      (r) => ({ account_id: r.account_id === L ? S : r.account_id, related_id: h.isRel("account", L)(r) ? S : r.related_id }),
    );
  }
  h.repoint("files", h.isRel("account", L), () => ({ related_id: S }));
  h.repoint("copilot_runs", h.isRel("account", L), () => ({ related_id: S }));
  h.dedupeJoin("record_tags", "account", (r) => r.tag_id);
  h.repoint("record_tags", h.isRel("account", L), () => ({ related_id: S }));
  h.dedupeJoin("recent_views", "account", (r) => r.user_id);
  h.repoint("recent_views", h.isRel("account", L), () => ({ related_id: S, label: after.name }));
  h.relinkNotifications("/accounts/");

  accounts[accounts.findIndex((a) => a.id === L)] = { ...l, archived_at: h.now, konnect_hub_client_id: null, updated_at: h.now };

  h.insert("activities", {
    org_id: args.actor.org_id,
    type: "system",
    subject: `Merged "${l.name}" into this record`,
    body: `Duplicate account ${L} was merged by ${args.actor.full_name} and archived.`,
    occurred_at: h.now,
    related_type: "account",
    related_id: S,
    account_id: S,
    actor_id: args.actor.id,
    mentions: [],
    reactions: {},
  });
  h.insert("audit_log", {
    org_id: args.actor.org_id,
    actor_id: args.actor.id,
    action: "account.merged",
    entity: "accounts",
    entity_id: S,
    before: structuredClone({ survivor: s }),
    after: structuredClone({ survivor: after, loser_id: L, loser_snapshot: l, repointed: h.counts }),
  });
  return { survivor: structuredClone(after), repointed: { ...h.counts } };
}

function mergeContacts(d: Dataset, args: MergeArgs): MergeResult<"contacts"> {
  const { survivorId: S, loserId: L } = args;
  if (S === L) throw new ValidationError("Pick two different contacts to merge.");
  const s = active(d, "contacts", S, args.actor.org_id, "contacts");
  const l = active(d, "contacts", L, args.actor.org_id, "contacts");
  const after: Contact = { ...s, ...pick<Contact>(args.patch, CONTACT_PATCH_KEYS) };
  if (!d.accounts.some((a) => a.id === after.account_id && !a.archived_at)) {
    throw new ValidationError("The chosen account is archived or missing.");
  }
  const h = helpers(d, args);
  after.updated_at = h.now;
  const contacts = d.contacts;
  contacts[contacts.findIndex((c) => c.id === S)] = after;

  for (const t of ["activities", "tasks", "files", "copilot_runs"] as const) {
    h.repoint(t, h.isRel("contact", L), () => ({ related_id: S }));
  }
  h.repoint(
    "synced_messages",
    (r) => r.contact_id === L,
    () => ({ contact_id: S }),
  );

  // event_leads: unique (event_id, contact_id) — fold the loser's lead into the survivor's for the same event.
  const survivorLeads = new Map(d.event_leads.filter((x) => x.contact_id === S).map((x) => [x.event_id, x]));
  for (const lead of d.event_leads.filter((x) => x.contact_id === L)) {
    const keep = survivorLeads.get(lead.event_id);
    if (!keep) continue;
    const interest =
      !lead.interest || lead.interest === (keep.interest ?? "")
        ? keep.interest
        : !keep.interest
          ? lead.interest
          : `${keep.interest}\n${lead.interest}`;
    Object.assign(keep, { interest, follow_up_task_id: keep.follow_up_task_id ?? lead.follow_up_task_id, updated_at: h.now });
  }
  h.drop("event_leads", (x) => x.contact_id === L && survivorLeads.has(x.event_id));
  h.repoint(
    "event_leads",
    (r) => r.contact_id === L,
    () => ({ contact_id: S }),
  );

  h.dedupeJoin("record_tags", "contact", (r) => r.tag_id);
  h.repoint("record_tags", h.isRel("contact", L), () => ({ related_id: S }));
  h.dedupeJoin("recent_views", "contact", (r) => r.user_id);
  h.repoint("recent_views", h.isRel("contact", L), () => ({ related_id: S, label: `${after.first_name} ${after.last_name}` }));
  h.relinkNotifications("/contacts/");

  contacts[contacts.findIndex((c) => c.id === L)] = { ...l, archived_at: h.now, updated_at: h.now };

  h.insert("activities", {
    org_id: args.actor.org_id,
    type: "system",
    subject: `Merged "${l.first_name} ${l.last_name}" into this record`,
    body: `Duplicate contact ${L} was merged by ${args.actor.full_name} and archived.`,
    occurred_at: h.now,
    related_type: "contact",
    related_id: S,
    account_id: after.account_id,
    actor_id: args.actor.id,
    mentions: [],
    reactions: {},
  });
  h.insert("audit_log", {
    org_id: args.actor.org_id,
    actor_id: args.actor.id,
    action: "contact.merged",
    entity: "contacts",
    entity_id: S,
    before: structuredClone({ survivor: s }),
    after: structuredClone({ survivor: after, loser_id: L, loser_snapshot: l, repointed: h.counts }),
  });
  return { survivor: structuredClone(after), repointed: { ...h.counts } };
}
