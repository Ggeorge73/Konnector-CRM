/**
 * Duplicate detection rules (KCRM-77). Pure functions: normalisation, pair scoring and
 * blocking, unit-tested in src/lib/__tests__/dedupe.test.ts. The service layer
 * (src/lib/services/dedupe.ts) loads rows, applies dismissals and permissions.
 *
 * Scoring: each signal that fires has a weight (0..1). Signals combine like independent
 * evidence, score = 100 × (1 − Π(1 − weight)), so one strong signal lists a pair and
 * several signals push it towards 100. Every pair carries the reasons that fired.
 */
import type { Account, Contact, DedupeEntity } from "./types";

// ---------------- Thresholds and weights ----------------

/** Trigram (pg_trgm-style) Jaccard similarity at or above which two account names count as "close". */
export const NAME_SIMILARITY_THRESHOLD = 0.6;

export const ACCOUNT_WEIGHTS = {
  same_name: 0.9,
  same_domain: 0.8,
  /** Multiplied by the similarity (0.6–1.0 → 0.48–0.8). */
  similar_name: 0.8,
} as const;

export const CONTACT_WEIGHTS = {
  same_email: 0.9,
  same_name_same_account: 0.8,
  same_phone: 0.6,
} as const;

/** Account fields a leader picks from either side when merging. lat/lng travel with city. */
export const ACCOUNT_MERGE_FIELDS = [
  "name",
  "type",
  "sector",
  "status",
  "tier",
  "owner_id",
  "website",
  "country",
  "state_region",
  "city",
  "description",
] as const satisfies ReadonlyArray<keyof Account>;
export type AccountMergeField = (typeof ACCOUNT_MERGE_FIELDS)[number];

/** What the merge functions accept in p_patch (the picked fields plus coordinates). */
export const ACCOUNT_PATCH_KEYS: ReadonlyArray<keyof Account> = [...ACCOUNT_MERGE_FIELDS, "lat", "lng"];

export const CONTACT_MERGE_FIELDS = [
  "first_name",
  "last_name",
  "title",
  "email",
  "phone",
  "role_in_buying",
  "account_id",
  "owner_id",
] as const satisfies ReadonlyArray<keyof Contact>;
export type ContactMergeField = (typeof CONTACT_MERGE_FIELDS)[number];
export const CONTACT_PATCH_KEYS: ReadonlyArray<keyof Contact> = CONTACT_MERGE_FIELDS;

// ---------------- Normalisation ----------------

const stripDiacritics = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Legal-form suffixes and filler words ignored when comparing organisation names. */
const COMPANY_NOISE = new Set([
  "the",
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "plc",
  "lp",
  "llp",
  "pllc",
  "pc",
  "gmbh",
  "ag",
  "sa",
  "pty",
]);

/**
 * "The Harborline Logistics, Inc." → "harborline logistics". Case, punctuation, diacritics,
 * "&"/"and", a leading or embedded "the" and legal suffixes (LLC, Inc, Corp…) are ignored.
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  const tokens = stripDiacritics(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’]/g, "") // "L.L.C." → "llc", "O'Neil" → "oneil"
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const kept = tokens.filter((t) => !COMPANY_NOISE.has(t));
  return (kept.length ? kept : tokens).join(" ");
}

/** "https://www.Example.com/about" → "example.com"; bare hosts are accepted; junk → null. */
export function websiteDomain(url: string | null | undefined): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    const h = host.replace(/^www\d*\./, "").replace(/\.$/, "");
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Case-insensitive email key. For Gmail/Googlemail only, dots and "+tags" in the local part are
 * dropped (Google delivers those to the same mailbox). Other domains keep dots and plus-tags,
 * because corporate mail servers may route them to different people.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return null;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.split("+")[0].replace(/\./g, "");
    domain = "gmail.com";
  }
  return local ? `${local}@${domain}` : null;
}

/** Digits only; a leading US/Canada "1" on an 11-digit number is dropped. Fewer than 7 digits → null. */
export function phoneDigits(phone: string | null | undefined): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length >= 7 ? d : null;
}

export function normalizePersonName(first: string | null | undefined, last: string | null | undefined): string {
  return stripDiacritics(`${first ?? ""} ${last ?? ""}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------- Similarity ----------------

/** pg_trgm-style trigrams: each word padded with two leading spaces and one trailing space. */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

/** |A ∩ B| / |A ∪ B| over trigrams of the two strings (0..1). */
export function trigramSimilarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

// ---------------- Pair scoring ----------------

export type DuplicateReason =
  | { code: "same_name"; label: string }
  | { code: "same_domain"; label: string }
  | { code: "similar_name"; label: string; similarity: number }
  | { code: "same_email"; label: string }
  | { code: "same_name_same_account"; label: string }
  | { code: "same_phone"; label: string };

export interface ScoredPair {
  /** Canonical order: a < b. */
  a: string;
  b: string;
  score: number;
  reasons: DuplicateReason[];
}

export const combine = (weights: number[]) => Math.round(100 * (1 - weights.reduce((p, w) => p * (1 - w), 1)));

export const pairKey = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
export const pairId = (x: string, y: string) => pairKey(x, y).join(":");

type AccountLike = Pick<Account, "id" | "name" | "website">;
type ContactLike = Pick<Contact, "id" | "account_id" | "first_name" | "last_name" | "email" | "phone">;

/** Score one pair of accounts, or null when nothing matches. */
export function scoreAccountPair(x: AccountLike, y: AccountLike): ScoredPair | null {
  const reasons: DuplicateReason[] = [];
  const weights: number[] = [];
  const nx = normalizeCompanyName(x.name);
  const ny = normalizeCompanyName(y.name);
  if (nx && nx === ny) {
    reasons.push({ code: "same_name", label: `Same name once suffixes and punctuation are ignored ("${nx}")` });
    weights.push(ACCOUNT_WEIGHTS.same_name);
  } else if (nx && ny) {
    const sim = trigramSimilarity(nx, ny);
    if (sim >= NAME_SIMILARITY_THRESHOLD) {
      const pct = Math.round(sim * 100);
      reasons.push({ code: "similar_name", label: `Similar names (${pct}% trigram match)`, similarity: sim });
      weights.push(ACCOUNT_WEIGHTS.similar_name * sim);
    }
  }
  const dx = websiteDomain(x.website);
  if (dx && dx === websiteDomain(y.website)) {
    reasons.push({ code: "same_domain", label: `Same website domain (${dx})` });
    weights.push(ACCOUNT_WEIGHTS.same_domain);
  }
  if (!weights.length) return null;
  const [a, b] = pairKey(x.id, y.id);
  return { a, b, score: combine(weights), reasons };
}

/** Score one pair of contacts, or null when nothing matches. */
export function scoreContactPair(x: ContactLike, y: ContactLike): ScoredPair | null {
  const reasons: DuplicateReason[] = [];
  const weights: number[] = [];
  const ex = normalizeEmail(x.email);
  if (ex && ex === normalizeEmail(y.email)) {
    reasons.push({ code: "same_email", label: `Same email (${ex})` });
    weights.push(CONTACT_WEIGHTS.same_email);
  }
  const nx = normalizePersonName(x.first_name, x.last_name);
  if (nx && x.account_id === y.account_id && nx === normalizePersonName(y.first_name, y.last_name)) {
    reasons.push({ code: "same_name_same_account", label: "Same name at the same account" });
    weights.push(CONTACT_WEIGHTS.same_name_same_account);
  }
  const px = phoneDigits(x.phone);
  if (px && px === phoneDigits(y.phone)) {
    reasons.push({ code: "same_phone", label: "Same phone number" });
    weights.push(CONTACT_WEIGHTS.same_phone);
  }
  if (!weights.length) return null;
  const [a, b] = pairKey(x.id, y.id);
  return { a, b, score: combine(weights), reasons };
}

// ---------------- Blocking: only score pairs that share a key ----------------

function candidatePairs<T extends { id: string }>(rows: T[], keysOf: (r: T) => Array<string | null>): Array<[T, T]> {
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    for (const k of keysOf(r)) {
      if (!k) continue;
      const list = buckets.get(k);
      if (list) list.push(r);
      else buckets.set(k, [r]);
    }
  }
  const seen = new Set<string>();
  const out: Array<[T, T]> = [];
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].id === list[j].id) continue;
        const id = pairId(list[i].id, list[j].id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push([list[i], list[j]]);
      }
    }
  }
  return out;
}

/**
 * Candidate account pairs for the similarity check without comparing every pair: an inverted
 * trigram index counts shared trigrams, and only pairs whose Jaccard can reach the threshold
 * are kept.
 */
function similarNameCandidates<T extends AccountLike>(rows: T[]): Array<[T, T]> {
  const grams = rows.map((r) => [...trigrams(normalizeCompanyName(r.name))]);
  const index = new Map<string, number[]>();
  const out: Array<[T, T]> = [];
  grams.forEach((gs, i) => {
    const shared = new Map<number, number>();
    for (const g of gs) {
      for (const j of index.get(g) ?? []) shared.set(j, (shared.get(j) ?? 0) + 1);
    }
    for (const [j, n] of shared) {
      if (n / (gs.length + grams[j].length - n) >= NAME_SIMILARITY_THRESHOLD) out.push([rows[j], rows[i]]);
    }
    for (const g of gs) {
      const list = index.get(g);
      if (list) list.push(i);
      else index.set(g, [i]);
    }
  });
  return out;
}

function scoreAll<T extends { id: string }>(
  pairs: Array<[T, T]>,
  scorer: (x: T, y: T) => ScoredPair | null,
  dismissed: ReadonlySet<string>,
): ScoredPair[] {
  const byId = new Map<string, ScoredPair>();
  for (const [x, y] of pairs) {
    const id = pairId(x.id, y.id);
    if (byId.has(id) || dismissed.has(id)) continue;
    const s = scorer(x, y);
    if (s) byId.set(id, s);
  }
  return [...byId.values()].sort((p, q) => q.score - p.score || p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
}

/** Likely duplicate accounts, highest score first. `dismissed` holds pairId()s marked "not a duplicate". */
export function findAccountDuplicates<T extends AccountLike>(rows: T[], dismissed: ReadonlySet<string> = new Set()): ScoredPair[] {
  const exact = candidatePairs(rows, (r) => {
    const name = normalizeCompanyName(r.name);
    const domain = websiteDomain(r.website);
    return [name ? `n:${name}` : null, domain ? `d:${domain}` : null];
  });
  return scoreAll([...exact, ...similarNameCandidates(rows)], scoreAccountPair, dismissed);
}

/** Likely duplicate contacts, highest score first. */
export function findContactDuplicates<T extends ContactLike>(rows: T[], dismissed: ReadonlySet<string> = new Set()): ScoredPair[] {
  const pairs = candidatePairs(rows, (r) => {
    const name = normalizePersonName(r.first_name, r.last_name);
    const email = normalizeEmail(r.email);
    const phone = phoneDigits(r.phone);
    return [email && `e:${email}`, phone && `p:${phone}`, name ? `n:${r.account_id}:${name}` : null];
  });
  return scoreAll(pairs, scoreContactPair, dismissed);
}

export const DEDUPE_LABEL: Record<DedupeEntity, string> = { accounts: "account", contacts: "contact" };
