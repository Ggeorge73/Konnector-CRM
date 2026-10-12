import { NextResponse, type NextRequest } from "next/server";
import { search } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";

export async function GET(req: NextRequest) {
  const c = await ctx();
  return NextResponse.json(await search(c, req.nextUrl.searchParams.get("q") ?? ""));
}
