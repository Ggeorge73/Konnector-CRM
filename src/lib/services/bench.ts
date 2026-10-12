/**
 * Talent bench: consultants (skills, rates, availability) and "who can staff this?"
 * matching for opportunities. Cost rates are redacted unless canSeeConsultantCost;
 * bd cannot read the bench at all (mirrors RLS on consultants / consultants_public).
 * Allocation to live projects is read from Konnect Hub, never stored here.
 */
import { z } from "zod";
import { ForbiddenError } from "@/lib/auth/errors";
import { canEditBench, canSeeBench, canSeeConsultantCost } from "@/lib/auth/permissions";
import type { Consultant, Opportunity, ServiceLine } from "@/lib/domain/types";
import { dateLabel } from "@/lib/format";
import { audit, diff } from "./audit";
import { getOpportunity } from "./capture";
import type { Ctx } from "./context-types";
import { logActivity } from "./core";
import { actorId } from "./system";

export const CONSULTANT_STATUSES = ["available", "partial", "allocated", "inactive"] as const;

/** A consultant as the viewer may see it: rate_cost is null and margin_pct null unless cost is visible. */
export type ConsultantView = Consultant & { margin_pct: number | null };

function assertBench(c: Ctx) {
  if (!canSeeBench(c.user)) throw new ForbiddenError("The bench is restricted to delivery, recruiting and leadership.");
}

export function redactConsultant(c: Ctx, row: Consultant): ConsultantView {
  if (!canSeeConsultantCost(c.user)) return { ...row, rate_cost: null, margin_pct: null };
  const cost = row.rate_cost ?? null;
  const margin = cost !== null && row.rate_bill > 0 ? Math.round(((row.rate_bill - cost) / row.rate_bill) * 1000) / 10 : null;
  return { ...row, rate_cost: cost, margin_pct: margin };
}

export async function visibleConsultants(c: Ctx): Promise<ConsultantView[]> {
  assertBench(c);
  const rows = await c.store.list("consultants", { orderBy: { column: "full_name" } });
  return rows.map((r) => redactConsultant(c, r));
}

export async function getConsultant(c: Ctx, id: string): Promise<ConsultantView> {
  assertBench(c);
  const row = await c.store.get("consultants", id);
  if (!row || row.archived_at) throw new ForbiddenError("Consultant not found.");
  return redactConsultant(c, row);
}

// ---------------- Create / edit ----------------

const tagList = z
  .array(z.string().trim().min(1).max(60))
  .max(30, "Up to 30 entries")
  .transform((xs) => {
    const seen = new Set<string>();
    return xs.filter((x) => !seen.has(x.toLowerCase()) && !!seen.add(x.toLowerCase()));
  });

const nullableStr = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const ConsultantInput = z.object({
  full_name: z.string().trim().min(2, "Name is required").max(120),
  title: z.string().trim().min(2, "Title is required").max(120),
  email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .or(z.literal(""))
    .transform((v) => v || null)
    .nullable()
    .optional(),
  skills: tagList.refine((xs) => xs.length > 0, "Add at least one skill"),
  certifications: tagList.default([]),
  rate_cost: z.number().min(0, "Cost rate can't be negative").max(10_000).nullable().optional(),
  rate_bill: z.number({ error: "Bill rate is required" }).positive("Bill rate is required").max(10_000),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .default("USD"),
  availability_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date")
    .nullable()
    .optional(),
  location: z.string().trim().min(2, "Location is required").max(120),
  clearance: nullableStr,
  status: z.enum(CONSULTANT_STATUSES).default("available"),
});
export type ConsultantInputT = z.input<typeof ConsultantInput>;

const MONEY_KEYS = ["rate_cost", "rate_bill", "currency"] as const;

export async function saveConsultant(c: Ctx, input: ConsultantInputT, id?: string): Promise<ConsultantView> {
  if (!canEditBench(c.user)) throw new ForbiddenError("Only recruiters and executives can edit the bench.");
  const v = ConsultantInput.parse(input);
  if (!id) {
    const row = await c.store.insert("consultants", {
      org_id: c.user.org_id,
      full_name: v.full_name,
      title: v.title,
      email: v.email ?? null,
      skills: v.skills,
      certifications: v.certifications,
      rate_cost: v.rate_cost ?? null,
      rate_bill: v.rate_bill,
      currency: v.currency,
      availability_from: v.availability_from ?? null,
      location: v.location,
      clearance: v.clearance ?? null,
      resume_file_id: null,
      status: v.status,
      created_by: actorId(c),
    });
    await audit(c, "consultant.created", "consultants", row.id, null, {
      full_name: row.full_name,
      rate_cost: row.rate_cost,
      rate_bill: row.rate_bill,
      currency: row.currency,
    });
    await logActivity(c, { type: "system", subject: "Added to the bench", related_type: "consultant", related_id: row.id });
    return redactConsultant(c, row);
  }
  const before = await c.store.get("consultants", id);
  if (!before || before.archived_at) throw new ForbiddenError("Consultant not found.");
  const patch: Partial<Consultant> = {
    full_name: v.full_name,
    title: v.title,
    email: v.email ?? null,
    skills: v.skills,
    certifications: v.certifications,
    rate_cost: v.rate_cost === undefined ? before.rate_cost : v.rate_cost,
    rate_bill: v.rate_bill,
    currency: v.currency,
    availability_from: v.availability_from ?? null,
    location: v.location,
    clearance: v.clearance ?? null,
    status: v.status,
  };
  const d = diff(before, patch);
  if (!d.changed) return redactConsultant(c, before);
  const row = await c.store.update("consultants", id, patch);
  const moneyBefore: Record<string, unknown> = {};
  const moneyAfter: Record<string, unknown> = {};
  for (const k of MONEY_KEYS)
    if (k in d.after) {
      moneyBefore[k] = d.before[k];
      moneyAfter[k] = d.after[k];
    }
  if (Object.keys(moneyAfter).length) {
    await audit(c, "consultant.rate_changed", "consultants", id, moneyBefore, moneyAfter);
    // Timeline is visible to delivery leads: never put cost numbers in it.
    await logActivity(c, { type: "system", subject: "Rates updated", related_type: "consultant", related_id: id });
  }
  if ("status" in d.after || "availability_from" in d.after) {
    await logActivity(c, {
      type: "system",
      subject: `Availability updated: ${row.status}${row.availability_from ? ` from ${row.availability_from}` : ""}`,
      related_type: "consultant",
      related_id: id,
    });
  }
  return redactConsultant(c, row);
}

// ---------------- Staffing matches ----------------

/** Service line → skill keywords that suggest a consultant can staff it. Staffing = any skill set. */
export const SERVICE_LINE_SKILLS: Record<ServiceLine, string[]> = {
  systems_integration: ["integration", "mulesoft", "apis", "boomi", "hl7 fhir", "java"],
  implementation: ["project management", "pmp", "agile", "servicenow", "business analyst", "requirements", "process mapping"],
  staffing: [],
  advisory: ["architecture", "change", "prosci", "togaf"],
  reselling: ["cloud", "network", "terraform", "kubernetes", "zero trust"],
};

export interface StaffingMatch {
  consultant: ConsultantView;
  /** 0–100 */
  score: number;
  /** The consultant's own skills that matched what the deal needs. */
  matched_skills: string[];
  reasons: string[];
  /** YYYY-MM-DD: the later of today and availability_from. */
  available_on: string;
  available_in_time: boolean;
}

export interface StaffingResult {
  opportunityId: string;
  wantedSkills: string[];
  /** Date the team is needed by (proposal due, expected close, explicit, or +30 days). */
  needBy: string;
  matches: StaffingMatch[];
}

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

export function wantedSkillsFor(o: Pick<Opportunity, "service_lines">, extra: string[] = []): string[] {
  const out = new Set<string>();
  for (const sl of o.service_lines) for (const k of SERVICE_LINE_SKILLS[sl] ?? []) out.add(k);
  for (const s of extra) if (s.trim()) out.add(s.trim().toLowerCase());
  return [...out];
}

const hit = (hay: string, kw: string) => {
  const h = hay.toLowerCase();
  const word = (needle: string, text: string) =>
    new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(text);
  return word(kw, h) || (h.length >= 3 && word(h, kw));
};

const STATUS_POINTS: Record<Consultant["status"], number> = { available: 10, partial: 6, allocated: 2, inactive: 0 };

/** Pure scoring, exported for tests. */
export function scoreConsultant(cons: ConsultantView, wanted: string[], needBy: string, today: string): StaffingMatch {
  const reasons: string[] = [];
  const hay = [...cons.skills, cons.title];
  const matched = wanted.filter((kw) => hay.some((h) => hit(h, kw)));
  const shown = cons.skills.filter((s) => matched.some((kw) => hit(s, kw)));
  let skill: number;
  if (wanted.length === 0) {
    skill = 27;
    reasons.push("Staffing deal: any skill set fits");
  } else {
    skill = Math.round(Math.min(1, matched.length / Math.min(4, wanted.length)) * 55);
    if (matched.length) {
      reasons.push(`Skills match: ${(shown.length ? shown : matched).slice(0, 4).join(", ")}`);
    } else reasons.push("No direct skill overlap");
  }

  const from = cons.availability_from && cons.availability_from > today ? cons.availability_from : today;
  const late = daysBetween(needBy, from);
  const inTime = late <= 0;
  const avail = inTime ? 25 : Math.max(0, 25 - late);
  if (from === today) reasons.push("Available now");
  else if (inTime) reasons.push(`Free ${dateLabel(from)}, before the ${dateLabel(needBy)} need date`);
  else reasons.push(`Free ${dateLabel(from)}, ${late}d after the ${dateLabel(needBy)} need date`);

  const status = STATUS_POINTS[cons.status];
  if (cons.status === "available") reasons.push("On the bench (unallocated)");
  else if (cons.status === "partial") reasons.push("Partially allocated");
  else if (cons.status === "allocated") reasons.push("Fully allocated on a live project");

  const relevantCert = cons.certifications.find((cert) => wanted.some((kw) => hit(cert, kw)));
  const cert = relevantCert ? 10 : cons.certifications.length ? 4 : 0;
  if (relevantCert) reasons.push(`Certified: ${relevantCert}`);
  else if (cons.certifications.length) reasons.push(`Certifications: ${cons.certifications.join(", ")}`);

  return {
    consultant: cons,
    score: Math.min(100, skill + avail + status + cert),
    matched_skills: shown,
    reasons,
    available_on: from,
    available_in_time: inTime,
  };
}

/** "Who can staff this?" — ranked consultants for an opportunity. Delivery leads, recruiters and leaders. */
export async function staffingMatches(
  c: Ctx,
  opportunityId: string,
  opts: { skills?: string[]; availableBy?: string } = {},
): Promise<StaffingResult> {
  assertBench(c);
  const o = await getOpportunity(c, opportunityId);
  const today = ymd(c.now);
  const fallback = ymd(new Date(c.now.getTime() + 30 * DAY));
  let needBy = opts.availableBy ?? o.proposal_due ?? o.expected_close ?? fallback;
  needBy = needBy.slice(0, 10);
  if (needBy < today) needBy = today;
  const wanted = wantedSkillsFor(o, opts.skills ?? []);
  const consultants = (await visibleConsultants(c)).filter((x) => x.status !== "inactive");
  const matches = consultants
    .map((x) => scoreConsultant(x, wanted, needBy, today))
    .sort(
      (a, b) =>
        b.score - a.score || a.available_on.localeCompare(b.available_on) || a.consultant.full_name.localeCompare(b.consultant.full_name),
    );
  return { opportunityId, wantedSkills: wanted, needBy, matches };
}
