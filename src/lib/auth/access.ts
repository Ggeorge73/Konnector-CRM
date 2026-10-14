/**
 * Who may sign in at all. Pure functions so the server callback, the demo sign-in and
 * currentUser() apply the exact same rule (unit-tested in src/lib/__tests__/access.test.ts).
 */
import { env } from "@/config/app";

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** ALLOWED_EMAIL_DOMAIN may list several domains, comma-separated. */
export function allowedDomains(setting: string = env.allowedEmailDomain): string[] {
  return setting
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * True only for a well-formed address whose domain is exactly an allowed domain:
 * no subdomains, no look-alikes (`evilkonnectorllc.com`), no second `@`.
 */
export function isAllowedEmail(email: string | null | undefined, setting: string = env.allowedEmailDomain): boolean {
  const e = normalizeEmail(email);
  const parts = e.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || /\s/.test(e)) return false;
  return allowedDomains(setting).includes(domain);
}

/** Why a sign-in was refused; the login page turns these into messages. */
export type SignInRefusal = "domain" | "unverified" | "disabled";

export const SIGN_IN_ERRORS: Record<SignInRefusal | "link" | "unknown", (domain: string) => string> = {
  domain: (d) => `Only @${d} accounts can sign in.`,
  unverified: () => "Verify your email address with your provider, then try again.",
  disabled: () => "This account has been deactivated. Ask an admin if you need access again.",
  link: () => "That sign-in link has expired or was already used. Request a new one.",
  unknown: () => "We couldn't find that teammate. Pick someone from the list.",
};
