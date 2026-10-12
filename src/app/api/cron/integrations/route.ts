import { NextResponse, type NextRequest } from "next/server";
import { retryDue } from "@/lib/integration/outbox";
import { systemStore } from "@/lib/server/system-store";
import { syncHandoffs } from "@/lib/services/handoff";
import { systemCtx } from "@/lib/services/system";

/** Every few minutes: retry outbound Konnect Hub events whose backoff has elapsed. Bearer CRON_SECRET. */
export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const c = await systemCtx(systemStore());
  const out = await retryDue(c, undefined, req.nextUrl.searchParams.get("force") === "1");
  await syncHandoffs(c);
  return NextResponse.json({ retried: out.length, delivered: out.filter((e) => e.status === "delivered").length });
}
