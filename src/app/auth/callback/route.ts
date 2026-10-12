import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/config/app";
import { supabaseServer } from "@/lib/supabase/server";

/** OAuth / magic-link return. Rejects anyone outside the internal email domain. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const sb = await supabaseServer();
  if (code) await sb.auth.exchangeCodeForSession(code);
  const { data } = await sb.auth.getUser();
  const email = data.user?.email?.toLowerCase() ?? "";
  if (!email.endsWith(`@${env.allowedEmailDomain}`)) {
    await sb.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=domain", req.url), 303);
  }
  return NextResponse.redirect(new URL("/", req.url), 303);
}
