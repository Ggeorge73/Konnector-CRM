import { NextResponse } from "next/server";
import { isDemo } from "@/config/app";
import { currentUser } from "@/lib/auth/session";
import { demoStore } from "@/lib/server/store";

/** Demo backend live updates: a cheap version counter the client polls. Supabase mode uses Realtime instead. */
export async function GET() {
  if (!isDemo()) return NextResponse.json({ version: null });
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ version: demoStore().version }, { headers: { "Cache-Control": "no-store" } });
}
