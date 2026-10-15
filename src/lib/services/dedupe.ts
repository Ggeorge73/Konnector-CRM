/**
 * KCRM-77 Duplicate detection and merge. Leaders only (admin / executive), matching the
 * duplicate_dismissals RLS policies and the is_leader() check inside merge_accounts() /
 * merge_contacts(). Scoring rules live in src/lib/domain/dedupe.ts.
 */
import { z } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { canManageDataQuality } from "@/lib/auth/permissions";
import {
  ACCOUNT_MERGE_FIELDS,
  CONTACT_MERGE_FIELDS,
  findAccountDuplicates,
  findContactDuplicates,
  pairId,
  pairKey,
  type DuplicateReason,
} from "@/lib/domain/dedupe";
import { DEDUPE_ENTITIES, type Account, type Contact, type DedupeEntity, type DuplicateDismissal } from "@/lib/domain/types";
import type { MergeResult } from "@/lib/data/store";
import { audit } from "./audit";
import type { Ctx } from "./context-types";
import { actorId } from "./system";
import { emitEvent, webhookData } from "./webhooks";

/** Show the older record on the left: it is usually the one to keep. */
function olderFirst<R extends { created_at: string; id: string }>(x: R, y: R): { a: R; b: R } {
  return y.created_at < x.created_at ? { a: y, b: x } : { a: x, b: y };
}

function requireLeader(c: Ctx) {
  if (!canManageDataQuality(c.user)) throw new ForbiddenError("Only admins and executives can review and merge duplicates.");
}

// ---------------- Detection ----------------

export interface AccountSide extends Account {
  owner_name: string;
  contact_count: number;
  opportunity_count: number;
}
export interface ContactSide extends Contact {
  account_name: string;
  owner_name: string;
}
export interface DuplicatePair<R> {
  id: string;
  score: number;
  reasons: DuplicateReason[];
  a: R;
  b: R;
}

async function dismissedSet(c: Ctx, entity: DedupeEntity): Promise<Set<string>> {
  const rows = await c.store.list("duplicate_dismissals", { where: { entity } });
  return new Set(rows.map((r) => pairId(r.record_a, r.record_b)));
}

async function ownerNames(c: Ctx) {
  return new Map((await c.store.list("users", { includeArchived: true })).map((u) => [u.id, u.full_name]));
}

/** Likely duplicate accounts (archived and dismissed pairs excluded), highest score first. */
export async function accountDuplicates(c: Ctx): Promise<DuplicatePair<AccountSide>[]> {
  requireLeader(c);
  const [accounts, contacts, opps, dismissed, owners] = await Promise.all([
    c.store.list("accounts"),
    c.store.list("contacts"),
    c.store.list("opportunities"),
    dismissedSet(c, "accounts"),
    ownerNames(c),
  ]);
  const count = (rows: Array<{ account_id: string }>) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.account_id, (m.get(r.account_id) ?? 0) + 1);
    return m;
  };
  const cc = count(contacts);
  const oc = count(opps);
  const byId = new Map(
    accounts.map((a) => [
      a.id,
      { ...a, owner_name: owners.get(a.owner_id) ?? "—", contact_count: cc.get(a.id) ?? 0, opportunity_count: oc.get(a.id) ?? 0 },
    ]),
  );
  return findAccountDuplicates(accounts, dismissed).map((p) => ({
    id: pairId(p.a, p.b),
    score: p.score,
    reasons: p.reasons,
    ...olderFirst(byId.get(p.a)!, byId.get(p.b)!),
  }));
}

/** Likely duplicate contacts on active accounts (archived and dismissed pairs excluded). */
export async function contactDuplicates(c: Ctx): Promise<DuplicatePair<ContactSide>[]> {
  requireLeader(c);
  const [accounts, contacts, dismissed, owners] = await Promise.all([
    c.store.list("accounts"),
    c.store.list("contacts"),
    dismissedSet(c, "contacts"),
    ownerNames(c),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const live = contacts.filter((x) => acc.has(x.account_id));
  const byId = new Map(
    live.map((x) => [x.id, { ...x, account_name: acc.get(x.account_id) ?? "—", owner_name: owners.get(x.owner_id) ?? "—" }]),
  );
  return findContactDuplicates(live, dismissed).map((p) => ({
    id: pairId(p.a, p.b),
    score: p.score,
    reasons: p.reasons,
    ...olderFirst(byId.get(p.a)!, byId.get(p.b)!),
  }));
}

export async function duplicateCounts(c: Ctx): Promise<Record<DedupeEntity, number>> {
  const [accounts, contacts] = await Promise.all([accountDuplicates(c), contactDuplicates(c)]);
  return { accounts: accounts.length, contacts: contacts.length };
}

// ---------------- Dismissals ----------------

export const DismissInput = z.object({
  entity: z.enum(DEDUPE_ENTITIES),
  a: z.string().uuid(),
  b: z.string().uuid(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type DismissInputT = z.input<typeof DismissInput>;

/** Marks a pair "not a duplicate" so detection stops listing it. Idempotent. */
export async function dismissDuplicate(c: Ctx, input: DismissInputT): Promise<DuplicateDismissal> {
  requireLeader(c);
  const v = DismissInput.parse(input);
  if (v.a === v.b) throw new ValidationError("A record can't be a duplicate of itself.");
  const [record_a, record_b] = pairKey(v.a, v.b);
  const existing = await c.store.list("duplicate_dismissals", { where: { entity: v.entity, record_a, record_b } });
  if (existing[0]) return existing[0];
  const table = v.entity;
  const [ra, rb] = await Promise.all([c.store.get(table, record_a), c.store.get(table, record_b)]);
  if (!ra || !rb) throw new ValidationError("One of these records no longer exists.");
  const row = await c.store.insert("duplicate_dismissals", {
    org_id: c.user.org_id,
    entity: v.entity,
    record_a,
    record_b,
    dismissed_by: actorId(c),
    note: v.note ?? null,
    created_by: actorId(c),
  });
  await audit(c, "duplicate.dismissed", "duplicate_dismissals", row.id, null, { entity: v.entity, record_a, record_b });
  return row;
}

/** Puts a dismissed pair back in the list. */
export async function undoDismissal(c: Ctx, id: string) {
  requireLeader(c);
  const row = await c.store.get("duplicate_dismissals", z.string().uuid().parse(id));
  if (!row) throw new ValidationError("That dismissal no longer exists.");
  await c.store.remove("duplicate_dismissals", row.id);
  await audit(
    c,
    "duplicate.restored",
    "duplicate_dismissals",
    row.id,
    { entity: row.entity, record_a: row.record_a, record_b: row.record_b },
    null,
  );
}

export async function listDismissals(c: Ctx, entity: DedupeEntity) {
  requireLeader(c);
  return c.store.list("duplicate_dismissals", { where: { entity }, orderBy: { column: "created_at", ascending: false } });
}

// ---------------- Merge ----------------

const side = z.enum(["survivor", "loser"]);

export const MergeAccountsInput = z.object({
  survivor_id: z.string().uuid(),
  loser_id: z.string().uuid(),
  /** Per field: keep the survivor's value (default) or take the loser's. */
  pick: z.partialRecord(z.enum(ACCOUNT_MERGE_FIELDS), side).default({}),
});
export type MergeAccountsInputT = z.input<typeof MergeAccountsInput>;

export const MergeContactsInput = z.object({
  survivor_id: z.string().uuid(),
  loser_id: z.string().uuid(),
  pick: z.partialRecord(z.enum(CONTACT_MERGE_FIELDS), side).default({}),
});
export type MergeContactsInputT = z.input<typeof MergeContactsInput>;

async function loadPair<T extends "accounts" | "contacts">(c: Ctx, table: T, survivorId: string, loserId: string) {
  if (survivorId === loserId) throw new ValidationError("Pick two different records to merge.");
  const [s, l] = await Promise.all([c.store.get(table, survivorId), c.store.get(table, loserId)]);
  if (!s || !l || s.archived_at || l.archived_at) throw new ValidationError("Both records must exist and be active to merge.");
  return [s, l] as const;
}

/** Refuses to merge accounts that point at two different Konnect Hub clients. */
export function hubConflict(s: Pick<Account, "konnect_hub_client_id">, l: Pick<Account, "konnect_hub_client_id">): string | null {
  if (s.konnect_hub_client_id && l.konnect_hub_client_id && s.konnect_hub_client_id !== l.konnect_hub_client_id) {
    return (
      `Can't merge: these accounts are linked to different Konnect Hub clients (${s.konnect_hub_client_id} and ` +
      `${l.konnect_hub_client_id}). Resolve the duplicate client in Konnect Hub first, then merge here.`
    );
  }
  return null;
}

/** Survivor keeps its id and takes the picked fields; see merge_accounts() for what is re-pointed. */
export async function mergeAccounts(c: Ctx, input: MergeAccountsInputT): Promise<MergeResult<"accounts">> {
  requireLeader(c);
  const v = MergeAccountsInput.parse(input);
  const [s, l] = await loadPair(c, "accounts", v.survivor_id, v.loser_id);
  const conflict = hubConflict(s, l);
  if (conflict) throw new ValidationError(conflict);
  const patch: Record<string, unknown> = {};
  for (const [field, from] of Object.entries(v.pick)) {
    if (from !== "loser") continue;
    patch[field] = l[field as keyof Account];
    if (field === "city") Object.assign(patch, { lat: l.lat, lng: l.lng }); // coordinates travel with the city
  }
  if (typeof patch.owner_id === "string" && !(await c.store.get("users", patch.owner_id))) {
    throw new ValidationError("The chosen owner no longer exists.");
  }
  const result = await c.store.merge("accounts", {
    survivorId: s.id,
    loserId: l.id,
    patch,
    actor: c.user,
    now: c.now,
  });
  const after = result.survivor;
  const changed = (Object.keys(after) as Array<keyof Account>).filter(
    (k) => k !== "updated_at" && JSON.stringify(after[k]) !== JSON.stringify(s[k]),
  );
  await emitEvent(c, "account.updated", webhookData.account(after, changed));
  return result;
}

export async function mergeContacts(c: Ctx, input: MergeContactsInputT): Promise<MergeResult<"contacts">> {
  requireLeader(c);
  const v = MergeContactsInput.parse(input);
  const [s, l] = await loadPair(c, "contacts", v.survivor_id, v.loser_id);
  const patch: Record<string, unknown> = {};
  for (const [field, from] of Object.entries(v.pick)) if (from === "loser") patch[field] = l[field as keyof Contact];
  if (typeof patch.account_id === "string") {
    const a = await c.store.get("accounts", patch.account_id);
    if (!a || a.archived_at) throw new ValidationError("The chosen account is archived or missing.");
  }
  return c.store.merge("contacts", { survivorId: s.id, loserId: l.id, patch, actor: c.user, now: c.now });
}
