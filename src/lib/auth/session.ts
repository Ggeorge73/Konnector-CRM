import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/config/app";
import type { ActiveUser, User } from "@/lib/domain/types";
import { getStore } from "@/lib/server/store";
import { supabaseServer } from "@/lib/supabase/server";
import { isAllowedEmail } from "./access";
import { canOpenRoute, hasRole } from "./permissions";
export { ForbiddenError } from "./errors";

export const DEMO_COOKIE = "kcrm_uid";

/**
 * Resolve the signed-in internal user, or null. The user may still be pending (role null) —
 * use requireUser() for anything that reads or writes CRM data.
 */
export async function currentUser(): Promise<User | null> {
  const store = await getStore();
  if (env.dataBackend === "supabase") {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    const email = data.user?.email?.toLowerCase();
    if (!email || !isAllowedEmail(email)) return null;
    const [u] = await store.list("users", { where: { email } });
    return u ?? null;
  }
  const id = (await cookies()).get(DEMO_COOKIE)?.value;
  if (!id) return null;
  const u = await store.get("users", id);
  return u && !u.archived_at ? u : null;
}

/**
 * For pages, actions and route handlers: a signed-in user with a role. No session → /login;
 * signed in but no role yet → /pending (every app route, action and API call goes through here).
 */
export async function requireUser(pathname?: string): Promise<ActiveUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (!hasRole(u)) redirect("/pending");
  if (pathname && !canOpenRoute(u, pathname)) redirect("/?denied=1");
  return u;
}
