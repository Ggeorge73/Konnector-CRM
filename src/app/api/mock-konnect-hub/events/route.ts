import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/config/app";
import { mockKonnectHub } from "@/lib/integration/mock-konnect-hub";

/** HTTP face of the mock Konnect Hub (when KONNECT_HUB_BASE_URL points at /api/mock-konnect-hub). */
export async function POST(req: NextRequest) {
  if (!env.mockKonnectHub) return NextResponse.json({ error: "mock disabled" }, { status: 404 });
  const body = await req.text();
  const r = await mockKonnectHub.receive(req.headers.get("x-konnector-event") ?? "", body, req.headers.get("x-konnector-signature") ?? "");
  return NextResponse.json(r.body, { status: r.status });
}
