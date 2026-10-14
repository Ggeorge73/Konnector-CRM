import { NextResponse } from "next/server";
import pkg from "../../../../package.json";
import { env } from "@/config/app";
import { httpStatusFor, runHealth } from "@/lib/server/health";
import { logEvent } from "@/lib/server/observability";
import { systemStore } from "@/lib/server/system-store";

export const dynamic = "force-dynamic";

/** Uses the built-in mock when MOCK_KONNECT_HUB=true, or when the flag is left on and no Hub URL is set. */
function usesMockHub() {
  return process.env.MOCK_KONNECT_HUB === "true" || (env.mockKonnectHub && !env.konnectHubBaseUrl);
}

/** Public, unauthenticated health check for uptime monitors. See docs/OPERATIONS.md. */
export async function GET() {
  const report = await runHealth({
    pingDatabase: async () => {
      await systemStore().list("organizations", { limit: 1 });
    },
    probeKonnectHub: async (signal) => {
      if (usesMockHub()) return "mock";
      if (!env.konnectHubBaseUrl) return "not_configured";
      const res = await fetch(env.konnectHubBaseUrl, { method: "GET", redirect: "manual", cache: "no-store", signal });
      await res.body?.cancel();
      return res.status;
    },
    version: pkg.version,
    commit: (process.env.APP_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
  });
  if (report.status !== "ok") {
    logEvent(
      "health.unhealthy",
      {
        status: report.status,
        database: report.checks.database.status,
        databaseReason: report.checks.database.reason,
        konnectHub: report.checks.konnectHub.status,
        konnectHubReason: report.checks.konnectHub.reason,
      },
      "warn",
    );
  }
  return NextResponse.json(report, { status: httpStatusFor(report), headers: { "Cache-Control": "no-store" } });
}
