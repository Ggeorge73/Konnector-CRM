import type { NextRequest } from "next/server";
import { runCron } from "@/lib/server/cron";
import { systemStore } from "@/lib/server/system-store";
import { syncAllActive } from "@/lib/services/mail";
import { systemCtx } from "@/lib/services/system";

/** Every 15 minutes: pull new mail + meetings with known contacts for every active connection. Bearer CRON_SECRET. */
export async function POST(req: NextRequest) {
  return runCron(
    req,
    "mail-sync",
    async () => {
      const results = await syncAllActive(await systemCtx(systemStore()));
      return {
        connections: results.length,
        stored: results.reduce((n, r) => n + r.stored, 0),
        failed: results.filter((r) => !r.ok).length,
      };
    },
    (r) => r,
  );
}

/** Vercel Cron calls job URLs with GET (same Bearer CRON_SECRET check). */
export const GET = POST;
