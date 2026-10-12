import { NextResponse, type NextRequest } from "next/server";
import { systemStore } from "@/lib/server/system-store";
import { runComplianceReminders } from "@/lib/services/capture";
import { runExpiryJob } from "@/lib/services/client-items";
import { sendDigests } from "@/lib/services/digest";
import { systemCtx } from "@/lib/services/system";

/** Daily: client-item expiry + nudges, registration/vetting reminders, email digests. Bearer CRON_SECRET. */
export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const c = await systemCtx(systemStore());
  const expiry = await runExpiryJob(c);
  const compliance = await runComplianceReminders(c);
  const digests = await sendDigests(c);
  return NextResponse.json({ expiry, compliance, digests });
}
