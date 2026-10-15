/**
 * KCRM-78 Data quality: one place where leaders spot and fix gaps. Each rule is a pure function
 * over rows already loaded (unit-tested in data-quality.test.ts); dataQuality() loads every table
 * it needs once, in parallel, so the page costs a fixed number of queries (no N+1).
 */
import { ForbiddenError } from "@/lib/auth/errors";
import { canManageDataQuality, roleLabel } from "@/lib/auth/permissions";
import { isClosed } from "@/lib/domain/stages";
import type { Account, Activity, Contact, Opportunity, User } from "@/lib/domain/types";
import { DQ_RULES, STALE_DEAL_DAYS, type DqRow, type DqRule } from "@/lib/domain/data-quality";
import type { Ctx } from "./context-types";
import { duplicateCounts } from "./dedupe";

export { DQ_RULES, STALE_DEAL_DAYS, type DqRow, type DqRule };

const DAY = 86_400_000;
const today = (now: Date) => now.toISOString().slice(0, 10);
const isOpen = (o: Pick<Opportunity, "stage">) => !isClosed(o.stage);

// ---------------- Rules ----------------

/** Accounts whose owner is missing, archived, or still pending (no role). */
export function unownedAccounts(accounts: Account[], users: User[]): DqRow[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  return accounts.flatMap((a) => {
    const u = byId.get(a.owner_id);
    const issue =
      !a.owner_id || !u
        ? "No owner"
        : u.archived_at
          ? `Owner ${u.full_name} is deactivated`
          : !u.role
            ? `Owner ${u.full_name} is ${roleLabel(null).toLowerCase()}`
            : null;
    return issue
      ? [
          {
            id: a.id,
            label: a.name,
            context: a.city ? `${a.city}, ${a.state_region ?? a.country}` : a.country,
            issue,
            href: `/accounts/${a.id}`,
          },
        ]
      : [];
  });
}

/** Open opportunities whose expected close date has passed. */
export function overdueOpportunities(opps: Opportunity[], accountName: Map<string, string>, now: Date): DqRow[] {
  const t = today(now);
  return opps
    .filter((o) => isOpen(o) && o.expected_close !== null && o.expected_close < t)
    .sort((a, b) => a.expected_close!.localeCompare(b.expected_close!))
    .map((o) => ({
      id: o.id,
      label: o.name,
      context: accountName.get(o.account_id) ?? "—",
      issue: `Expected close ${o.expected_close} has passed (${Math.floor((Date.parse(t) - Date.parse(o.expected_close!)) / DAY)} days)`,
      href: `/opportunities/${o.id}`,
    }));
}

/** Open opportunities with no value (0 or less) or no expected close date. */
export function incompleteOpportunities(opps: Opportunity[], accountName: Map<string, string>): DqRow[] {
  return opps.flatMap((o) => {
    if (!isOpen(o)) return [];
    const missing = [!(o.value > 0) && "value", !o.expected_close && "expected close"].filter(Boolean);
    return missing.length
      ? [
          {
            id: o.id,
            label: o.name,
            context: accountName.get(o.account_id) ?? "—",
            issue: `Missing ${missing.join(" and ")}`,
            href: `/opportunities/${o.id}`,
          },
        ]
      : [];
  });
}

export function contactsWithoutEmail(contacts: Contact[], accountName: Map<string, string>): DqRow[] {
  return contacts
    .filter((x) => !x.email?.trim())
    .map((x) => ({
      id: x.id,
      label: `${x.first_name} ${x.last_name}`,
      context: accountName.get(x.account_id) ?? "—",
      issue: "No email address",
      href: `/contacts/${x.id}`,
    }));
}

/**
 * Open deals with no timeline activity for more than `days` days. A deal that never had any
 * activity counts from when it was created.
 */
export function staleDeals(
  opps: Opportunity[],
  activities: Pick<Activity, "related_type" | "related_id" | "occurred_at">[],
  accountName: Map<string, string>,
  now: Date,
  days = STALE_DEAL_DAYS,
): DqRow[] {
  const last = new Map<string, string>();
  for (const a of activities) {
    if (a.related_type !== "opportunity") continue;
    const cur = last.get(a.related_id);
    if (!cur || a.occurred_at > cur) last.set(a.related_id, a.occurred_at);
  }
  const cutoff = now.getTime() - days * DAY;
  return opps
    .filter(isOpen)
    .map((o) => ({ o, at: last.get(o.id) ?? null }))
    .filter(({ o, at }) => Date.parse(at ?? o.created_at) < cutoff)
    .sort((x, y) => Date.parse(x.at ?? x.o.created_at) - Date.parse(y.at ?? y.o.created_at))
    .map(({ o, at }) => {
      const idle = Math.floor((now.getTime() - Date.parse(at ?? o.created_at)) / DAY);
      return {
        id: o.id,
        label: o.name,
        context: accountName.get(o.account_id) ?? "—",
        issue: at ? `No activity for ${idle} days` : `No activity since it was created ${idle} days ago`,
        href: `/opportunities/${o.id}`,
      };
    });
}

// ---------------- Report ----------------

export interface DataQualityReport {
  rows: Record<DqRule, DqRow[]>;
  duplicates: { accounts: number; contacts: number };
  staleDays: number;
}

export async function dataQuality(c: Ctx, opts: { staleDays?: number } = {}): Promise<DataQualityReport> {
  if (!canManageDataQuality(c.user)) throw new ForbiddenError("Only admins and executives can open the data quality view.");
  const staleDays = opts.staleDays ?? STALE_DEAL_DAYS;
  const [accounts, users, opps, contacts, activities, duplicates] = await Promise.all([
    c.store.list("accounts"),
    c.store.list("users", { includeArchived: true }),
    c.store.list("opportunities"),
    c.store.list("contacts"),
    c.store.list("activities", { where: { related_type: "opportunity" } }),
    duplicateCounts(c),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  // Contacts on archived accounts are out of scope, like everywhere else in the app.
  const liveContacts = contacts.filter((x) => accountName.has(x.account_id));
  return {
    rows: {
      unowned_accounts: unownedAccounts(accounts, users),
      overdue_opportunities: overdueOpportunities(opps, accountName, c.now),
      incomplete_opportunities: incompleteOpportunities(opps, accountName),
      contacts_without_email: contactsWithoutEmail(liveContacts, accountName),
      stale_deals: staleDeals(opps, activities, accountName, c.now, staleDays),
    },
    duplicates,
    staleDays,
  };
}
