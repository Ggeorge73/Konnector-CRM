import type { NextRequest } from "next/server";
import { runCron } from "@/lib/server/cron";
import { systemStore } from "@/lib/server/system-store";
import { runComplianceReminders } from "@/lib/services/capture";
import { runExpiryJob } from "@/lib/services/client-items";
import { sendDigests } from "@/lib/services/digest";
import { systemCtx } from "@/lib/services/system";

/** Daily: client-item expiry + nudges, registration/vetting reminders, email digests. Bearer CRON_SECRET. */
export async function POST(req: NextRequest) {
  return runCron(
    req,
    "daily",
    async () => {
      const c = await systemCtx(systemStore());
      const expiry = await runExpiryJob(c);
      const compliance = await runComplianceReminders(c);
      const digests = await sendDigests(c);
      return { expiry, compliance, digests };
    },
    (r) => ({
      expired: r.expiry.expired,
      nudged: r.expiry.nudged,
      complianceReminders: r.compliance.sent,
      digestsBuilt: r.digests.built,
      digestsSent: r.digests.sent,
    }),
  );
}

/** Vercel Cron calls job URLs with GET (same Bearer CRON_SECRET check). */
export const GET = POST;
