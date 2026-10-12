import { describe, expect, it } from "vitest";
import { renderQuotePdf, type ClientQuoteDoc } from "@/lib/pdf/quote-pdf";

describe("client quote PDF", () => {
  it("renders a PDF from client-facing fields only", async () => {
    const doc: ClientQuoteDoc = {
      number: "Q-2026-0001",
      title: "Test",
      accountName: "City of Atlanta",
      currency: "USD",
      validUntil: "2026-11-01",
      terms: "Net 30",
      lines: [{ item: "Thing", description: null, qty: 2, unit_price: 100 }],
    };
    const bytes = await renderQuotePdf(doc);
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
    // The document type itself has no cost / margin / notes fields.
    const keys = Object.keys(doc).concat(Object.keys(doc.lines[0]));
    expect(keys.some((k) => /cost|margin|internal/i.test(k))).toBe(false);
  });
});
