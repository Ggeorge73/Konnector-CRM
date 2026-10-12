import { NextResponse, type NextRequest } from "next/server";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { ctx } from "@/lib/services/context";
import { uploadFile } from "@/lib/services/files";
import type { RelatedType } from "@/lib/domain/types";

export async function POST(req: NextRequest) {
  const c = await ctx();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  try {
    const row = await uploadFile(
      c,
      file,
      String(form.get("related_type")) as RelatedType,
      String(form.get("related_id")),
      (form.get("account_id") as string) || null,
    );
    return NextResponse.json(row);
  } catch (e) {
    if (e instanceof ValidationError || e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
