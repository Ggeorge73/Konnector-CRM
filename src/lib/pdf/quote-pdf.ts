import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { APP_NAME, COMPANY_NAME } from "@/config/app";
import { dateLabel, money } from "@/lib/format";

/** Client-facing quote: titles, price lines, totals, terms. Never cost, margin or internal notes. */
export interface ClientQuoteDoc {
  number: string;
  title: string;
  accountName: string;
  currency: string;
  validUntil: string | null;
  terms: string | null;
  lines: Array<{ item: string; description: string | null; qty: number; unit_price: number }>;
  version?: number;
}

export async function renderQuotePdf(q: ClientQuoteDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${q.number} — ${q.title}`);
  doc.setAuthor(COMPANY_NAME);
  doc.setCreator(APP_NAME);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.06, 0.07, 0.23);
  const blue = rgb(0, 0.46, 1);
  const grey = rgb(0.35, 0.39, 0.47);
  let page = doc.addPage([612, 792]);
  let y = 740;
  const text = (s: string, x: number, size = 10, f = font, color = navy) => page.drawText(s, { x, y, size, font: f, color });
  // pdf-lib's standard fonts are WinAnsi only; keep text printable.
  const safe = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, "-");

  page.drawRectangle({ x: 0, y: 760, width: 612, height: 32, color: blue });
  y = 771;
  text(COMPANY_NAME, 40, 12, bold, rgb(1, 1, 1));
  y = 720;
  text("QUOTATION", 40, 22, bold);
  y -= 22;
  text(`${q.number}${q.version ? `  ·  v${q.version}` : ""}`, 40, 11, font, grey);
  y -= 30;
  text("Prepared for", 40, 9, font, grey);
  text("Valid until", 380, 9, font, grey);
  y -= 14;
  text(safe(q.accountName), 40, 12, bold);
  text(dateLabel(q.validUntil), 380, 12, bold);
  y -= 30;
  text(safe(q.title), 40, 14, bold);
  y -= 28;

  const cols = { item: 40, qty: 340, unit: 400, total: 490 };
  page.drawRectangle({ x: 36, y: y - 6, width: 540, height: 20, color: rgb(0.93, 0.95, 0.98) });
  text("Item", cols.item, 9, bold, grey);
  text("Qty", cols.qty, 9, bold, grey);
  text("Unit price", cols.unit, 9, bold, grey);
  text("Amount", cols.total, 9, bold, grey);
  y -= 24;
  let total = 0;
  for (const l of q.lines) {
    if (y < 120) {
      page = doc.addPage([612, 792]);
      y = 740;
    }
    const amount = l.qty * l.unit_price;
    total += amount;
    text(safe(l.item).slice(0, 52), cols.item, 10);
    text(String(l.qty), cols.qty, 10);
    text(money(l.unit_price, q.currency), cols.unit, 10);
    text(money(amount, q.currency), cols.total, 10);
    y -= 14;
    if (l.description) {
      text(safe(l.description).slice(0, 80), cols.item, 8, font, grey);
      y -= 12;
    }
    y -= 4;
  }
  y -= 8;
  page.drawLine({ start: { x: 380, y: y + 12 }, end: { x: 576, y: y + 12 }, thickness: 1, color: grey });
  text("Total", cols.unit, 12, bold);
  text(money(total, q.currency), cols.total, 12, bold, blue);
  y -= 40;
  if (q.terms) {
    text("Terms", 40, 9, bold, grey);
    y -= 14;
    for (const line of safe(q.terms).match(/.{1,95}(\s|$)/g) ?? []) {
      text(line.trim(), 40, 9);
      y -= 12;
    }
  }
  page.drawText(`${COMPANY_NAME} · Atlanta, Georgia`, { x: 40, y: 30, size: 8, font, color: grey });
  return doc.save();
}
