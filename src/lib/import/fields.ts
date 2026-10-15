/**
 * Import field definitions, mapping suggestions and value normalizers. Pure (no I/O) so the
 * mapping step can run in the browser and the dry run / commit on the server with the same rules.
 */
import {
  BUYING_ROLES,
  IMPORT_ENTITIES,
  OPP_KINDS,
  OPP_SOURCES,
  SERVICE_LINES,
  STAGES,
  type BuyingRole,
  type ImportEntity,
  type OppKind,
  type OppSource,
  type ServiceLine,
  type Stage,
} from "@/lib/domain/types";
import { toCsv } from "./csv";

export { IMPORT_ENTITIES, type ImportEntity };

export const ENTITY_LABEL: Record<ImportEntity, string> = { accounts: "Accounts", contacts: "Contacts", opportunities: "Pipeline" };

export interface ImportField {
  key: string;
  label: string;
  /** Header spellings recognised by the auto-mapper (compared after normalizeHeader). */
  aliases: string[];
  required?: boolean;
  hint?: string;
}

const f = (key: string, label: string, aliases: string[], extra: Partial<ImportField> = {}): ImportField => ({
  key,
  label,
  aliases: [key, label, ...aliases],
  ...extra,
});

export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  accounts: [
    f("name", "Name", ["account", "account name", "company", "company name", "organization", "organisation"], { required: true }),
    f("type", "Type", ["account type"], { hint: "e.g. government_state, private (default private)" }),
    f("sector", "Sector", ["industry"], { hint: "default Unclassified" }),
    f("country", "Country", ["country code"], { hint: "2-letter code (default US)" }),
    f("state_region", "State / region", ["state", "region", "province"]),
    f("city", "City", ["town"]),
    f("website", "Website", ["url", "web", "domain", "site"]),
    f("tier", "Tier", [], { hint: "A, B or C (default C)" }),
    f("status", "Status", ["account status"], { hint: "default prospect" }),
  ],
  contacts: [
    f("first_name", "First name", ["firstname", "first", "given name", "forename"]),
    f("last_name", "Last name", ["lastname", "last", "surname", "family name"]),
    f("full_name", "Full name", ["name", "contact", "contact name"], { hint: "Used when first/last are not mapped" }),
    f("email", "Email", ["e-mail", "email address", "work email", "mail"]),
    f("phone", "Phone", ["phone number", "telephone", "mobile", "tel", "direct phone", "cell"]),
    f("title", "Title", ["job title", "position"]),
    f("account_name", "Account name", ["account", "company", "company name", "organization", "organisation", "employer", "agency"]),
    f("account_domain", "Account domain / website", ["website", "domain", "company website", "company domain", "account website", "url"]),
    f("role_in_buying", "Buying role", ["role", "role in buying", "persona"]),
  ],
  opportunities: [
    f("name", "Name", ["opportunity", "opportunity name", "deal", "deal name", "title"], { required: true }),
    f("account_name", "Account name", ["account", "company", "client", "customer", "agency", "organization", "organisation"]),
    f("account_domain", "Account domain / website", ["website", "domain", "account website", "url"]),
    f("stage", "Stage", ["status", "deal stage", "pipeline stage", "phase"]),
    f("value", "Value", ["amount", "deal value", "contract value", "tcv", "total value", "estimated value"]),
    f("currency", "Currency", ["ccy"]),
    f("owner_email", "Owner email", ["owner", "deal owner", "rep", "sales rep", "account executive", "owner e-mail"]),
    f("kind", "Kind", ["type", "deal type", "opportunity type"]),
    f("expected_close", "Expected close", ["close date", "expected close date", "close"]),
    f("proposal_due", "Proposal due", ["proposal due date", "due date", "response due", "submission date"]),
    f("source", "Source", ["lead source", "origin"]),
    f("service_lines", "Service lines", ["service line", "services", "practice"]),
    f("stage_history", "Stage history", ["history", "stage changes"], { hint: "e.g. 2026-03-01 Qualify; 2026-05-10 Proposal" }),
    f("lost_reason", "Lost reason", ["loss reason", "reason lost", "close reason"]),
  ],
};

/** field key → header in the file (null = not imported). */
export type ImportMapping = Record<string, string | null>;

export const normalizeHeader = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Columns that look like restricted commercial data (cost, margin, bid score, quote). They are
 * never imported: the mapper skips them and the dry run warns about them.
 */
export function isRestrictedHeader(h: string): boolean {
  const n = ` ${normalizeHeader(h)} `;
  return /\s(cost|costs|costing|margin|margins|markup|mark up|profit|gp|score|scores|scorecard|scoring|quote|quotes|quoted|cogs)\s/.test(n);
}

/** Best-guess mapping from the file's headers: exact alias matches only, each header used once. */
export function suggestMapping(entity: ImportEntity, headers: string[]): ImportMapping {
  const used = new Set<string>();
  const out: ImportMapping = {};
  const byNorm = new Map<string, string>();
  for (const h of headers) if (!isRestrictedHeader(h) && !byNorm.has(normalizeHeader(h))) byNorm.set(normalizeHeader(h), h);
  for (const field of IMPORT_FIELDS[entity]) {
    out[field.key] = null;
    for (const alias of field.aliases) {
      const h = byNorm.get(normalizeHeader(alias));
      if (h && !used.has(h)) {
        out[field.key] = h;
        used.add(h);
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Value normalizers
// ---------------------------------------------------------------------------

const LEGAL_SUFFIX = /\s(inc|incorporated|llc|l l c|ltd|limited|corp|corporation|co|company|plc|lp|llp|gmbh|pllc)$/;

/** Account name key for exact matching: case, punctuation, "&"/"and" and legal suffixes ignored. */
export function normalizeName(name: string | null | undefined): string {
  let n = ` ${(name ?? "").toLowerCase().replace(/&/g, " and ")}`
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trimEnd();
  while (LEGAL_SUFFIX.test(n)) n = n.replace(LEGAL_SUFFIX, "");
  return n.replace(/^\sthe\s/, " ").trim();
}

/** Webmail domains never identify an account. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "zoho.com",
]);

/** "https://www.Acme.com/about", "acme.com", "jo@acme.com" → "acme.com". null when it isn't a domain. */
export function domainOf(value: string | null | undefined): string | null {
  let v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.includes("@")) v = v.slice(v.lastIndexOf("@") + 1);
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  v = v.split(/[/?#:]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : null;
}

/** Domain usable for account matching from an email (not webmail). */
export function companyDomainOfEmail(email: string | null | undefined): string | null {
  const d = domainOf(email && email.includes("@") ? email : null);
  return d && !FREE_MAIL_DOMAINS.has(d) ? d : null;
}

const key = (v: string) => normalizeHeader(v).replace(/ /g, "_");

/** Matches free text to an enum value by key or synonym. undefined = blank, null = unrecognised. */
export function matchEnum<T extends string>(
  value: string | null | undefined,
  options: readonly T[],
  synonyms: Record<string, T> = {},
): T | null | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  const k = key(raw);
  const direct = options.find((o) => o === k);
  if (direct) return direct;
  const syn = synonyms[normalizeHeader(raw)];
  return syn ?? null;
}

const syn = <T extends string>(entries: Record<T, string[]>): Record<string, T> =>
  Object.fromEntries(Object.entries<string[]>(entries).flatMap(([k, words]) => words.map((w) => [normalizeHeader(w), k as T])));

export const STAGE_SYNONYMS: Record<string, Stage> = syn<Stage>({
  signal: ["signal", "lead", "new", "prospect", "prospecting", "identified", "idea", "opportunity identified"],
  qualify: ["qualify", "qualified", "qualification", "qualifying", "discovery"],
  capture: ["capture", "capture planning", "solutioning", "shaping", "pursuit", "pursuing", "develop", "developing"],
  bid_no_bid: ["bid no bid", "bid no-bid", "go no go", "gate review", "bid decision", "bid review"],
  proposal: ["proposal", "proposal in progress", "proposal development", "writing", "rfp response", "drafting proposal"],
  submitted: [
    "submitted",
    "proposal sent",
    "proposal submitted",
    "sent",
    "awaiting decision",
    "under evaluation",
    "negotiation",
    "negotiating",
  ],
  won: ["won", "closed won", "win", "awarded", "contract signed", "signed"],
  lost: ["lost", "closed lost", "loss", "not awarded", "unsuccessful"],
  no_bid: ["no bid", "no-bid", "declined", "passed", "no go", "did not bid", "withdrawn"],
});

/** Suggested stage for free text like "Proposal Sent" (undefined = blank, null = unknown). */
export function suggestStage(
  value: string | null | undefined,
  labels: Array<{ key: Stage; label: string }> = [],
): Stage | null | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  const n = normalizeHeader(raw);
  const byLabel = labels.find((l) => normalizeHeader(l.label) === n);
  if (byLabel) return byLabel.key;
  return matchEnum(raw, STAGES, STAGE_SYNONYMS);
}

/** Key used in the user-adjustable stage mapping table. */
export const stageMapKey = (raw: string) => normalizeHeader(raw);

export const KIND_SYNONYMS = syn<OppKind>({
  public_bid: ["public bid", "rfp", "rfq", "rfi", "tender", "government bid", "public", "bid", "solicitation", "public sector"],
  private_deal: ["private deal", "private", "direct", "commercial", "deal", "private sector"],
  reseller_quote: ["reseller quote", "resale", "reseller", "reselling", "hardware", "licenses", "licences", "software resale"],
  staffing_placement: ["staffing", "staffing placement", "placement", "staff augmentation", "contract staffing", "staff aug"],
});

export const SOURCE_SYNONYMS = syn<OppSource>({
  signal: ["signal", "market signal", "research"],
  referral: ["referral", "referred", "word of mouth", "introduction"],
  event: ["event", "conference", "trade show", "expo", "summit"],
  inbound: ["inbound", "website", "web", "inbound lead", "marketing", "rfp portal"],
  partner: ["partner", "channel", "teaming", "teaming partner"],
});

export const SERVICE_LINE_SYNONYMS = syn<ServiceLine>({
  implementation: ["implementation", "delivery", "deployment", "implementation services"],
  systems_integration: ["systems integration", "si", "integration", "system integration"],
  staffing: ["staffing", "staff augmentation", "staff aug"],
  reselling: ["reselling", "resale", "licenses", "licences", "hardware", "software"],
  advisory: ["advisory", "consulting", "strategy", "advisory services"],
});

export const BUYING_ROLE_SYNONYMS = syn<BuyingRole>({
  decision_maker: ["decision maker", "dm", "economic buyer", "approver", "budget holder"],
  influencer: ["influencer", "influence"],
  procurement_officer: ["procurement", "procurement officer", "purchasing", "contracting officer", "buyer", "contracts"],
  technical_evaluator: ["technical evaluator", "technical", "evaluator", "tech", "technical buyer"],
  champion: ["champion", "sponsor", "executive sponsor", "coach"],
});

export const matchKind = (v: string | null | undefined) => matchEnum(v, OPP_KINDS, KIND_SYNONYMS);
export const matchSource = (v: string | null | undefined) => matchEnum(v, OPP_SOURCES, SOURCE_SYNONYMS);
export const matchBuyingRole = (v: string | null | undefined) => matchEnum(v, BUYING_ROLES, BUYING_ROLE_SYNONYMS);

/** "Implementation; Advisory" → ["implementation", "advisory"] plus anything unrecognised. */
export function matchServiceLines(v: string | null | undefined): { lines: ServiceLine[]; unknown: string[] } {
  const lines = new Set<ServiceLine>();
  const unknown: string[] = [];
  for (const part of (v ?? "").split(/[;,|/]/)) {
    const m = matchEnum(part, SERVICE_LINES, SERVICE_LINE_SYNONYMS);
    if (m) lines.add(m);
    else if (m === null) unknown.push(part.trim());
  }
  return { lines: [...lines], unknown };
}

/** ISO date (YYYY-MM-DD) from "2026-03-01", "2026/03/01" or US "3/1/2026". undefined = blank, null = unreadable. */
export function parseDate(value: string | null | undefined): string | null | undefined {
  const v = (value ?? "").trim();
  if (!v) return undefined;
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(v);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "₦": "NGN" };

/** "$1,250,000", "1.2M", "250k", "EUR 90000" → number (+ currency if given). undefined = blank, null = unreadable. */
export function parseMoney(value: string | null | undefined): { value: number; currency?: string } | null | undefined {
  let v = (value ?? "").trim();
  if (!v) return undefined;
  let currency: string | undefined;
  const code = /\b([A-Za-z]{3})\b/.exec(v);
  if (code) {
    currency = code[1].toUpperCase();
    v = v.replace(code[0], "");
  }
  for (const [sym, cur] of Object.entries(CURRENCY_SYMBOLS))
    if (v.includes(sym)) {
      currency ??= cur;
      v = v.replace(sym, "");
    }
  v = v.replace(/[\s,]/g, "");
  const m = /^(-?\d+(?:\.\d+)?)([kKmMbB]?)$/.exec(v);
  if (!m) return null;
  const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase() as "" | "k" | "m" | "b"];
  return { value: Math.round(Number(m[1]) * mult * 100) / 100, currency };
}

export interface HistoryEntry {
  date: string;
  label: string;
}

/**
 * "2026-03-01 Qualify; 2026-05-10 Proposal" (also "Qualify 2026-03-01", "|" or newline separated,
 * US dates) → entries sorted by date, plus the parts that couldn't be read.
 */
export function parseStageHistory(value: string | null | undefined): { entries: HistoryEntry[]; unreadable: string[] } {
  const entries: HistoryEntry[] = [];
  const unreadable: string[] = [];
  const DATE = String.raw`(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}/\d{1,2}/\d{4})`;
  for (const raw of (value ?? "").split(/[;\n|]/)) {
    const part = raw.trim();
    if (!part) continue;
    const first = new RegExp(`^${DATE}\\s*[:\\-–—]?\\s*(.+)$`).exec(part);
    const last = new RegExp(`^(.+?)\\s*[:\\-–—@(]?\\s*${DATE}\\)?$`).exec(part);
    const [d, label] = first ? [first[1], first[2]] : last ? [last[2], last[1]] : [null, null];
    const date = d ? parseDate(d) : null;
    if (!date || !label?.trim()) unreadable.push(part);
    else entries.push({ date, label: label.trim() });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { entries, unreadable };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATE_ROWS: Record<ImportEntity, string[][]> = {
  accounts: [
    ["name", "type", "sector", "country", "state_region", "city", "website", "tier", "status"],
    [
      "Chatham County Government",
      "government_local",
      "County government",
      "US",
      "GA",
      "Savannah",
      "https://www.chathamcountyga.gov",
      "B",
      "prospect",
    ],
  ],
  contacts: [
    ["First name", "Last name", "Email", "Phone", "Title", "Account name", "Account website", "Buying role"],
    [
      "Nadia",
      "Ford",
      "nadia.ford@example.gov",
      "+1 404 555 0100",
      "CIO",
      "Chatham County Government",
      "chathamcountyga.gov",
      "Decision maker",
    ],
  ],
  opportunities: [
    [
      "Name",
      "Account name",
      "Stage",
      "Value",
      "Currency",
      "Owner email",
      "Kind",
      "Expected close",
      "Proposal due",
      "Source",
      "Service lines",
      "Stage history",
      "Lost reason",
    ],
    [
      "Records digitisation",
      "Chatham County Government",
      "Proposal Sent",
      "250000",
      "USD",
      "marcus@konnectorllc.com",
      "Public bid",
      "2026-12-15",
      "2026-11-01",
      "Referral",
      "Implementation; Advisory",
      "2026-03-01 Qualify; 2026-05-10 Proposal",
      "",
    ],
  ],
};

export function templateCsv(entity: ImportEntity): string {
  return toCsv(TEMPLATE_ROWS[entity]);
}
