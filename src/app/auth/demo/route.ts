import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isDemo } from "@/config/app";
import { DEMO_COOKIE } from "@/lib/auth/session";
import { demoStore } from "@/lib/server/store";
import { admitSignIn } from "@/lib/services/users";

/**
 * Demo backend only. Two ways in:
 * - `user_id`: sign in as one of the seeded internal users (the teammate picker);
 * - `email`: behave like the production callback — the same admitSignIn() domain check, and a
 *   new address gets a pending (no role) user — so the pending-access flow can be tried and tested.
 */
export async function POST(req: NextRequest) {
  if (!isDemo()) return NextResponse.json({ error: "Demo sign-in is disabled" }, { status: 404 });
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  const form = await req.formData();
  const email = form.get("email");

  let userId: string;
  let landing: string;
  if (typeof email === "string") {
    const admission = await admitSignIn(demoStore(), { id: randomUUID(), email, emailVerified: true });
    if (!admission.ok) return to(`/login?error=${admission.reason}`);
    userId = admission.user.id;
    landing = admission.user.role ? "/" : "/pending";
  } else {
    const user = await demoStore().get("users", String(form.get("user_id") ?? ""));
    if (!user || user.archived_at) return to("/login?error=unknown");
    userId = user.id;
    const next = String(form.get("next") ?? "/");
    landing = !user.role ? "/pending" : next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }
  const res = to(landing);
  res.cookies.set(DEMO_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  return res;
}
