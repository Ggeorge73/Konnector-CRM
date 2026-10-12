import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "@/lib/services/files";
import { verifyFileSignature } from "@/lib/services/handoff";
import { systemStore } from "@/lib/server/system-store";
import { systemCtx } from "@/lib/services/system";

/** Signed, expiring document link handed to Konnect Hub (7-day expiry). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!verifyFileSignature(id, req.nextUrl.searchParams.get("exp"), req.nextUrl.searchParams.get("sig"))) {
    return NextResponse.json({ error: "Link expired or invalid" }, { status: 403 });
  }
  const { file, bytes } = await readFile(await systemCtx(systemStore()), id);
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": file.mime, "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"` },
  });
}
