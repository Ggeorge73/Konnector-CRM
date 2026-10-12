import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/config/app";
import { inboundHandlers } from "@/lib/integration/handlers";
import { handleInbound } from "@/lib/integration/inbound";
import { systemStore } from "@/lib/server/system-store";
import { systemCtx } from "@/lib/services/system";

/** Inbound webhook from Konnect Hub. HMAC-signed; idempotent; every call logged in integration_events. */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const c = await systemCtx(systemStore());
  const r = await handleInbound(c, body, req.headers.get("x-konnector-signature"), env.integrationSecret, inboundHandlers);
  return NextResponse.json(r.body, { status: r.status });
}
