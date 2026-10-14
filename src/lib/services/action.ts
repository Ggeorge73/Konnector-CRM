import "server-only";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { reportError } from "@/lib/server/observability";
import { ctx } from "./context";
import type { Ctx } from "./context-types";

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Wraps a server action body: resolves the user, maps Zod / permission errors to
 * friendly results, and revalidates the given paths on success.
 */
export async function run<T>(fn: (c: Ctx) => Promise<T>, revalidate: string[] = []): Promise<ActionResult<T>> {
  let userId: string | null = null;
  try {
    const c = await ctx();
    userId = c.user.id;
    const data = await fn(c);
    for (const p of revalidate) revalidatePath(p, p.includes("[") ? "page" : undefined);
    return { ok: true, data: JSON.parse(JSON.stringify(data ?? null)) };
  } catch (e) {
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const i of e.issues) fieldErrors[i.path.join(".")] ??= i.message;
      return { ok: false, error: e.issues[0]?.message ?? "Please check the form.", fieldErrors };
    }
    if (e instanceof ForbiddenError || e instanceof ValidationError) return { ok: false, error: e.message };
    if (e && typeof e === "object" && "digest" in e) throw e; // let Next.js redirects/notFound through
    reportError(e, { source: "action", route: await currentPath(), userId });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** The page the action was posted from (middleware sets x-pathname); null outside a request. */
async function currentPath(): Promise<string | null> {
  try {
    return (await headers()).get("x-pathname");
  } catch {
    return null;
  }
}
