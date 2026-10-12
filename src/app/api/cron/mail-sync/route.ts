import { NextResponse, type NextRequest } from "next/server";
import { systemStore } from "@/lib/server/system-store";
import { syncAllActive } from "@/lib/services/mail";
import { systemCtx } from "@/lib/services/system";

/** Every 15 minutes: pull new mail + meetings with known contacts for every active connection. Bearer CRON_SECRET. */
export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await syncAllActive(await systemCtx(systemStore()));
  return NextResponse.json({
    connections: results.length,
    stored: results.reduce((n, r) => n + r.stored, 0),
    failed: results.filter((r) => !r.ok).length,
  });
}
