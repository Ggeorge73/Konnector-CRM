/**
 * Sign-in admission and role assignment (KCRM-69).
 *
 * New people from the allowed domain get a users row with role = null ("pending access"):
 * requireUser() sends them to /pending, every service needs a Ctx (which only carries users
 * with a role), and RLS hides every row from them (see 20261014000001_pending_access.sql).
 * An admin assigns the role in Settings → Team; every change is audited.
 */
import { z } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { isAllowedEmail, normalizeEmail, type SignInRefusal } from "@/lib/auth/access";
import { canManageSettings, hasRole, ROLE_LABEL } from "@/lib/auth/permissions";
import type { Store } from "@/lib/data/store";
import { ROLES, type ActiveUser, type Role, type User } from "@/lib/domain/types";
import { tokens } from "@/theme/tokens";
import { audit } from "./audit";
import type { Ctx } from "./context-types";
import { notify } from "./core";
import { systemCtx } from "./system";

/** Avatar colours for new people, from the design tokens. */
const AVATAR_COLORS = [
  tokens.dark.primary,
  tokens.dark.accent,
  tokens.dark.violet,
  tokens.dark.success,
  tokens.dark.gold,
  tokens.dark.warning,
];

export function avatarColorFor(email: string): string {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

export interface SignInIdentity {
  /** The auth identity id (Supabase auth.users.id); a new users row takes the same id. */
  id: string;
  email: string | null | undefined;
  emailVerified: boolean;
  fullName?: string | null;
}

export type Admission = { ok: true; user: User; created: boolean } | { ok: false; reason: SignInRefusal };

/**
 * Server-side gate for every sign-in (OAuth / magic-link callback, demo email sign-in).
 * `store` must be able to read and insert users regardless of RLS (service role in Supabase).
 */
export async function admitSignIn(store: Store, identity: SignInIdentity, now: Date = new Date(), allowed?: string): Promise<Admission> {
  const email = normalizeEmail(identity.email);
  if (!isAllowedEmail(email, allowed)) return { ok: false, reason: "domain" };
  if (!identity.emailVerified) return { ok: false, reason: "unverified" };

  const [existing] = await store.list("users", { where: { email }, includeArchived: true });
  if (existing) return existing.archived_at ? { ok: false, reason: "disabled" } : { ok: true, user: existing, created: false };

  const sys = await systemCtx(store, now);
  const user = await store.insert("users", {
    id: identity.id,
    org_id: sys.user.org_id,
    email,
    full_name: identity.fullName?.trim() || nameFromEmail(email),
    title: "",
    role: null,
    avatar_color: avatarColorFor(email),
    time_zone: "America/New_York",
    created_by: null,
  });
  await audit(sys, "user.pending_created", "users", user.id, null, { email, role: null });
  for (const admin of await store.list("users", { where: { role: "admin" } })) {
    await notify(
      sys,
      admin.id,
      "approval",
      `${user.full_name} is waiting for access`,
      "/settings#team",
      `${email} signed in. Assign a role in Settings → Team.`,
    );
  }
  return { ok: true, user, created: true };
}

/** People who can own, be assigned or be mentioned: everyone with a role. */
export async function activeUsers(store: Store): Promise<ActiveUser[]> {
  return (await store.list("users")).filter(hasRole);
}

export interface TeamMember {
  id: string;
  full_name: string;
  email: string;
  title: string;
  role: Role | null;
  avatar_color: string;
  created_at: string;
  self: boolean;
}

/** Settings → Team: pending people first, then everyone by name. Admin only. */
export async function teamMembers(c: Ctx): Promise<TeamMember[]> {
  if (!canManageSettings(c.user)) throw new ForbiddenError("Only admins can manage the team.");
  const users = await c.store.list("users");
  return users
    .map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      title: u.title,
      role: u.role,
      avatar_color: u.avatar_color,
      created_at: u.created_at,
      self: u.id === c.user.id,
    }))
    .sort((a, b) => Number(a.role !== null) - Number(b.role !== null) || a.full_name.localeCompare(b.full_name));
}

export const RoleInput = z.object({
  user_id: z.string().min(1, "Pick a person."),
  /** null puts the person back to pending access (revokes everything). */
  role: z.enum(ROLES, { error: "Pick a role." }).nullable(),
});
export type RoleInputT = z.input<typeof RoleInput>;

/** Admin assigns, changes or revokes (null) someone's role. Audited; the person is notified. */
export async function setUserRole(c: Ctx, input: RoleInputT): Promise<User> {
  if (!canManageSettings(c.user)) throw new ForbiddenError("Only admins can assign roles.");
  const v = RoleInput.parse(input);
  if (v.user_id === c.user.id) throw new ValidationError("You can't change your own role. Ask another admin.");
  const target = await c.store.get("users", v.user_id);
  if (!target || target.archived_at) throw new ValidationError("That person is no longer active.");
  if (target.role === v.role) return target;
  const row = await c.store.update("users", target.id, { role: v.role });
  await audit(c, v.role ? "user.role_changed" : "user.access_revoked", "users", target.id, { role: target.role }, { role: v.role });
  if (v.role) {
    await notify(
      c,
      target.id,
      "alert",
      target.role ? `Your role is now ${ROLE_LABEL[v.role]}` : `You have access to the CRM as ${ROLE_LABEL[v.role]}`,
      "/",
      null,
    );
  }
  return row;
}
