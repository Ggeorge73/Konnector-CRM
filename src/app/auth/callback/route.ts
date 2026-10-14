import { NextResponse, type NextRequest } from "next/server";
import { systemStore } from "@/lib/server/system-store";
import { admitSignIn } from "@/lib/services/users";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * OAuth (Google) / magic-link return. The domain check happens HERE, on the server — the
 * login page's checks and Google's `hd` hint are only conveniences. Anyone outside
 * ALLOWED_EMAIL_DOMAIN (or with an unverified email) is signed straight back out. New people
 * get a users row with no role and land on /pending until an admin assigns one.
 */
export async function GET(req: NextRequest) {
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  const code = req.nextUrl.searchParams.get("code");
  const sb = await supabaseServer();
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return to("/login?error=link");
  }
  const { data } = await sb.auth.getUser();
  const au = data.user;
  if (!au) return to("/login?error=link");

  const meta = (au.user_metadata ?? {}) as { full_name?: string; name?: string };
  // Service role: a brand-new person has no row yet, so RLS would hide the lookup and block the insert.
  const admission = await admitSignIn(systemStore(), {
    id: au.id,
    email: au.email,
    emailVerified: Boolean(au.email_confirmed_at),
    fullName: meta.full_name ?? meta.name ?? null,
  });
  if (!admission.ok) {
    await sb.auth.signOut();
    return to(`/login?error=${admission.reason}`);
  }
  return to(admission.user.role ? "/" : "/pending");
}
