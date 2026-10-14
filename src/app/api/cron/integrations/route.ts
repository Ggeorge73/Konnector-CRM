import type { NextRequest } from "next/server";
import { retryDue } from "@/lib/integration/outbox";
import { runCron } from "@/lib/server/cron";
import { systemStore } from "@/lib/server/system-store";
import { syncHandoffs } from "@/lib/services/handoff";
import { systemCtx } from "@/lib/services/system";
import { retryDueWebhooks } from "@/lib/services/webhooks";

/** Every few minutes: retry outbound Konnect Hub events and webhooks whose backoff has elapsed. Bearer CRON_SECRET. */
export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  return runCron(
    req,
    "integrations",
    async () => {
      const c = await systemCtx(systemStore());
      const out = await retryDue(c, undefined, force);
      await syncHandoffs(c);
      const hooks = await retryDueWebhooks(c, undefined, force);
      return {
        retried: out.length,
        delivered: out.filter((e) => e.status === "delivered").length,
        webhooks: { retried: hooks.length, delivered: hooks.filter((d) => d.status === "delivered").length },
      };
    },
    (r) => ({
      retried: r.retried,
      delivered: r.delivered,
      webhooksRetried: r.webhooks.retried,
      webhooksDelivered: r.webhooks.delivered,
    }),
  );
}

/** Vercel Cron calls job URLs with GET (same Bearer CRON_SECRET check). */
export const GET = POST;
