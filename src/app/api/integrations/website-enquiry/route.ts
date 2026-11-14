import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/config/app";
import { systemStore } from "@/lib/server/system-store";
import { systemCtx } from "@/lib/services/system";
import { receiveWebsiteEnquiry } from "@/lib/services/website-leads";

/**
 * Inbound enquiries from konnectortech.com (`pushLead` in the website's contact route).
 * HMAC-signed (`X-Konnector-Signature: sha256=<hex>`); idempotent on receivedAt + email; logged in integration_events.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const c = await systemCtx(systemStore());
  const r = await receiveWebsiteEnquiry(c, body, req.headers.get("x-konnector-signature"), {
    secret: env.leadWebhookSecret,
    defaultOwnerEmail: env.leadDefaultOwnerEmail,
  });
  return NextResponse.json(r.body, { status: r.status });
}
