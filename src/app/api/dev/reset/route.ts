import { NextResponse } from "next/server";
import { isDemo } from "@/config/app";
import { resetDemoStore } from "@/lib/server/store";

/** Demo backend only: restore seed data (used between Playwright specs). */
export async function POST() {
  if (!isDemo() || (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_RESET !== "true")) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  resetDemoStore();
  return NextResponse.json({ ok: true });
}
