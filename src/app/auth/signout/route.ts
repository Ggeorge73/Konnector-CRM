import { NextResponse, type NextRequest } from "next/server";
import { isDemo } from "@/config/app";
import { DEMO_COOKIE } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  if (!isDemo()) await (await supabaseServer()).auth.signOut();
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(DEMO_COOKIE);
  return res;
}
