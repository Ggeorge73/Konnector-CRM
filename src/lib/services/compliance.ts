/**
 * Read models for compliance pages (registrations, partner vetting) and the bid calendar.
 * Writes live in capture.ts (saveRegistration, saveVetting, runComplianceReminders).
 */
import { canManageRegistrations, canSeeVetting } from "@/lib/auth/permissions";
import type { Account, PartnerVetting, Registration } from "@/lib/domain/types";
import { daysUntil } from "@/lib/format";
import { visibleVetting } from "./capture";
import type { Ctx } from "./context-types";
import { usersById, visibleAccounts, visibleOpportunities } from "./core";
import { orgSettings } from "./pulse";

export const EXPIRING_WITHIN_DAYS = 30;

export type RegistrationStatus = "expired" | "expiring" | "current" | "no_expiry";

export function registrationStatus(expiresOn: string | null, now: Date): RegistrationStatus {
  const d = daysUntil(expiresOn, now);
  if (d === null) return "no_expiry";
  if (d < 0) return "expired";
  if (d <= EXPIRING_WITHIN_DAYS) return "expiring";
  return "current";
}

export type RegistrationRow = Registration & { status: RegistrationStatus; days: number | null; owner_name: string };

export async function registrationsData(c: Ctx) {
  const [regs, users] = await Promise.all([c.store.list("registrations", { orderBy: { column: "expires_on" } }), usersById(c)]);
  const rows: RegistrationRow[] = regs.map((r) => ({
    ...r,
    status: registrationStatus(r.expires_on, c.now),
    days: daysUntil(r.expires_on, c.now),
    owner_name: users.get(r.owner_id)?.full_name ?? "—",
  }));
  const order: Record<RegistrationStatus, number> = { expired: 0, expiring: 1, current: 2, no_expiry: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.expires_on ?? "").localeCompare(b.expires_on ?? ""));
  return {
    rows,
    counts: {
      current: rows.filter((r) => r.status === "current" || r.status === "no_expiry").length,
      expiring: rows.filter((r) => r.status === "expiring").length,
      expired: rows.filter((r) => r.status === "expired").length,
    },
    canManage: canManageRegistrations(c.user),
  };
}

export const PARTNER_TYPES: Account["type"][] = ["partner_subcontractor", "oem_vendor"];

export type VettingRow = {
  account: Pick<Account, "id" | "name" | "type" | "country" | "city" | "status">;
  vetting: (PartnerVetting & { reviewer_name: string }) | null;
};

/** Every partner/OEM account with its latest vetting record (or null = not vetted). Leaders only. */
export async function vettingData(c: Ctx): Promise<VettingRow[]> {
  if (!canSeeVetting(c.user)) return [];
  const [accounts, vetting, users] = await Promise.all([visibleAccounts(c), visibleVetting(c), usersById(c)]);
  const latest = new Map<string, PartnerVetting>();
  for (const v of vetting) {
    const cur = latest.get(v.account_id);
    if (!cur || v.updated_at > cur.updated_at) latest.set(v.account_id, v);
  }
  return accounts
    .filter((a) => PARTNER_TYPES.includes(a.type) && !a.archived_at)
    .map((a) => {
      const v = latest.get(a.id);
      return {
        account: { id: a.id, name: a.name, type: a.type, country: a.country, city: a.city, status: a.status },
        vetting: v ? { ...v, reviewer_name: v.reviewer_id ? (users.get(v.reviewer_id)?.full_name ?? "—") : "—" } : null,
      };
    })
    .sort((a, b) => {
      // Not vetted first, then soonest review due.
      if (!a.vetting !== !b.vetting) return a.vetting ? 1 : -1;
      return (a.vetting?.review_due ?? "").localeCompare(b.vetting?.review_due ?? "") || a.account.name.localeCompare(b.account.name);
    });
}

// ---------------- Bid calendar ----------------

export type DeadlineKind = "questions_due" | "proposal_due";

export interface CalendarEntry {
  id: string; // `${opportunity id}:${kind}`
  opportunity_id: string;
  name: string;
  account: string;
  solicitation_no: string | null;
  kind: DeadlineKind;
  date: string; // YYYY-MM-DD
}

/** Parse `YYYY-MM` (falls back to the month of `now`). */
export function parseMonth(value: string | undefined, now: Date): { year: number; month: number } {
  const m = value?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]) - 1 };
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

export const monthKey = (year: number, month: number) => {
  const d = new Date(Date.UTC(year, month, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** questions_due / proposal_due for every open public bid the viewer can see. */
export async function bidDeadlines(c: Ctx): Promise<CalendarEntry[]> {
  const [opps, accounts, settings] = await Promise.all([visibleOpportunities(c), c.store.list("accounts"), orgSettings(c)]);
  const closed = new Set(settings.stages.filter((s) => s.closed).map((s) => s.key));
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const out: CalendarEntry[] = [];
  for (const o of opps) {
    if (o.kind !== "public_bid" || o.archived_at || closed.has(o.stage)) continue;
    for (const kind of ["questions_due", "proposal_due"] as const) {
      const date = o[kind]?.slice(0, 10);
      if (!date) continue;
      out.push({
        id: `${o.id}:${kind}`,
        opportunity_id: o.id,
        name: o.name,
        account: names.get(o.account_id) ?? "",
        solicitation_no: o.solicitation_no,
        kind,
        date,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}
