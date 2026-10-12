import { NextResponse, type NextRequest } from "next/server";
import { env, isDemo } from "@/config/app";
import { inboundHandlers } from "@/lib/integration/handlers";
import { handleInbound } from "@/lib/integration/inbound";
import { mockKonnectHub } from "@/lib/integration/mock-konnect-hub";
import { systemStore } from "@/lib/server/system-store";
import { systemCtx } from "@/lib/services/system";

/**
 * Dev/demo only: make the mock Konnect Hub act — send a signed event back to the CRM as if a
 * project's health changed or a client acted in the portal. Also `{ "control": { "failNext": n } }`.
 */
export async function POST(req: NextRequest) {
  if (!env.mockKonnectHub || !(isDemo() || process.env.NODE_ENV !== "production"))
    return NextResponse.json({ error: "mock disabled" }, { status: 404 });
  const json = (await req.json()) as Record<string, unknown>;
  if (json.control) {
    const ctl = json.control as { failNext?: number; reset?: boolean };
    if (ctl.reset) mockKonnectHub.reset();
    if (typeof ctl.failNext === "number") mockKonnectHub.failNext(ctl.failNext);
    return NextResponse.json({ ok: true });
  }
  const { body, signature } = mockKonnectHub.signed(json);
  const c = await systemCtx(systemStore());
  const r = await handleInbound(c, body, signature, env.integrationSecret, inboundHandlers);
  return NextResponse.json(r.body, { status: r.status });
}
