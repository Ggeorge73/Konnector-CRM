import type { Role } from "@/lib/domain/types";
import { ROUTE_ROLES } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  section: "Win" | "Capture" | "Readiness" | "Admin";
}

export const NAV: NavItem[] = [
  { href: "/", label: "Pulse", icon: "public", section: "Win" },
  { href: "/my-work", label: "My Work", icon: "task", section: "Win" },
  { href: "/accounts", label: "Accounts", icon: "business", section: "Win" },
  { href: "/contacts", label: "Contacts", icon: "contacts", section: "Win" },
  { href: "/opportunities", label: "Pipeline", icon: "view_kanban", section: "Capture" },
  { href: "/forecast", label: "Forecast", icon: "insights", section: "Capture" },
  { href: "/calendar", label: "Bid calendar", icon: "event", section: "Capture" },
  { href: "/quotes", label: "Quotes", icon: "request_quote", section: "Capture" },
  { href: "/client-items", label: "Client items", icon: "outbox", section: "Capture" },
  { href: "/copilot", label: "Copilot", icon: "auto_awesome", section: "Capture" },
  { href: "/bench", label: "Bench", icon: "badge", section: "Readiness" },
  { href: "/events", label: "BD events", icon: "campaign", section: "Readiness" },
  { href: "/registrations", label: "Registrations", icon: "verified", section: "Readiness" },
  { href: "/vetting", label: "Partner vetting", icon: "policy", section: "Readiness" },
  { href: "/import", label: "Import", icon: "upload", section: "Admin" },
  { href: "/settings", label: "Settings", icon: "settings", section: "Admin" },
  { href: "/integrations", label: "Integrations", icon: "hub", section: "Admin" },
  { href: "/connections", label: "Email & calendar", icon: "mail", section: "Admin" },
  { href: "/data-quality", label: "Data quality", icon: "fact_check", section: "Admin" },
  { href: "/audit", label: "Audit log", icon: "history", section: "Admin" },
  { href: "/developer", label: "API & webhooks", icon: "code", section: "Admin" },
];

/** Routes that have shipped. Grows sprint by sprint so the nav never links to an unbuilt page. */
export const SHIPPED = new Set([
  "/",
  "/my-work",
  "/accounts",
  "/contacts",
  "/audit",
  "/opportunities",
  "/quotes",
  "/integrations",
  "/forecast",
  "/calendar",
  "/registrations",
  "/vetting",
  "/settings",
  "/client-items",
  "/bench",
  "/events",
  "/developer",
  "/connections",
  "/copilot",
  "/import",
  "/duplicates",
  "/data-quality",
]);

export function navFor(role: Role) {
  return NAV.filter((n) => {
    if (!SHIPPED.has(n.href)) return false;
    const allowed = ROUTE_ROLES[n.href];
    return !allowed || allowed === "all" || allowed.includes(role);
  });
}
