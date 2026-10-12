import { NextResponse, type NextRequest } from "next/server";
import { isDemo } from "@/config/app";
import { DEMO_COOKIE } from "@/lib/auth/session";
import { demoStore } from "@/lib/server/store";

/** Demo backend only: sign in as one of the seeded internal users. */
export async function POST(req: NextRequest) {
  if (!isDemo()) return NextResponse.json({ error: "Demo sign-in is disabled" }, { status: 404 });
  const form = await req.formData();
  const id = String(form.get("user_id") ?? "");
  const user = await demoStore().get("users", id);
  if (!user) return NextResponse.redirect(new URL("/login?error=unknown", req.url), 303);
  const next = String(form.get("next") ?? "/");
  const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", req.url), 303);
  res.cookies.set(DEMO_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  return res;
}
