/**
 * RFC 4180-style CSV reader shared by every import (accounts, contacts, pipeline). Pure and
 * dependency-free so the browser (header preview) and the server (authoritative parse) use the
 * exact same rules: quoted fields, "" escapes, commas and newlines inside quotes, a UTF-8 BOM,
 * and LF / CRLF / CR line endings. Blank lines are skipped.
 */

export const MAX_IMPORT_ROWS = 5_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface CsvTable {
  /** Header cells, trimmed, in file order (duplicates and blanks get a positional suffix). */
  headers: string[];
  /** Body rows as header → trimmed cell. */
  rows: Array<Record<string, string>>;
}

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

/** UTF-8 byte length without Buffer/TextEncoder differences between Node and the browser. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Low-level tokenizer: every record as an array of raw cells. */
export function parseCsvRecords(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.some((f) => f.trim() !== "")) records.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else field += ch;
  }
  if (quoted) throw new CsvError('The file has an unclosed quote. Check that every opening " has a closing ".');
  endRow();
  return records;
}

/**
 * Parses a CSV with a header row and enforces the import limits. Throws CsvError with a
 * message fit for the person uploading the file.
 */
export function parseCsvTable(text: string, limits = { rows: MAX_IMPORT_ROWS, bytes: MAX_IMPORT_BYTES }): CsvTable {
  if (byteLength(text) > limits.bytes) throw new CsvError(`The file is larger than ${Math.round(limits.bytes / 1024 / 1024)} MB.`);
  const [header, ...body] = parseCsvRecords(text);
  if (!header) throw new CsvError("The file is empty. Add a header row and at least one row of data.");
  if (body.length > limits.rows)
    throw new CsvError(`The file has ${body.length.toLocaleString("en-US")} rows; the limit is ${limits.rows.toLocaleString("en-US")}.`);
  const seen = new Map<string, number>();
  const headers = header.map((h, i) => {
    const base = h.trim() || `Column ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} (${n})`;
  });
  return { headers, rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}

/** Quotes a value for CSV output (templates, error reports). */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
