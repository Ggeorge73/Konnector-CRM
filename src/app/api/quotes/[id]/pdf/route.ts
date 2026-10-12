import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/auth/errors";
import { renderQuotePdf } from "@/lib/pdf/quote-pdf";
import { getQuote } from "@/lib/services/capture";
import { ctx } from "@/lib/services/context";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ctx();
  try {
    const q = await getQuote(c, (await params).id);
    const account = await c.store.get("accounts", q.account_id);
    const bytes = await renderQuotePdf({
      number: q.number,
      title: q.title,
      accountName: account?.name ?? "",
      currency: q.currency,
      validUntil: q.valid_until,
      terms: q.terms,
      lines: q.lines.map((l) => ({ item: l.item, description: l.description, qty: l.qty, unit_price: l.unit_price })),
    });
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${q.number}.pdf"` },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
