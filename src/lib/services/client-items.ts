/**
 * Client commercial loop: the CRM publishes quotes, contract amendments, renewal offers and surveys
 * into the client's Konnect Hub portal; decisions come back and move the deal.
 * Only client-facing data ever leaves the CRM (enforced by the strict contract schema + leak guard).
 */
import { z } from "zod";
import { env } from "@/config/app";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { canEditOpportunity, isLeader } from "@/lib/auth/permissions";
import type { ClientItem, ClientItemType } from "@/lib/domain/types";
import { CONTRACT_VERSION, ClientItemPublishedPayload, ClientItemWithdrawnPayload } from "@/lib/integration/contract";
import { send } from "@/lib/integration/outbox";
import type { Transport } from "@/lib/integration/transport";
import { renderQuotePdf } from "@/lib/pdf/quote-pdf";
import { audit } from "./audit";
import { getOpportunity, getQuote } from "./capture";
import type { Ctx } from "./context-types";
import { createTask, getAccount, logActivity, notify, visibleAccounts } from "./core";
import { sendProjectExtended, signedFileUrl, startHandoff } from "./handoff";
import { orgSettings } from "./pulse";
import { actorId } from "./system";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const g = globalThis as unknown as { __kcrmBlobs?: Map<string, Uint8Array> };

export const TYPE_LABEL: Record<ClientItemType, string> = {
  quote: "Quote",
  contract_amendment: "Contract amendment",
  renewal_offer: "Renewal offer",
  survey: "Survey",
};

// ---------------- Reads ----------------

export async function visibleClientItems(c: Ctx): Promise<ClientItem[]> {
  const accounts = new Set((await visibleAccounts(c)).map((a) => a.id));
  return (await c.store.list("client_items", { orderBy: { column: "created_at", ascending: false } })).filter((i) =>
    accounts.has(i.account_id),
  );
}

export async function getClientItem(c: Ctx, id: string) {
  const item = await c.store.get("client_items", id);
  if (!item) throw new ForbiddenError("Item not found.");
  await getAccount(c, item.account_id);
  const versions = await c.store.list("client_items", {
    where: { lineage_id: item.lineage_id },
    orderBy: { column: "version", ascending: false },
  });
  return { item, versions };
}

function canManage(c: Ctx, item: Pick<ClientItem, "owner_id">) {
  return isLeader(c.user) || item.owner_id === c.user.id;
}

// ---------------- Create drafts ----------------

/** Draft a client item from an approved quote. Prices and terms only — never cost or margin. */
export async function draftFromQuote(c: Ctx, quoteId: string, input: { respond_by?: string | null; summary?: string | null }) {
  const q = await getQuote(c, quoteId);
  const o = await getOpportunity(c, q.opportunity_id);
  if (!canEditOpportunity(c.user, o)) throw new ForbiddenError();
  if (!["approved", "sent"].includes(q.status))
    throw new ValidationError("Only approved quotes can be published — margin guardrails come first.");
  const account = await getAccount(c, q.account_id);
  if (!account.konnect_hub_client_id)
    throw new ValidationError(
      "This account isn't a Konnect Hub client yet. Publish works once the client has a portal (after a first handoff).",
    );
  const lines = q.lines.map((l) => ({ item: l.item, description: l.description, qty: l.qty, unit_price: l.unit_price }));
  const prior = (await c.store.list("client_items", { where: { quote_id: q.id }, orderBy: { column: "version", ascending: false } }))[0];
  return c.store.insert("client_items", {
    org_id: c.user.org_id,
    type: "quote",
    account_id: account.id,
    opportunity_id: o.id,
    quote_id: q.id,
    konnect_hub_client_id: account.konnect_hub_client_id,
    konnect_hub_project_id: (await projectFor(c, o.id, account.id))?.konnect_hub_project_id ?? null,
    title: `${q.number} · ${q.title}`,
    summary: input.summary ?? null,
    amount: q.totals.price,
    currency: q.currency,
    lines,
    terms: q.terms,
    new_end_date: null,
    document_file_id: null,
    respond_by: input.respond_by ?? q.valid_until,
    version: prior ? prior.version + 1 : 1,
    lineage_id: prior?.lineage_id ?? crypto.randomUUID(),
    status: "draft",
    decided_by_name: null,
    decided_by_title: null,
    decided_by_email: null,
    decided_at: null,
    decision_ip: null,
    decision_note: null,
    survey_score: null,
    published_by: null,
    published_at: null,
    owner_id: c.user.id,
    created_by: actorId(c),
  });
}

async function projectFor(c: Ctx, opportunityId: string | null, accountId: string) {
  const health = await c.store.list("project_health", { where: { account_id: accountId } });
  return health.find((h) => h.opportunity_id === opportunityId) ?? health[0] ?? null;
}

export const ItemInput = z
  .object({
    type: z.enum(["contract_amendment", "renewal_offer", "survey"]),
    account_id: z.string().uuid(),
    konnect_hub_project_id: z.string().nullable().optional(),
    title: z.string().trim().min(3, "Title is required").max(200),
    summary: z.string().trim().max(4000).nullable().optional(),
    amount: z.coerce.number().min(0).nullable().optional(),
    lines: z
      .array(
        z.object({
          item: z.string().trim().min(1),
          description: z.string().nullable().optional(),
          qty: z.coerce.number().positive(),
          unit_price: z.coerce.number().min(0),
        }),
      )
      .default([]),
    terms: z.string().trim().max(4000).nullable().optional(),
    new_end_date: isoDate.nullable().optional(),
    respond_by: isoDate.nullable().optional(),
  })
  .refine((v) => v.type === "survey" || (v.amount ?? 0) > 0 || v.lines.length > 0, {
    message: "Add an amount or price lines",
    path: ["amount"],
  })
  .refine((v) => v.type !== "contract_amendment" || !!v.konnect_hub_project_id, {
    message: "Pick the project this amends",
    path: ["konnect_hub_project_id"],
  });
export type ItemInputT = z.input<typeof ItemInput>;

/**
 * Draft an amendment, renewal offer or survey. Amendments and renewals get their own
 * opportunity (child of the original deal) so acceptance can mark it Won.
 */
export async function draftItem(c: Ctx, input: ItemInputT) {
  const v = ItemInput.parse(input);
  const account = await getAccount(c, v.account_id);
  if (!(isLeader(c.user) || account.owner_id === c.user.id || c.user.role === "delivery_lead"))
    throw new ForbiddenError("Only the account owner or an executive can draft client items.");
  if (!account.konnect_hub_client_id) throw new ValidationError("This account isn't a Konnect Hub client yet.");
  const project = v.konnect_hub_project_id
    ? (await c.store.list("project_health", { where: { konnect_hub_project_id: v.konnect_hub_project_id } }))[0]
    : null;
  const amount = v.amount ?? v.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  let opportunityId: string | null = project?.opportunity_id ?? null;
  if (v.type !== "survey") {
    const parent = project?.opportunity_id ? await c.store.get("opportunities", project.opportunity_id) : null;
    const opp = await c.store.insert("opportunities", {
      org_id: c.user.org_id,
      name: `${v.type === "renewal_offer" ? "Renewal" : "Amendment"}: ${project?.project_name ?? v.title}`,
      account_id: account.id,
      owner_id: account.owner_id,
      kind: "private_deal",
      stage: "submitted",
      value: amount,
      currency: "USD",
      probability: 60,
      pwin: null,
      expected_close: v.respond_by ?? null,
      source: "referral",
      service_lines: parent?.service_lines ?? ["implementation"],
      next_step: "Client decision in Konnect Hub",
      next_step_due: v.respond_by ?? null,
      lost_reason: null,
      no_bid_reason: null,
      shared_with: [],
      parent_opportunity_id: parent?.id ?? null,
      solicitation_no: null,
      agency_buyer: null,
      procurement_vehicle: null,
      naics: null,
      set_aside: null,
      questions_due: null,
      proposal_due: null,
      submission_method: null,
      incumbent: null,
      created_by: actorId(c),
    });
    opportunityId = opp.id;
  }
  return c.store.insert("client_items", {
    org_id: c.user.org_id,
    type: v.type,
    account_id: account.id,
    opportunity_id: opportunityId,
    quote_id: null,
    konnect_hub_client_id: account.konnect_hub_client_id,
    konnect_hub_project_id: v.konnect_hub_project_id ?? null,
    title: v.title,
    summary: v.summary ?? null,
    amount: v.type === "survey" ? null : amount,
    currency: "USD",
    lines: v.lines.map((l) => ({ item: l.item, description: l.description ?? null, qty: l.qty, unit_price: l.unit_price })),
    terms: v.terms ?? null,
    new_end_date: v.new_end_date ?? null,
    document_file_id: null,
    respond_by: v.respond_by ?? null,
    version: 1,
    lineage_id: crypto.randomUUID(),
    status: "draft",
    decided_by_name: null,
    decided_by_title: null,
    decided_by_email: null,
    decided_at: null,
    decision_ip: null,
    decision_note: null,
    survey_score: null,
    published_by: null,
    published_at: null,
    owner_id: c.user.id,
    created_by: actorId(c),
  });
}

/** A changed item is republished as a new version; the old one becomes superseded on publish. */
export async function reviseItem(
  c: Ctx,
  id: string,
  patch: Partial<Pick<ClientItem, "title" | "summary" | "amount" | "lines" | "terms" | "respond_by" | "new_end_date">>,
) {
  const { item, versions } = await getClientItem(c, id);
  if (!canManage(c, item)) throw new ForbiddenError();
  if (item.status === "draft") return c.store.update("client_items", id, patch);
  if (["accepted", "declined", "withdrawn", "superseded"].includes(item.status))
    throw new ValidationError("This item is closed — draft a new one instead.");
  const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = item;
  void _id;
  void _ca;
  void _ua;
  return c.store.insert("client_items", {
    ...rest,
    ...patch,
    version: Math.max(...versions.map((v) => v.version)) + 1,
    status: "draft",
    published_at: null,
    published_by: null,
    document_file_id: null,
    decided_at: null,
    decided_by_email: null,
    decided_by_name: null,
    decided_by_title: null,
    decision_note: null,
    decision_ip: null,
    created_by: actorId(c),
  });
}

// ---------------- Publish / withdraw ----------------

/** Exactly what the client will see — also used for the in-CRM preview. */
export async function clientPayload(c: Ctx, item: ClientItem, previous: ClientItem | null) {
  const doc = item.document_file_id ? await c.store.get("files", item.document_file_id) : null;
  return ClientItemPublishedPayload.parse({
    version: CONTRACT_VERSION,
    event: "client_item.published",
    idempotency_key: `${item.id}:v${item.version}:publish`,
    item: {
      item_id: item.id,
      lineage_id: item.lineage_id,
      version: item.version,
      supersedes_version: previous?.version ?? null,
      type: item.type,
      konnect_hub_client_id: item.konnect_hub_client_id!,
      konnect_hub_project_id: item.konnect_hub_project_id,
      title: item.title,
      summary: item.summary,
      amount: item.amount,
      currency: item.currency,
      lines: item.lines.map((l) => ({ item: l.item, description: l.description, qty: l.qty, unit_price: l.unit_price })),
      terms: item.terms,
      new_end_date: item.new_end_date,
      respond_by: item.respond_by,
      document: doc ? { name: doc.name, url: signedFileUrl(doc.id, c.now) } : null,
      // Most government amendments need a signed contract, not a click-accept.
      requires_signature:
        item.type === "contract_amendment" && (await c.store.get("accounts", item.account_id))!.type.startsWith("government"),
    },
  });
}

async function attachPdf(c: Ctx, item: ClientItem): Promise<ClientItem> {
  if (item.type === "survey" || item.document_file_id) return item;
  const account = (await c.store.get("accounts", item.account_id))!;
  const bytes = await renderQuotePdf({
    number: item.title.split(" · ")[0],
    title: item.title,
    accountName: account.name,
    currency: item.currency,
    validUntil: item.respond_by,
    terms: item.terms,
    lines: item.lines,
    version: item.version,
  });
  const path = `${item.org_id}/client_item/${item.id}/v${item.version}.pdf`;
  if (env.dataBackend === "supabase") await (await import("./files")).storeGeneratedBytes(path, bytes, "application/pdf");
  else (g.__kcrmBlobs ??= new Map()).set(path, bytes);
  const file = await c.store.insert("files", {
    org_id: item.org_id,
    storage_path: path,
    name: `${item.title.replace(/[^\w .-]+/g, "")} v${item.version}.pdf`,
    size: bytes.length,
    mime: "application/pdf",
    related_type: "client_item",
    related_id: item.id,
    created_by: actorId(c),
  });
  return c.store.update("client_items", item.id, { document_file_id: file.id });
}

export async function publishItem(c: Ctx, id: string, transport?: Transport) {
  const { item: draft, versions } = await getClientItem(c, id);
  if (!canManage(c, draft)) throw new ForbiddenError("Only the item owner or an executive can publish.");
  if (draft.status !== "draft") throw new ValidationError("Only drafts can be published.");
  if (draft.quote_id) {
    const q = await c.store.get("quotes", draft.quote_id);
    if (!q || !["approved", "sent", "accepted"].includes(q.status))
      throw new ValidationError("The quote must pass margin guardrails / executive approval before publishing.");
  }
  const item = await attachPdf(c, draft);
  const previous =
    versions.find((v) => v.version < item.version && ["published", "viewed", "changes_requested"].includes(v.status)) ?? null;
  const payload = await clientPayload(c, item, previous);
  const event = await send(c, "client_item.published", payload, payload.idempotency_key, transport);
  if (event.status !== "delivered") {
    await c.store.update("client_items", id, { status: "draft" });
    throw new ValidationError(
      `Konnect Hub didn't accept the item yet: ${event.last_error ?? "pending retry"}. It will retry automatically.`,
    );
  }
  if (previous) await c.store.update("client_items", previous.id, { status: "superseded" });
  const row = await c.store.update("client_items", id, {
    status: "published",
    published_by: actorId(c),
    published_at: c.now.toISOString(),
  });
  if (item.quote_id) {
    const q = await c.store.get("quotes", item.quote_id);
    if (q?.status === "approved") await c.store.update("quotes", q.id, { status: "sent" });
  }
  await audit(c, "client_item.published", "client_items", id, null, { version: row.version, amount: row.amount, type: row.type });
  await logActivity(c, {
    type: "system",
    subject: `${TYPE_LABEL[row.type]} published to Konnect Hub: ${row.title} (v${row.version})`,
    related_type: row.opportunity_id ? "opportunity" : "account",
    related_id: row.opportunity_id ?? row.account_id,
    account_id: row.account_id,
  });
  return row;
}

export async function withdrawItem(c: Ctx, id: string, reason: string | null, transport?: Transport) {
  const { item } = await getClientItem(c, id);
  if (!canManage(c, item)) throw new ForbiddenError();
  if (!["published", "viewed", "changes_requested"].includes(item.status))
    throw new ValidationError("Only items that are live in the portal can be withdrawn.");
  const payload = ClientItemWithdrawnPayload.parse({
    version: CONTRACT_VERSION,
    event: "client_item.withdrawn",
    idempotency_key: `${item.id}:v${item.version}:withdraw`,
    item_id: item.id,
    version_no: item.version,
    reason,
  });
  await send(c, "client_item.withdrawn", payload, payload.idempotency_key, transport);
  const row = await c.store.update("client_items", id, { status: "withdrawn" });
  await audit(c, "client_item.withdrawn", "client_items", id, { status: item.status }, { status: "withdrawn" });
  await logActivity(c, {
    type: "system",
    subject: `Withdrawn from Konnect Hub: ${item.title} (v${item.version})`,
    body: reason,
    related_type: item.opportunity_id ? "opportunity" : "account",
    related_id: item.opportunity_id ?? item.account_id,
    account_id: item.account_id,
  });
  return row;
}

// ---------------- Inbound: viewed / decided / survey ----------------

async function itemFor(c: Ctx, itemId: string, version: number) {
  const item = await c.store.get("client_items", itemId);
  if (!item) throw new Error(`unknown item ${itemId}`);
  if (item.version !== version) throw new Error(`version mismatch (have v${item.version}, got v${version})`);
  return item;
}

export async function onViewed(c: Ctx, e: { item_id: string; version: number; viewed_by?: { name: string; email: string } }) {
  const item = await itemFor(c, e.item_id, e.version);
  if (item.status !== "published") return { ignored: `status ${item.status}` };
  await c.store.update("client_items", item.id, { status: "viewed" });
  await logActivity(c, {
    type: "system",
    subject: `Client viewed: ${item.title}`,
    body: e.viewed_by ? `Opened by ${e.viewed_by.name} in the Konnect Hub portal.` : null,
    related_type: "client_item",
    related_id: item.id,
    account_id: item.account_id,
  });
  await notify(
    c,
    item.owner_id,
    "client_decision",
    `${e.viewed_by?.name ?? "The client"} viewed ${item.title}`,
    `/client-items/${item.id}`,
  );
  return { status: "viewed" };
}

export async function onDecided(
  c: Ctx,
  e: {
    item_id: string;
    version: number;
    decision: "accepted" | "declined" | "changes_requested";
    note?: string | null;
    decided_by: { name: string; title?: string | null; email: string };
    decided_at: string;
    ip?: string | null;
  },
  transport?: Transport,
) {
  const item = await itemFor(c, e.item_id, e.version);
  if (!["published", "viewed", "changes_requested"].includes(item.status)) return { ignored: `status ${item.status}` };
  const row = await c.store.update("client_items", item.id, {
    status: e.decision,
    decided_by_name: e.decided_by.name,
    decided_by_title: e.decided_by.title ?? null,
    decided_by_email: e.decided_by.email,
    decided_at: e.decided_at,
    decision_ip: e.ip ?? null,
    decision_note: e.note ?? null,
  });
  const verb = { accepted: "accepted", declined: "declined", changes_requested: "requested changes to" }[e.decision];
  await audit(
    c,
    `client_item.${e.decision}`,
    "client_items",
    item.id,
    { status: item.status },
    { status: e.decision, decided_by: e.decided_by.email },
  );
  await logActivity(c, {
    type: "system",
    subject: `${e.decided_by.name} ${verb} ${item.title} (v${item.version})`,
    body: e.note ?? null,
    related_type: item.opportunity_id ? "opportunity" : "account",
    related_id: item.opportunity_id ?? item.account_id,
    account_id: item.account_id,
  });
  await notify(
    c,
    item.owner_id,
    "client_decision",
    `${e.decided_by.name} ${verb} ${item.title}`,
    `/client-items/${item.id}`,
    e.note ?? null,
  );
  const effects: string[] = [];

  if (e.decision === "changes_requested") {
    await createTask(c, {
      title: `Revise "${item.title}" — client requested changes`,
      assignee_id: item.owner_id,
      priority: "high",
      due_at: new Date(c.now.getTime() + 2 * 86_400_000).toISOString(),
      related_type: "client_item",
      related_id: item.id,
      account_id: item.account_id,
      notes: e.note ?? null,
    });
    effects.push("task_created");
  }
  if (item.quote_id && e.decision !== "changes_requested") {
    await c.store.update("quotes", item.quote_id, { status: e.decision === "accepted" ? "accepted" : "declined" });
    effects.push(`quote_${e.decision}`);
  }
  if (e.decision === "accepted" && item.opportunity_id) {
    const o = await c.store.get("opportunities", item.opportunity_id);
    if (o && o.stage !== "won") {
      await c.store.update("opportunities", o.id, { stage: "won", probability: 100, expected_close: c.now.toISOString().slice(0, 10) });
      await audit(c, "opportunity.stage_changed", "opportunities", o.id, { stage: o.stage }, { stage: "won", via: "client_item.decided" });
      await logActivity(c, {
        type: "stage_change",
        subject: `Stage moved to Won — client accepted in Konnect Hub`,
        related_type: "opportunity",
        related_id: o.id,
        account_id: o.account_id,
      });
      effects.push("opportunity_won");
    }
    if (item.type === "quote") {
      effects.push(await autoHandoff(c, item, e.decided_by.email, transport));
    } else if ((item.type === "renewal_offer" || item.type === "contract_amendment") && item.konnect_hub_project_id) {
      await sendProjectExtended(
        c,
        item.konnect_hub_project_id,
        {
          new_end_date: item.new_end_date,
          additional_value: item.amount,
          currency: item.currency,
          reason: `${TYPE_LABEL[item.type]} accepted: ${item.title}`,
          key: `${item.id}:v${item.version}:extend`,
        },
        transport,
      );
      effects.push("project_extended");
    }
  }
  return { status: row.status, effects };
}

/** Quote accepted with no project yet → run the handoff with details derived from the quote. */
async function autoHandoff(c: Ctx, item: ClientItem, deciderEmail: string, transport?: Transport): Promise<string> {
  if (!item.opportunity_id) return "no_opportunity";
  const existing = await c.store.list("handoffs", { where: { opportunity_id: item.opportunity_id } });
  if (existing.some((h) => h.status === "acknowledged")) return "project_exists";
  const contacts = (await c.store.list("contacts", { where: { account_id: item.account_id } })).filter((x) => x.email);
  const decider = contacts.find((x) => x.email?.toLowerCase() === deciderEmail.toLowerCase());
  const lead = (await c.store.list("users")).find((u) => u.role === "delivery_lead");
  const o = await c.store.get("opportunities", item.opportunity_id);
  const start = c.now.toISOString().slice(0, 10);
  const end = new Date(c.now.getTime() + 365 * 86_400_000).toISOString().slice(0, 10);
  try {
    if (!lead || !contacts.length) throw new Error("missing delivery lead or client contacts");
    await startHandoff(
      c,
      item.opportunity_id,
      {
        contract_no: item.title.split(" · ")[0],
        contract_value: item.amount ?? o?.value ?? 1,
        start_date: start,
        end_date: end,
        delivery_lead_id: lead.id,
        client_contacts: [{ contact_id: (decider ?? contacts[0]).id, role: "client_admin" }],
        scope_summary: `${item.title}. ${item.summary ?? item.lines.map((l) => l.item).join("; ")}`,
        acceptance_criteria: item.lines.length ? item.lines.map((l) => l.item) : [item.title],
        document_file_ids: item.document_file_id ? [item.document_file_id] : [],
      },
      transport,
    );
    return "handoff_sent";
  } catch (err) {
    const owner = o?.owner_id ?? item.owner_id;
    await createTask(c, {
      title: `Run the Konnect Hub handoff for ${o?.name ?? item.title}`,
      assignee_id: owner,
      priority: "high",
      related_type: "opportunity",
      related_id: item.opportunity_id,
      account_id: item.account_id,
      notes: (err as Error).message,
    });
    return "handoff_task_created";
  }
}

export async function onSurvey(
  c: Ctx,
  e: {
    item_id: string;
    version: number;
    score: number;
    comment?: string | null;
    submitted_by: { name: string; email: string };
    submitted_at: string;
  },
) {
  const item = await itemFor(c, e.item_id, e.version);
  if (item.type !== "survey") throw new Error("not a survey");
  await c.store.update("client_items", item.id, {
    status: "accepted",
    survey_score: e.score,
    decision_note: e.comment ?? null,
    decided_by_name: e.submitted_by.name,
    decided_by_email: e.submitted_by.email,
    decided_at: e.submitted_at,
  });
  await c.store.update("accounts", item.account_id, { survey_score: e.score });
  const account = (await c.store.get("accounts", item.account_id))!;
  await logActivity(c, {
    type: "system",
    subject: `Survey submitted: ${e.score}/10`,
    body: e.comment ?? null,
    related_type: "account",
    related_id: account.id,
    account_id: account.id,
  });
  const threshold = (await orgSettings(c)).low_survey_threshold;
  if (e.score <= threshold) {
    await notify(
      c,
      account.owner_id,
      "alert",
      `Low satisfaction from ${account.name}: ${e.score}/10`,
      `/accounts/${account.id}`,
      e.comment ?? null,
    );
    return { alert: true };
  }
  return { alert: false };
}

// ---------------- Daily expiry job ----------------

/** Marks items past respond_by as expired and nudges owners about items due within 2 days. */
export async function runExpiryJob(c: Ctx) {
  const today = c.now.toISOString().slice(0, 10);
  const soon = new Date(c.now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  let expired = 0;
  let nudged = 0;
  const sentToday = new Set(
    (await c.store.list("notifications")).filter((n) => n.created_at.startsWith(today)).map((n) => `${n.user_id}:${n.title}`),
  );
  for (const i of await c.store.list("client_items", { where: { status: ["published", "viewed"] } })) {
    if (!i.respond_by) continue;
    if (i.respond_by < today) {
      await c.store.update("client_items", i.id, { status: "expired" });
      await logActivity(c, {
        type: "system",
        subject: `Expired without a decision: ${i.title}`,
        related_type: "client_item",
        related_id: i.id,
        account_id: i.account_id,
      });
      await notify(c, i.owner_id, "expiry", `${i.title} expired without a client decision`, `/client-items/${i.id}`);
      expired++;
    } else if (i.respond_by <= soon) {
      const title = `${i.title} is due for a client decision by ${i.respond_by}`;
      if (!sentToday.has(`${i.owner_id}:${title}`)) {
        await notify(c, i.owner_id, "deadline", title, `/client-items/${i.id}`);
        nudged++;
      }
    }
  }
  return { expired, nudged };
}
