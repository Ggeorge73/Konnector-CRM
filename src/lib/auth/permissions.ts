/**
 * Role rules, mirrored by Postgres RLS in supabase/migrations. Pure functions so
 * they are unit-tested directly (see src/lib/auth/permissions.test.ts).
 */
import type { Account, ActiveUser, Opportunity, Quote, Role, User } from "@/lib/domain/types";

/** Every rule below takes a user who has a role; pending users are stopped before them. */
export type Who = { id: string; role: Role };

/** Pending access: signed in, but no admin has assigned a role yet. */
export const PENDING_LABEL = "Pending access";

export const hasRole = (u: User): u is ActiveUser => u.role !== null;
export const roleLabel = (role: Role | null) => (role ? ROLE_LABEL[role] : PENDING_LABEL);

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  executive: "Executive",
  bd: "Business development",
  delivery_lead: "Delivery lead",
  recruiter: "Recruiter",
};

export const isLeader = (u: Who) => u.role === "admin" || u.role === "executive";

/** Cost-side numbers: quote unit cost and margins. Owners see their own quotes. */
export const canSeeQuoteCost = (u: Who, q: Pick<Quote, "owner_id">) => isLeader(u) || q.owner_id === u.id;
export const canSeeConsultantCost = (u: Who) => isLeader(u) || u.role === "recruiter";
export const canSeeBidDecision = (u: Who, o: Pick<Opportunity, "owner_id">) => isLeader(u) || o.owner_id === u.id;
export const canSeeVetting = (u: Who) => isLeader(u);
export const canApprove = (u: Who) => isLeader(u);
export const canManageSettings = (u: Who) => u.role === "admin";
export const canViewAudit = (u: Who) => u.role === "admin";
export const canRunHandoff = (u: Who) => isLeader(u) || u.role === "delivery_lead";
export const canSeeBench = (u: Who) => u.role !== "bd";
export const canEditBench = (u: Who) => isLeader(u) || u.role === "recruiter";
export const canManageRegistrations = (u: Who) => isLeader(u);

export function canSeeOpportunity(u: Who, o: Pick<Opportunity, "owner_id" | "shared_with" | "kind">) {
  if (isLeader(u) || u.role === "delivery_lead") return true;
  if (u.role === "recruiter") return o.kind === "staffing_placement";
  return o.owner_id === u.id || o.shared_with.includes(u.id);
}

export function canEditOpportunity(u: Who, o: Pick<Opportunity, "owner_id" | "shared_with">) {
  if (isLeader(u)) return true;
  if (u.role !== "bd") return false;
  return o.owner_id === u.id || o.shared_with.includes(u.id);
}

/**
 * bd sees accounts they own or have a visible opportunity on; recruiters see
 * accounts with staffing deals; leaders and delivery leads see all.
 */
export function canSeeAccount(u: Who, a: Pick<Account, "id" | "owner_id">, visibleOpps: Pick<Opportunity, "account_id">[]) {
  if (isLeader(u) || u.role === "delivery_lead") return true;
  if (a.owner_id === u.id) return true;
  return visibleOpps.some((o) => o.account_id === a.id);
}

export const canEditAccount = (u: Who, a: Pick<Account, "owner_id">) => isLeader(u) || (u.role === "bd" && a.owner_id === u.id);

/** Nav sections each role can open; route guards use the same map. */
export const ROUTE_ROLES: Record<string, Role[] | "all"> = {
  "/": "all",
  "/my-work": "all",
  "/accounts": "all",
  "/contacts": "all",
  "/opportunities": "all",
  "/forecast": ["admin", "executive", "bd", "delivery_lead"],
  "/calendar": "all",
  "/quotes": ["admin", "executive", "bd"],
  "/bench": ["admin", "executive", "delivery_lead", "recruiter"],
  "/events": ["admin", "executive", "bd"],
  "/registrations": "all",
  "/vetting": ["admin", "executive"],
  "/client-items": ["admin", "executive", "bd", "delivery_lead"],
  "/notifications": "all",
  "/settings": ["admin"],
  "/audit": ["admin"],
  "/developer": "all",
  "/integrations": ["admin", "executive", "delivery_lead"],
  "/connections": "all",
  "/copilot": "all",
  "/_kit": "all",
};

export function canOpenRoute(u: Who, pathname: string) {
  const key = Object.keys(ROUTE_ROLES)
    .filter((k) => (k === "/" ? pathname === "/" : pathname === k || pathname.startsWith(`${k}/`)))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return true;
  const allowed = ROUTE_ROLES[key];
  return allowed === "all" || allowed.includes(u.role);
}
