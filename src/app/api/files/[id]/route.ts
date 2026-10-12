import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/auth/errors";
import { ctx } from "@/lib/services/context";
import { readFile } from "@/lib/services/files";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  try {
    const { file, bytes } = await readFile(c, (await params).id);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": file.mime, "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"` },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
