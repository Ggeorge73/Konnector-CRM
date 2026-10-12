import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/config/app";
import type { User } from "@/lib/domain/types";
import { getStore } from "@/lib/server/store";
import { supabaseServer } from "@/lib/supabase/server";
import { canOpenRoute } from "./permissions";
export { ForbiddenError } from "./errors";

export const DEMO_COOKIE = "kcrm_uid";

/** Resolve the signed-in internal user, or null. */
export async function currentUser(): Promise<User | null> {
  const store = await getStore();
  if (env.dataBackend === "supabase") {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    const email = data.user?.email?.toLowerCase();
    if (!email || !email.endsWith(`@${env.allowedEmailDomain}`)) return null;
    const [u] = await store.list("users", { where: { email } });
    return u ?? null;
  }
  const id = (await cookies()).get(DEMO_COOKIE)?.value;
  if (!id) return null;
  return store.get("users", id);
}

/** For pages and actions: signed-in user or redirect to login. */
export async function requireUser(pathname?: string): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (pathname && !canOpenRoute(u, pathname)) redirect("/?denied=1");
  return u;
}
