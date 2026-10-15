/**
 * CSV import framework (KCRM-75 contacts, KCRM-76 pipeline; accounts moved onto it).
 *
 *   planImport()   parse + map + validate + match, nothing written      → dry run preview
 *   commitImport() the same plan, written in one batch per table        → import_batches row + one audit entry
 *   undoImport()   archives exactly what a batch created, if untouched  → importer or a leader, within 7 days
 *
 * Dry run and commit share planImport(), so the preview is exactly what gets written.
 * Restricted commercial data (cost, margin, bid scores, quotes) is never imported.
 */
import { z } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { canImport, canUndoImport, hasRole, IMPORT_UNDO_DAYS, isLeader } from "@/lib/auth/permissions";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  IMPORT_ENTITIES,
  STAGES,
  type Account,
  type ImportBatch,
  type ImportCreatedIds,
  type ImportEntity,
  type NewRow,
  type Opportunity,
  type OppKind,
  type ServiceLine,
  type Stage,
} from "@/lib/domain/types";
import { CsvError, MAX_IMPORT_BYTES, parseCsvTable, type CsvTable } from "@/lib/import/csv";
import {
  companyDomainOfEmail,
  domainOf,
  IMPORT_FIELDS,
  isRestrictedHeader,
  matchBuyingRole,
  matchEnum,
  matchKind,
  matchServiceLines,
  matchSource,
  normalizeName,
  parseDate,
  parseMoney,
  parseStageHistory,
  stageMapKey,
  suggestMapping,
  suggestStage,
  type ImportMapping,
} from "@/lib/import/fields";
import { audit } from "./audit";
import type { Ctx } from "./context-types";
import { AccountInput, usersById, visibleAccounts, visibleOpportunities } from "./core";
import { orgSettings } from "./pulse";
import { actorId } from "./system";
import { emitEvent, subscribedEvents, webhookData } from "./webhooks";

// ---------------------------------------------------------------------------
// Request / preview shapes
// ---------------------------------------------------------------------------

export const ImportRequest = z.object({
  entity: z.enum(IMPORT_ENTITIES),
  csv: z.string().min(1, "Choose a CSV file first").max(MAX_IMPORT_BYTES, "The file is larger than 5 MB."),
  file_name: z.string().trim().min(1).max(200),
  mapping: z.record(z.string(), z.string().nullable()),
  options: z
    .object({
      create_missing_accounts: z.boolean().optional(),
      /** Opportunities: owner for rows whose owner email is unknown or blank (default: the importer). */
      fallback_owner_id: z.string().uuid().nullable().optional(),
      /** Opportunities: stageMapKey(raw text) → stage. Overrides the suggestion. */
      stage_map: z.record(z.string(), z.enum(STAGES)).optional(),
    })
    .optional(),
});
export type ImportRequestT = z.input<typeof ImportRequest>;

export type RowStatus = "create" | "skip" | "error";

export interface PreviewRow {
  /** File row number (header = row 1). */
  row: number;
  status: RowStatus;
  /** What the row is (contact name, account name, deal name). */
  label: string;
  /** Account the row attaches to, and whether it already exists or will be created. */
  account: string | null;
  account_action: "match" | "create" | null;
  /** Why the row is skipped or failed. */
  reasons: string[];
  /** Non-blocking notes (defaults applied, values ignored). */
  notes: string[];
}

export interface StageValue {
  /** Text as it appears in the file (first spelling seen). */
  raw: string;
  /** stage_map key. */
  key: string;
  count: number;
  suggested: Stage | null;
  mapped: Stage | null;
}

export interface ImportPreview {
  entity: ImportEntity;
  file_name: string;
  headers: string[];
  mapping: ImportMapping;
  rows: PreviewRow[];
  totals: { rows: number; create: number; skip: number; error: number; accounts_to_create: number };
  warnings: string[];
  /** Columns that look like cost / margin / score / quote data — never imported. */
  ignored_columns: string[];
  unmatched_accounts: string[];
  unknown_owners: string[];
  stage_values: StageValue[];
  fallback_owner: { id: string; name: string } | null;
}

interface Plan {
  preview: ImportPreview;
  accounts: NewRow<"accounts">[];
  contacts: NewRow<"contacts">[];
  opportunities: NewRow<"opportunities">[];
  activities: NewRow<"activities">[];
}

const uuid = () => globalThis.crypto.randomUUID();

// ---------------------------------------------------------------------------
// Planning (shared by dry run and commit)
// ---------------------------------------------------------------------------

/** Builds the full plan for a request. Reads only. */
export async function planImport(c: Ctx, input: ImportRequestT): Promise<Plan> {
  const req = ImportRequest.parse(input);
  if (!canImport(c.user, req.entity)) throw new ForbiddenError("You can't import this kind of record.");
  let table: CsvTable;
  try {
    table = parseCsvTable(req.csv);
  } catch (e) {
    if (e instanceof CsvError) throw new ValidationError(e.message);
    throw e;
  }
  if (table.rows.length === 0) throw new ValidationError("The file has a header row but no data.");

  const warnings: string[] = [];
  const ignored = table.headers.filter(isRestrictedHeader);
  if (ignored.length)
    warnings.push(
      `Ignored ${ignored.length === 1 ? "1 column that looks" : `${ignored.length} columns that look`} like cost, margin, score or quote data ` +
        `(${ignored.join(", ")}). Restricted commercial data is never imported.`,
    );

  // Only known fields, only headers that exist, never a restricted column.
  const mapping: ImportMapping = {};
  for (const field of IMPORT_FIELDS[req.entity]) {
    const h = req.mapping[field.key] ?? null;
    mapping[field.key] = h && table.headers.includes(h) && !isRestrictedHeader(h) ? h : null;
  }
  for (const field of IMPORT_FIELDS[req.entity])
    if (field.required && !mapping[field.key]) throw new ValidationError(`Map a column to "${field.label}".`);

  const ctx: PlanCtx = {
    c,
    req,
    table,
    mapping,
    get: (r, k) => (mapping[k] ? (r[mapping[k]!] ?? "").trim() : ""),
    accounts: new AccountResolver(c, await visibleAccounts(c), !!req.options?.create_missing_accounts),
  };
  const body =
    req.entity === "accounts"
      ? await planAccounts(ctx)
      : req.entity === "contacts"
        ? await planContacts(ctx)
        : await planOpportunities(ctx);

  const rows = body.rows;
  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  // Only create missing accounts that a row being imported actually uses.
  const used = new Set([...(body.contacts ?? []), ...(body.opportunities ?? [])].map((x) => x.account_id));
  const newAccounts = ctx.accounts.planned().filter((a) => used.has(a.id!));
  const unmatched = ctx.accounts.unmatched();
  if (unmatched.length)
    warnings.push(
      `${unmatched.length} account name${unmatched.length === 1 ? "" : "s"} didn't match an account you can see. ` +
        `Turn on "Create missing accounts" to add them, owned by you.`,
    );
  const preview: ImportPreview = {
    entity: req.entity,
    file_name: req.file_name,
    headers: table.headers,
    mapping,
    rows,
    totals: {
      rows: rows.length,
      create: count("create"),
      skip: count("skip"),
      error: count("error"),
      accounts_to_create: req.entity === "accounts" ? count("create") : newAccounts.length,
    },
    warnings: [...warnings, ...body.warnings],
    ignored_columns: ignored,
    unmatched_accounts: unmatched,
    unknown_owners: body.unknownOwners ?? [],
    stage_values: body.stageValues ?? [],
    fallback_owner: body.fallbackOwner ?? null,
  };

  return {
    preview,
    accounts: req.entity === "accounts" ? (body.accounts ?? []) : newAccounts,
    contacts: body.contacts ?? [],
    opportunities: body.opportunities ?? [],
    activities: [...accountActivities(c, req.entity === "accounts" ? (body.accounts ?? []) : newAccounts), ...(body.activities ?? [])],
  };
}

interface PlanCtx {
  c: Ctx;
  req: z.output<typeof ImportRequest>;
  table: CsvTable;
  mapping: ImportMapping;
  get: (r: Record<string, string>, key: string) => string;
  accounts: AccountResolver;
}

interface PlanBody {
  rows: PreviewRow[];
  warnings: string[];
  accounts?: NewRow<"accounts">[];
  contacts?: NewRow<"contacts">[];
  opportunities?: NewRow<"opportunities">[];
  activities?: NewRow<"activities">[];
  unknownOwners?: string[];
  stageValues?: StageValue[];
  fallbackOwner?: { id: string; name: string };
}

const row = (n: number, label: string): PreviewRow => ({
  row: n,
  status: "create",
  label,
  account: null,
  account_action: null,
  reasons: [],
  notes: [],
});
const finish = (p: PreviewRow, duplicate?: string) => {
  p.status = p.reasons.length ? "error" : duplicate ? "skip" : "create";
  if (p.status === "skip") p.reasons.push(duplicate!);
  return p;
};

function newAccountRow(c: Ctx, name: string, website: string | null): NewRow<"accounts"> {
  return {
    id: uuid(),
    org_id: c.user.org_id,
    name,
    type: "private",
    sector: "Unclassified",
    country: "US",
    state_region: null,
    city: null,
    lat: null,
    lng: null,
    website,
    logo_url: null,
    owner_id: c.user.id,
    tier: "C",
    status: "prospect",
    konnect_hub_client_id: null,
    survey_score: null,
    description: null,
    created_by: actorId(c),
  };
}

function accountActivities(c: Ctx, accounts: NewRow<"accounts">[]): NewRow<"activities">[] {
  return accounts.map((a) =>
    activity(c, { type: "system", subject: "Account created (import)", related_type: "account", related_id: a.id!, account_id: a.id! }),
  );
}

function activity(
  c: Ctx,
  a: Pick<NewRow<"activities">, "type" | "subject" | "related_type" | "related_id" | "account_id"> & {
    body?: string | null;
    occurred_at?: string;
  },
): NewRow<"activities"> {
  return {
    org_id: c.user.org_id,
    type: a.type,
    subject: a.subject,
    body: a.body ?? null,
    occurred_at: a.occurred_at ?? c.now.toISOString(),
    related_type: a.related_type,
    related_id: a.related_id,
    account_id: a.account_id,
    actor_id: null,
    mentions: [],
    reactions: {},
    created_by: actorId(c),
  };
}

/**
 * Matches rows to accounts the importer can see: exact normalized name first, then the
 * account domain / website column, then the contact's email domain (webmail ignored).
 * Optionally plans new accounts (one per distinct name) owned by the importer.
 */
class AccountResolver {
  private byName = new Map<string, Account>();
  private byDomain = new Map<string, Account>();
  private toCreate = new Map<string, NewRow<"accounts">>();
  private missing = new Map<string, string>();

  constructor(
    private c: Ctx,
    accounts: Account[],
    private create: boolean,
  ) {
    for (const a of accounts) {
      const n = normalizeName(a.name);
      if (n && !this.byName.has(n)) this.byName.set(n, a);
      const d = domainOf(a.website);
      if (d && !this.byDomain.has(d)) this.byDomain.set(d, a);
    }
  }

  resolve(p: PreviewRow, name: string, domain: string, email?: string | null): string | null {
    const n = normalizeName(name);
    const hit =
      (n && this.byName.get(n)) ||
      ((d) => (d ? this.byDomain.get(d) : undefined))(domainOf(domain)) ||
      ((d) => (d ? this.byDomain.get(d) : undefined))(companyDomainOfEmail(email));
    if (hit) {
      p.account = hit.name;
      p.account_action = "match";
      return hit.id;
    }
    if (!n) {
      p.reasons.push(domain || email ? "No account matches this domain, and there's no account name to create one" : "No account given");
      return null;
    }
    const planned = this.toCreate.get(n);
    if (planned) {
      p.account = planned.name;
      p.account_action = "create";
      return planned.id!;
    }
    if (!this.create) {
      if (!this.missing.has(n)) this.missing.set(n, name.trim());
      p.reasons.push(`No account matches "${name.trim()}"`);
      return null;
    }
    const d = domainOf(domain) ?? companyDomainOfEmail(email);
    const a = newAccountRow(this.c, name.trim().slice(0, 160), d ? `https://${d}` : null);
    this.toCreate.set(n, a);
    p.account = a.name;
    p.account_action = "create";
    return a.id!;
  }

  planned() {
    return [...this.toCreate.values()];
  }
  unmatched() {
    return [...this.missing.values()];
  }
}

// ---------------- Accounts ----------------

async function planAccounts({ c, table, get }: PlanCtx): Promise<PlanBody> {
  const existing = new Set((await visibleAccounts(c)).map((a) => normalizeName(a.name)));
  const inFile = new Map<string, number>();
  const accounts: NewRow<"accounts">[] = [];
  const rows = table.rows.map((r, i) => {
    const n = i + 2;
    const name = get(r, "name");
    const p = row(n, name || "(no name)");
    const type = matchEnum(get(r, "type"), ACCOUNT_TYPES);
    const status = matchEnum(get(r, "status"), ACCOUNT_STATUSES);
    if (type === undefined) p.notes.push("No type: imported as Private");
    if (type === null) p.reasons.push(`type: "${get(r, "type")}" isn't an account type`);
    if (status === null) p.reasons.push(`status: "${get(r, "status")}" isn't an account status`);
    const site = get(r, "website");
    const parsed = AccountInput.safeParse({
      name,
      type: type ?? "private",
      sector: get(r, "sector") || "Unclassified",
      country: get(r, "country") || "US",
      state_region: get(r, "state_region"),
      city: get(r, "city"),
      website: site && !/^[a-z][a-z0-9+.-]*:\/\//i.test(site) && domainOf(site) ? `https://${site}` : site,
      tier: (get(r, "tier") || "C").toUpperCase(),
      status: status ?? "prospect",
    });
    if (!parsed.success) for (const x of parsed.error.issues) p.reasons.push(`${x.path.join(".")}: ${x.message}`);
    const key = normalizeName(name);
    const dup = existing.has(key)
      ? "An account with this name already exists"
      : inFile.has(key)
        ? `Same account as row ${inFile.get(key)}`
        : undefined;
    finish(p, dup);
    if (p.status === "create" && parsed.success) {
      inFile.set(key, n);
      const v = parsed.data;
      const a = newAccountRow(c, v.name, v.website ?? null);
      accounts.push({
        ...a,
        type: v.type,
        sector: v.sector,
        country: v.country,
        state_region: v.state_region ?? null,
        city: v.city ?? null,
        tier: v.tier,
        status: v.status,
      });
    }
    return p;
  });
  return { rows, warnings: [], accounts };
}

// ---------------- Contacts (KCRM-75) ----------------

const Email = z.string().email();

function splitName(full: string): [string, string] {
  const v = full.trim().replace(/\s+/g, " ");
  if (v.includes(",")) {
    const [last, first] = v.split(",", 2).map((x) => x.trim());
    return [first ?? "", last ?? ""];
  }
  const parts = v.split(" ");
  if (parts.length < 2) return [v, ""];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}

async function planContacts({ c, table, get, mapping, accounts }: PlanCtx): Promise<PlanBody> {
  if (!mapping.email && !(mapping.first_name && mapping.last_name) && !mapping.full_name)
    throw new ValidationError("Map either First name + Last name, or Full name.");
  if (!mapping.account_name && !mapping.account_domain && !mapping.email)
    throw new ValidationError("Map an account name, an account domain or an email column so contacts can be linked to accounts.");
  const existingEmails = new Set(
    (await c.store.list("contacts")).map((x) => x.email?.trim().toLowerCase()).filter((e): e is string => !!e),
  );
  const inFile = new Map<string, number>();
  const contacts: NewRow<"contacts">[] = [];
  const activities: NewRow<"activities">[] = [];
  const rows = table.rows.map((r, i) => {
    const n = i + 2;
    let first = get(r, "first_name");
    let last = get(r, "last_name");
    if ((!first || !last) && get(r, "full_name")) {
      const [f, l] = splitName(get(r, "full_name"));
      first ||= f;
      last ||= l;
    }
    const email = get(r, "email").toLowerCase();
    const p = row(n, [first, last].filter(Boolean).join(" ") || email || "(no name)");
    if (!first) p.reasons.push("First name is required");
    if (!last) p.reasons.push("Last name is required");
    if (first.length > 80 || last.length > 80) p.reasons.push("Names are limited to 80 characters");
    if (email && !Email.safeParse(email).success) p.reasons.push(`"${email}" isn't a valid email`);
    const role = matchBuyingRole(get(r, "role_in_buying"));
    if (role === null) p.notes.push(`Buying role "${get(r, "role_in_buying")}" not recognised; left blank`);
    const accountId = accounts.resolve(p, get(r, "account_name"), get(r, "account_domain"), email);
    const dup =
      email && existingEmails.has(email)
        ? `A contact with ${email} already exists`
        : email && inFile.has(email)
          ? `Same email as row ${inFile.get(email)}`
          : undefined;
    finish(p, dup);
    if (p.status === "create" && accountId) {
      if (email) inFile.set(email, n);
      const id = uuid();
      contacts.push({
        id,
        org_id: c.user.org_id,
        account_id: accountId,
        first_name: first,
        last_name: last,
        title: get(r, "title").slice(0, 200) || null,
        email: email || null,
        phone: get(r, "phone").slice(0, 60) || null,
        role_in_buying: role ?? null,
        owner_id: c.user.id,
        created_by: actorId(c),
      });
      activities.push(
        activity(c, {
          type: "system",
          subject: `Contact added: ${first} ${last} (import)`,
          related_type: "account",
          related_id: accountId,
          account_id: accountId,
        }),
      );
    }
    return p;
  });
  return { rows, warnings: [], contacts, activities };
}

// ---------------- Pipeline (KCRM-76) ----------------

const DEFAULT_LINES: Record<OppKind, ServiceLine> = {
  public_bid: "implementation",
  private_deal: "implementation",
  reseller_quote: "reselling",
  staffing_placement: "staffing",
};

async function planOpportunities({ c, req, table, get, accounts }: PlanCtx): Promise<PlanBody> {
  const settings = await orgSettings(c);
  const label = (s: Stage) => settings.stages.find((x) => x.key === s)?.label ?? s;
  const users = await usersById(c);
  const byEmail = new Map([...users.values()].filter(hasRole).map((u) => [u.email.toLowerCase(), u]));
  const leader = isLeader(c.user);

  // Fallback owner for unknown / blank owners: the importer unless a leader picks someone else.
  type Person = { id: string; full_name: string };
  let fallback: Person = users.get(c.user.id) ?? c.user;
  const pick = req.options?.fallback_owner_id;
  if (pick && pick !== c.user.id) {
    if (!leader) throw new ForbiddenError("Only executives can assign imported deals to someone else.");
    const u = users.get(pick);
    if (!u) throw new ValidationError("Pick an active teammate as the fallback owner.");
    fallback = u;
  }

  const stageMap = req.options?.stage_map ?? {};
  const stageValues = new Map<string, StageValue>();
  const mapStage = (raw: string): Stage | null => {
    const key = stageMapKey(raw);
    let sv = stageValues.get(key);
    if (!sv) {
      const suggested = suggestStage(raw, settings.stages) ?? null;
      sv = { raw: raw.trim(), key, count: 0, suggested, mapped: stageMap[key] ?? suggested };
      stageValues.set(key, sv);
    }
    sv.count++;
    return sv.mapped;
  };

  const existing = new Set((await visibleOpportunities(c)).map((o) => `${o.account_id}|${normalizeName(o.name)}`));
  const inFile = new Map<string, number>();
  const unknownOwners = new Set<string>();
  const opportunities: NewRow<"opportunities">[] = [];
  const activities: NewRow<"activities">[] = [];
  const today = c.now.toISOString().slice(0, 10);

  const rows = table.rows.map((r, i) => {
    const n = i + 2;
    const name = get(r, "name");
    const p = row(n, name || "(no name)");
    if (name.length < 3) p.reasons.push("Name must be at least 3 characters");
    if (name.length > 200) p.reasons.push("Name is limited to 200 characters");

    // Stage
    const rawStage = get(r, "stage");
    let stage: Stage | null = "signal";
    if (!rawStage) p.notes.push("No stage: imported at Signal");
    else {
      stage = mapStage(rawStage);
      if (!stage) p.reasons.push(`Unknown stage "${rawStage}": map it in the stage table`);
    }

    // Value + currency
    const money = parseMoney(get(r, "value"));
    if (money === null) p.reasons.push(`Value "${get(r, "value")}" isn't a number`);
    else if (money && money.value < 0) p.reasons.push("Value can't be negative");
    else if (money && money.value > 1e12) p.reasons.push("Value is too large");
    const rawCurrency = get(r, "currency").toUpperCase();
    if (rawCurrency && !/^[A-Z]{3}$/.test(rawCurrency)) p.reasons.push(`Currency "${get(r, "currency")}" isn't an ISO code like USD`);
    const currency = rawCurrency || money?.currency || "USD";

    // Kind
    const kindRaw = matchKind(get(r, "kind"));
    if (kindRaw === null) p.reasons.push(`Kind "${get(r, "kind")}" isn't a deal kind (public bid, private deal, reseller quote, staffing)`);
    if (kindRaw === undefined) p.notes.push("No kind: imported as a private deal");
    const kind: OppKind = kindRaw ?? "private_deal";
    if (c.user.role === "recruiter" && kind !== "staffing_placement") p.reasons.push("Recruiters can only import staffing deals");

    // Owner
    const ownerEmail = get(r, "owner_email").toLowerCase();
    let owner: Person | undefined = ownerEmail ? byEmail.get(ownerEmail) : undefined;
    if (!owner) {
      if (ownerEmail) {
        unknownOwners.add(ownerEmail);
        p.notes.push(`Owner ${ownerEmail} not found: assigned to ${fallback.full_name}`);
      } else p.notes.push(`No owner: assigned to ${fallback.full_name}`);
      owner = fallback;
    }
    if (!leader && owner.id !== c.user.id) {
      p.notes.push(`Assigned to you: only executives can import deals for ${owner.full_name}`);
      owner = users.get(c.user.id) ?? c.user;
    }

    // Dates
    const close = parseDate(get(r, "expected_close"));
    const due = parseDate(get(r, "proposal_due"));
    if (close === null) p.reasons.push(`Expected close "${get(r, "expected_close")}" isn't a date`);
    if (due === null) p.reasons.push(`Proposal due "${get(r, "proposal_due")}" isn't a date`);

    // Source + service lines
    const source = matchSource(get(r, "source"));
    if (source === null) p.notes.push(`Source "${get(r, "source")}" not recognised: imported as Inbound`);
    const sl = matchServiceLines(get(r, "service_lines"));
    if (sl.unknown.length) p.notes.push(`Service line${sl.unknown.length === 1 ? "" : "s"} ignored: ${sl.unknown.join(", ")}`);
    if (!sl.lines.length) sl.lines.push(DEFAULT_LINES[kind]);

    // Stage history: dated timeline entries; no stage-gate validation for historical stages.
    const history = parseStageHistory(get(r, "stage_history"));
    for (const u of history.unreadable) p.notes.push(`Stage history entry "${u}" couldn't be read`);
    const steps: Array<{ date: string; stage: Stage }> = [];
    for (const e of history.entries) {
      const s = mapStage(e.label);
      if (!s) p.notes.push(`Stage history: unknown stage "${e.label}" skipped`);
      else if (e.date > today) p.notes.push(`Stage history: ${e.date} is in the future, skipped`);
      else steps.push({ date: e.date, stage: s });
    }

    const accountId = accounts.resolve(p, get(r, "account_name"), get(r, "account_domain"));
    const key = `${accountId}|${normalizeName(name)}`;
    const dup = existing.has(key)
      ? "Already in the pipeline for this account"
      : inFile.has(key)
        ? `Same deal as row ${inFile.get(key)}`
        : undefined;
    finish(p, dup);

    if (p.status === "create" && accountId && stage) {
      inFile.set(key, n);
      const reason = get(r, "lost_reason") || "Imported";
      const id = uuid();
      opportunities.push({
        id,
        org_id: c.user.org_id,
        name,
        account_id: accountId,
        owner_id: owner.id,
        kind,
        stage,
        value: money?.value ?? 0,
        currency,
        probability: settings.stages.find((s) => s.key === stage)?.probability ?? 0,
        pwin: null,
        expected_close: close ?? null,
        source: source ?? "inbound",
        service_lines: sl.lines,
        next_step: null,
        next_step_due: null,
        // Lost deals always carry a reason (stage gate kept for the final stage only).
        lost_reason: stage === "lost" ? reason : null,
        no_bid_reason: stage === "no_bid" ? reason : null,
        shared_with: [],
        parent_opportunity_id: null,
        solicitation_no: null,
        agency_buyer: null,
        procurement_vehicle: null,
        naics: null,
        set_aside: null,
        questions_due: null,
        proposal_due: due ?? null,
        submission_method: null,
        incumbent: null,
        created_by: actorId(c),
      });
      const base = { related_type: "opportunity" as const, related_id: id, account_id: accountId };
      if (steps.length) {
        steps.forEach((s, k) =>
          activities.push(
            activity(c, {
              ...base,
              type: "stage_change",
              subject:
                k === 0 ? `Stage: ${label(s.stage)} (imported history)` : `Stage moved ${label(steps[k - 1].stage)} → ${label(s.stage)}`,
              body: `Imported from ${req.file_name}`,
              occurred_at: `${s.date}T12:00:00.000Z`,
            }),
          ),
        );
      } else {
        activities.push(
          activity(c, {
            ...base,
            type: "system",
            subject: `Imported at stage ${label(stage)}`,
            body: stage === "lost" || stage === "no_bid" ? `Reason: ${reason}` : `Imported from ${req.file_name}`,
          }),
        );
      }
    }
    return p;
  });

  const warnings: string[] = [];
  if (unknownOwners.size)
    warnings.push(
      `${unknownOwners.size} owner email${unknownOwners.size === 1 ? "" : "s"} didn't match a teammate; those deals go to ${fallback.full_name}.`,
    );
  return {
    rows,
    warnings,
    opportunities,
    activities,
    unknownOwners: [...unknownOwners],
    stageValues: [...stageValues.values()],
    fallbackOwner: { id: fallback.id, name: fallback.full_name },
  };
}

// ---------------------------------------------------------------------------
// Dry run, commit, undo, list
// ---------------------------------------------------------------------------

/** Dry run: the per-row preview. Writes nothing. */
export async function previewImport(c: Ctx, input: ImportRequestT): Promise<ImportPreview> {
  return (await planImport(c, input)).preview;
}

/**
 * Writes the planned rows: one multi-row insert per table, then the import_batches row and a
 * single audit entry. If a later step fails, whatever already landed is archived again.
 */
export async function commitImport(c: Ctx, input: ImportRequestT): Promise<{ batch: ImportBatch; preview: ImportPreview }> {
  const plan = await planImport(c, input);
  const { preview } = plan;
  if (preview.totals.create === 0) throw new ValidationError("Nothing to import: every row is a duplicate or has an error.");

  const created: ImportCreatedIds = { accounts: [], contacts: [], opportunities: [] };
  let batch: ImportBatch;
  try {
    created.accounts = (await c.store.insertMany("accounts", plan.accounts)).map((r) => r.id);
    created.contacts = (await c.store.insertMany("contacts", plan.contacts)).map((r) => r.id);
    created.opportunities = (await c.store.insertMany("opportunities", plan.opportunities)).map((r) => r.id);
    await c.store.insertMany("activities", plan.activities);
    batch = await c.store.insert("import_batches", {
      org_id: c.user.org_id,
      user_id: c.user.id,
      entity: preview.entity,
      file_name: preview.file_name,
      status: "committed",
      total_rows: preview.totals.rows,
      created_count: created.accounts.length + created.contacts.length + created.opportunities.length,
      skipped_count: preview.totals.skip,
      error_count: preview.totals.error,
      created_ids: created,
      undone_at: null,
      undone_by: null,
      created_by: actorId(c),
    });
  } catch (e) {
    await archiveAll(c, created).catch(() => undefined);
    throw e;
  }
  await audit(c, "import.committed", "import_batches", batch.id, null, {
    entity: batch.entity,
    file_name: batch.file_name,
    total_rows: batch.total_rows,
    created: { accounts: created.accounts.length, contacts: created.contacts.length, opportunities: created.opportunities.length },
    skipped: batch.skipped_count,
    errors: batch.error_count,
  });

  const events = await subscribedEvents(c);
  if (events.has("account.created"))
    for (const a of plan.accounts) await emitEvent(c, "account.created", webhookData.account({ ...a, ...BASE(c) } as Account));
  if (events.has("opportunity.created"))
    for (const o of plan.opportunities)
      await emitEvent(c, "opportunity.created", webhookData.opportunity({ ...o, ...BASE(c) } as Opportunity));
  return { batch, preview };
}

const BASE = (c: Ctx) => ({ created_at: c.now.toISOString(), updated_at: c.now.toISOString(), archived_at: null });

/** Archives contacts and deals before their accounts. */
async function archiveAll(c: Ctx, ids: ImportCreatedIds) {
  const at = c.now.toISOString();
  for (const t of ["contacts", "opportunities", "accounts"] as const)
    for (const id of ids[t]) await c.store.update(t, id, { archived_at: at });
}

const edited = (r: { created_at: string; updated_at: string }) => Date.parse(r.updated_at) > Date.parse(r.created_at);

/**
 * Undo: archives exactly the records the batch created. Refused when any of them was edited
 * since, or when something outside the batch now hangs off them (a contact on an imported
 * account, a quote on an imported deal). Importer or a leader, within 7 days.
 */
export async function undoImport(c: Ctx, batchId: string) {
  const b = await c.store.get("import_batches", batchId);
  if (!b || b.org_id !== c.user.org_id || !(isLeader(c.user) || b.user_id === c.user.id)) throw new ForbiddenError("Import not found.");
  if (b.status === "undone") throw new ValidationError("This import was already undone.");
  if (!canUndoImport(c.user, b, c.now)) throw new ValidationError(`Imports can only be undone within ${IMPORT_UNDO_DAYS} days.`);

  const ids = b.created_ids;
  const sets = { accounts: new Set(ids.accounts), contacts: new Set(ids.contacts), opportunities: new Set(ids.opportunities) };
  const load = async <T extends "accounts" | "contacts" | "opportunities">(t: T) =>
    sets[t].size ? (await c.store.list(t, { includeArchived: true })).filter((r) => sets[t].has(r.id)) : [];
  const [accounts, contacts, opps] = await Promise.all([load("accounts"), load("contacts"), load("opportunities")]);

  const changed: string[] = [];
  for (const a of accounts) if (!a.archived_at && edited(a)) changed.push(`account ${a.name}`);
  for (const x of contacts) if (!x.archived_at && edited(x)) changed.push(`contact ${x.first_name} ${x.last_name}`);
  for (const o of opps) if (!o.archived_at && edited(o)) changed.push(`deal ${o.name}`);

  // Records added since that depend on what we'd archive.
  if (sets.accounts.size) {
    const [allContacts, allOpps] = await Promise.all([c.store.list("contacts"), c.store.list("opportunities")]);
    for (const x of allContacts)
      if (sets.accounts.has(x.account_id) && !sets.contacts.has(x.id)) changed.push(`contact ${x.first_name} ${x.last_name} added since`);
    for (const o of allOpps)
      if (sets.accounts.has(o.account_id) && !sets.opportunities.has(o.id)) changed.push(`deal ${o.name} added since`);
  }
  if (sets.opportunities.size) {
    const names = new Map(opps.map((o) => [o.id, o.name]));
    const deps = [
      ["quote", await c.store.list("quotes")],
      ["bid decision", await c.store.list("bid_decisions")],
      ["handoff", await c.store.list("handoffs")],
    ] as const;
    for (const [what, list] of deps)
      for (const d of list)
        if (sets.opportunities.has(d.opportunity_id)) changed.push(`${what} on ${names.get(d.opportunity_id) ?? "a deal"}`);
  }
  if (changed.length) {
    const sample = [...new Set(changed)].slice(0, 3).join(", ");
    throw new ValidationError(
      `Can't undo: ${changed.length} record${changed.length === 1 ? " was" : "s were"} changed since the import (${sample}${changed.length > 3 ? ", …" : ""}).`,
    );
  }

  const live: ImportCreatedIds = {
    accounts: accounts.filter((r) => !r.archived_at).map((r) => r.id),
    contacts: contacts.filter((r) => !r.archived_at).map((r) => r.id),
    opportunities: opps.filter((r) => !r.archived_at).map((r) => r.id),
  };
  await archiveAll(c, live);
  const row = await c.store.update("import_batches", b.id, { status: "undone", undone_at: c.now.toISOString(), undone_by: c.user.id });
  await audit(
    c,
    "import.undone",
    "import_batches",
    b.id,
    { status: "committed" },
    {
      status: "undone",
      archived: { accounts: live.accounts.length, contacts: live.contacts.length, opportunities: live.opportunities.length },
    },
  );
  return row;
}

export interface ImportBatchRow extends ImportBatch {
  user_name: string;
  can_undo: boolean;
}

/** Recent batches: your own; leaders see everyone's. */
export async function listImportBatches(c: Ctx, limit = 25): Promise<ImportBatchRow[]> {
  const [all, users] = await Promise.all([
    c.store.list("import_batches", { orderBy: { column: "created_at", ascending: false } }),
    c.store.list("users"),
  ]);
  const names = new Map(users.map((u) => [u.id, u.full_name]));
  return all
    .filter((b) => b.org_id === c.user.org_id && (isLeader(c.user) || b.user_id === c.user.id))
    .slice(0, limit)
    .map((b) => ({ ...b, user_name: names.get(b.user_id) ?? "Unknown", can_undo: canUndoImport(c.user, b, c.now) }));
}

/** One-shot account import with the suggested mapping (kept for callers of the old API). */
export async function importAccountsCsv(c: Ctx, csv: string, fileName = "accounts.csv") {
  let headers: string[];
  try {
    headers = parseCsvTable(csv).headers;
  } catch (e) {
    throw e instanceof CsvError ? new ValidationError(e.message) : e;
  }
  const req: ImportRequestT = { entity: "accounts", csv, file_name: fileName, mapping: suggestMapping("accounts", headers) };
  const preview = await previewImport(c, req);
  const errors = preview.rows.filter((r) => r.status !== "create").map((r) => ({ row: r.row, message: r.reasons.join("; ") }));
  if (preview.totals.create === 0) return { created: 0, errors, batch: null };
  const { batch } = await commitImport(c, req);
  return { created: batch.created_ids.accounts.length, errors, batch };
}
