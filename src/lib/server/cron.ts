import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { logEvent, reportError, type LogValue } from "./observability";

/**
 * Shared shell for /api/cron/* routes: Bearer CRON_SECRET check, one structured log line per run
 * (`cron.<name>.completed` with counts and duration) and error reporting on failure (HTTP 500).
 */
export async function runCron<T extends Record<string, unknown>>(
  req: NextRequest,
  name: string,
  job: () => Promise<T>,
  summarize: (result: T) => Record<string, LogValue>,
): Promise<NextResponse> {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    logEvent(`cron.${name}.unauthorized`, {}, "warn");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  try {
    const result = await job();
    logEvent(`cron.${name}.completed`, { durationMs: Date.now() - started, ...summarize(result) });
    return NextResponse.json(result);
  } catch (e) {
    reportError(e, { source: `cron.${name}`, route: req.nextUrl.pathname });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
