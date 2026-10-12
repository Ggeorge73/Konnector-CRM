import { NextResponse, type NextRequest } from "next/server";
import { isDemo } from "@/config/app";
import { verify } from "@/lib/integration/signing";
import { decrypt } from "@/lib/server/crypto";
import { demoStore } from "@/lib/server/store";

/**
 * Demo backend only: a webhook receiver for trying subscriptions locally (and for e2e).
 * Verifies X-Konnector-Signature against the secret of any subscription pointing here and
 * keeps the last 50 deliveries in memory. GET lists them; DELETE clears them.
 */
interface Received {
  received_at: string;
  event: string | null;
  verified: boolean;
  body: unknown;
}
const g = globalThis as unknown as { __kcrmWebhookEcho?: Received[] };
const log = () => (g.__kcrmWebhookEcho ??= []);

const available = () => isDemo() && (process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_RESET === "true");
const notAvailable = () => NextResponse.json({ error: "Not available" }, { status: 404 });

export async function POST(req: NextRequest) {
  if (!available()) return notAvailable();
  const raw = await req.text();
  const signature = req.headers.get("x-konnector-signature");
  const subs = (await demoStore().list("webhook_subscriptions", { includeArchived: true })).filter((s) => {
    try {
      return new URL(s.url).pathname === req.nextUrl.pathname;
    } catch {
      return false;
    }
  });
  const verified = subs.some((s) => verify(raw, signature, decrypt(s.secret_enc)).ok);
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    // keep the raw text
  }
  log().unshift({ received_at: new Date().toISOString(), event: req.headers.get("x-konnector-webhook-event"), verified, body });
  log().splice(50);
  if (!verified) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  if (!available()) return notAvailable();
  return NextResponse.json({ received: log() });
}

export async function DELETE() {
  if (!available()) return notAvailable();
  log().splice(0);
  return NextResponse.json({ ok: true });
}
