/**
 * Website enquiries → Signal-stage opportunities.
 *
 * konnectortech.com POSTs each enquiry to /api/integrations/website-enquiry. A web form knows much less
 * than the CRM requires, so the classification fields get the defaults below (WEBSITE_LEAD_DEFAULTS).
 * They are placeholders for the owner to correct while qualifying the lead, and they match what CSV
 * imports use for unknowns (type Private, sector Unclassified, country US, tier C, prospect).
 */
import { z } from "zod";
import { normalizeCompanyName, normalizeEmail } from "@/lib/domain/dedupe";
import type { Account, Contact, Opportunity, User } from "@/lib/domain/types";
import { verifyBody } from "@/lib/integration/signing";
import { audit } from "./audit";
import { createOpportunity } from "./capture";
import type { Ctx } from "./context-types";
import { createAccount, logActivity, notify } from "./core";

export const WEBSITE_ENQUIRY_EVENT = "website.enquiry";
/** The form allows 4,000 characters of message; anything much larger than a real enquiry is refused unread. */
export const MAX_ENQUIRY_BYTES = 32_768;

export const WEBSITE_SECTORS = ["Public sector", "Private sector", "Not sure yet"] as const;
type WebsiteSector = (typeof WEBSITE_SECTORS)[number];

/**
 * Defaults for the fields a web enquiry can't supply. Change them here, in one place.
 *
 * | Field                     | Default                                  | Why                                                        |
 * | ------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
 * | account.type              | Public sector → government_local;        | The form doesn't ask which level of government; local is    |
 * |                           | otherwise → private                      | the most common buyer. "Not sure yet" is treated as private |
 * | account.sector            | "Unclassified"                           | Industry is unknown (same as CSV imports)                   |
 * | account.country           | "US"                                     | Konnector's home market                                     |
 * | account.tier / status     | "C" / "prospect"                         | Unqualified until someone has spoken to them                |
 * | opportunity.kind          | Public sector → public_bid;              | Mirrors the account type                                    |
 * |                           | otherwise → private_deal                 |                                                             |
 * | opportunity.value         | 0 USD                                    | Unknown; shows up under "missing value" in Data quality     |
 * | opportunity.service_lines | ["advisory"]                             | One is required; a first conversation is advisory by nature |
 * | opportunity.next_step     | "Reply to website enquiry", due the next | The website promises a reply within one business day        |
 * |                           | business day after receipt               |                                                             |
 * | contact.last_name         | "(not given)" for one-word names         | The form has a single name field                            |
 */
export const WEBSITE_LEAD_DEFAULTS = {
  accountType: { "Public sector": "government_local", "Private sector": "private", "Not sure yet": "private" },
  accountSector: "Unclassified",
  country: "US",
  tier: "C",
  status: "prospect",
  oppKind: { "Public sector": "public_bid", "Private sector": "private_deal", "Not sure yet": "private_deal" },
  value: 0,
  currency: "USD",
  serviceLines: ["advisory"],
  nextStep: "Reply to website enquiry",
  missingLastName: "(not given)",
} as const satisfies {
  accountType: Record<WebsiteSector, Account["type"]>;
  oppKind: Record<WebsiteSector, Opportunity["kind"]>;
  [k: string]: unknown;
};

/** Mirrors `validate()` in the website's contact route. Unknown keys are ignored so the site can add fields safely. */
export const WebsiteEnquiry = z.object({
  event: z.literal(WEBSITE_ENQUIRY_EVENT),
  stage: z.literal("signal"),
  source: z.literal("inbound"),
  lead: z.object({
    name: z.string().trim().min(1, "name is required").max(120),
    email: z.string().trim().email("email is not valid").max(254),
    organization: z.string().trim().min(2, "organization is required").max(160),
    sector: z.enum(WEBSITE_SECTORS),
    message: z.string().trim().min(1, "message is required").max(4000),
    deadline: z.string().trim().max(120).optional().default(""),
    receivedAt: z.string().datetime({ offset: true, message: "receivedAt must be an ISO date-time" }),
    page: z.string().trim().max(200).optional().default(""),
  }),
});
export type WebsiteEnquiryT = z.infer<typeof WebsiteEnquiry>;
type Lead = WebsiteEnquiryT["lead"];

export interface WebsiteLeadResult extends Record<string, unknown> {
  account_id: string;
  contact_id: string;
  opportunity_id: string;
  account_created: boolean;
  contact_created: boolean;
}

/** One enquiry = one visitor at one instant. */
export const enquiryKey = (lead: Pick<Lead, "receivedAt" | "email">) =>
  `${WEBSITE_ENQUIRY_EVENT}:${new Date(lead.receivedAt).toISOString()}:${lead.email.toLowerCase()}`;

/** "Ada Lovelace-King Jr" → Ada / Lovelace-King Jr; "Cher" → Cher / (not given). */
export function splitName(name: string): { first_name: string; last_name: string } {
  const [first, ...rest] = name.trim().split(/\s+/);
  return { first_name: first.slice(0, 80), last_name: (rest.join(" ") || WEBSITE_LEAD_DEFAULTS.missingLastName).slice(0, 80) };
}

/** The next weekday after the given instant (UTC calendar), as yyyy-mm-dd. */
export function nextBusinessDay(iso: string): string {
  const d = new Date(iso);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

const canOwn = (u: User | null | undefined): u is User =>
  !!u && !u.archived_at && (u.role === "admin" || u.role === "executive" || u.role === "bd");

/**
 * Who owns a new website lead: LEAD_DEFAULT_OWNER_EMAIL if it names an active admin, executive or bd;
 * otherwise the longest-standing admin, then executive. (The integration actor itself can't own records.)
 */
export async function defaultLeadOwner(c: Ctx, ownerEmail = ""): Promise<User> {
  const users = (await c.store.list("users"))
    .filter(canOwn)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const wanted = ownerEmail.trim().toLowerCase();
  const owner =
    (wanted && users.find((u) => u.email.toLowerCase() === wanted)) ||
    users.find((u) => u.role === "admin") ||
    users.find((u) => u.role === "executive");
  if (!owner) throw new Error("No active admin or executive to own website leads.");
  return owner;
}

/**
 * Finds or creates the account (by normalised organization name) and the contact (by email at that
 * account), then always creates a new Signal-stage opportunity with the enquiry text on its timeline.
 * Run with the system context; callers are responsible for idempotency (see receiveWebsiteEnquiry).
 */
export async function createLeadFromEnquiry(c: Ctx, lead: Lead, opts: { defaultOwnerEmail?: string } = {}): Promise<WebsiteLeadResult> {
  const fallback = await defaultLeadOwner(c, opts.defaultOwnerEmail);

  // Account: an existing one keeps its classification and owner; a repeat enquirer is not a new company.
  const wantedName = normalizeCompanyName(lead.organization);
  const existing = (await c.store.list("accounts", { orderBy: { column: "created_at" } })).find(
    (a) => !a.archived_at && normalizeCompanyName(a.name) === wantedName,
  );
  const account =
    existing ??
    (await createAccount(c, {
      name: lead.organization,
      type: WEBSITE_LEAD_DEFAULTS.accountType[lead.sector],
      sector: WEBSITE_LEAD_DEFAULTS.accountSector,
      country: WEBSITE_LEAD_DEFAULTS.country,
      tier: WEBSITE_LEAD_DEFAULTS.tier,
      status: WEBSITE_LEAD_DEFAULTS.status,
      owner_id: fallback.id,
      description: `Created from a konnectortech.com enquiry (${lead.sector}). Classification fields are defaults — please review.`,
    }));
  const accountOwner = await c.store.get("users", account.owner_id);
  const owner = canOwn(accountOwner) ? accountOwner : fallback;

  // Contact: createContact() would make the integration actor the owner, so insert with a real owner here.
  const email = normalizeEmail(lead.email);
  const known = (await c.store.list("contacts", { where: { account_id: account.id } })).find(
    (x) => !x.archived_at && normalizeEmail(x.email) === email,
  );
  let contact: Contact;
  if (known) contact = known;
  else {
    contact = await c.store.insert("contacts", {
      org_id: c.user.org_id,
      account_id: account.id,
      ...splitName(lead.name),
      title: null,
      email: lead.email,
      phone: null,
      role_in_buying: null,
      owner_id: owner.id,
      created_by: null,
    });
    await logActivity(c, {
      type: "system",
      subject: `Contact added from website enquiry: ${contact.first_name} ${contact.last_name}`,
      related_type: "account",
      related_id: account.id,
      account_id: account.id,
    });
  }

  // Opportunity: createOpportunity always starts at Signal and writes the audit entry, timeline entry and webhook.
  const opportunity = await createOpportunity(c, {
    name: `Website enquiry: ${lead.organization}`,
    account_id: account.id,
    kind: WEBSITE_LEAD_DEFAULTS.oppKind[lead.sector],
    value: WEBSITE_LEAD_DEFAULTS.value,
    currency: WEBSITE_LEAD_DEFAULTS.currency,
    source: "inbound",
    service_lines: [...WEBSITE_LEAD_DEFAULTS.serviceLines],
    next_step: WEBSITE_LEAD_DEFAULTS.nextStep,
    next_step_due: nextBusinessDay(lead.receivedAt),
    owner_id: owner.id,
  });

  // The visitor's words. Inserted directly (not via logActivity) so "@Name" typed into a public form can't ping staff.
  await c.store.insert("activities", {
    org_id: c.user.org_id,
    type: "note",
    subject: `Website enquiry from ${lead.name}`,
    body: [
      lead.message,
      "",
      `From: ${lead.name} <${lead.email}>`,
      `Organization: ${lead.organization} (${lead.sector})`,
      `Needs to land: ${lead.deadline || "not given"}`,
      `Page: ${lead.page || "not given"}`,
    ].join("\n"),
    occurred_at: new Date(lead.receivedAt).toISOString(),
    related_type: "opportunity",
    related_id: opportunity.id,
    account_id: account.id,
    actor_id: null,
    mentions: [],
    reactions: {},
    created_by: null,
  });

  const result: WebsiteLeadResult = {
    account_id: account.id,
    contact_id: contact.id,
    opportunity_id: opportunity.id,
    account_created: !existing,
    contact_created: !known,
  };
  await audit(c, "website_enquiry.received", "opportunities", opportunity.id, null, {
    ...result,
    owner_id: owner.id,
    received_at: lead.receivedAt,
  });
  await notify(
    c,
    owner.id,
    "alert",
    `New website enquiry: ${lead.organization}`,
    `/opportunities/${opportunity.id}`,
    `${lead.name} · ${lead.sector}`,
  );
  return result;
}

/**
 * Verifies, validates, de-duplicates, logs and processes one website enquiry.
 * Returns an HTTP-ish result for the route handler (same shape as integration/inbound.ts).
 */
export async function receiveWebsiteEnquiry(
  c: Ctx,
  body: string,
  signature: string | null,
  opts: { secret: string; defaultOwnerEmail?: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!opts.secret) return { status: 503, body: { error: "website enquiries are not configured" } };
  if (Buffer.byteLength(body) > MAX_ENQUIRY_BYTES) return { status: 413, body: { error: "payload too large" } };
  const v = verifyBody(body, signature, opts.secret);
  if (!v.ok) return { status: 401, body: { error: v.reason } };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: "invalid JSON" } };
  }
  const parsed = WebsiteEnquiry.safeParse(json);
  if (!parsed.success) {
    return {
      status: 422,
      body: { error: "invalid enquiry", details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    };
  }
  const { lead } = parsed.data;
  const key = enquiryKey(lead);
  const [dup] = await c.store.list("integration_events", { where: { direction: "inbound", idempotency_key: key } });
  if (dup?.status === "processed") return { status: 200, body: { ok: true, idempotent_replay: true, ...(dup.response ?? {}) } };
  // A row that isn't `processed` is an earlier attempt that failed part-way: run again (find-or-create makes that safe).
  const row =
    dup ??
    (await c.store.insert("integration_events", {
      direction: "inbound",
      event: WEBSITE_ENQUIRY_EVENT,
      idempotency_key: key,
      status: "pending",
      attempts: 0,
      last_error: null,
      payload: parsed.data as unknown as Record<string, unknown>,
      response: null,
    }));
  try {
    const out = await createLeadFromEnquiry(c, lead, { defaultOwnerEmail: opts.defaultOwnerEmail });
    await c.store.update("integration_events", row.id, {
      status: "processed",
      attempts: row.attempts + 1,
      response: out,
      last_error: null,
    });
    return { status: 200, body: { ok: true, ...out } };
  } catch (err) {
    await c.store.update("integration_events", row.id, {
      status: "failed",
      attempts: row.attempts + 1,
      last_error: (err as Error).message,
    });
    return { status: 500, body: { error: "could not record the enquiry" } };
  }
}
