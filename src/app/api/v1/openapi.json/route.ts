import { NextResponse } from "next/server";
import { openApiDocument } from "@/lib/api/openapi";

/** Public: the API description (no data). */
export function GET() {
  return NextResponse.json(openApiDocument(), { headers: { "Cache-Control": "public, max-age=300" } });
}
