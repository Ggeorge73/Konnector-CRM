/**
 * Won → Konnect Hub handoff, project health from Konnect Hub, and project.extended.
 * The only place the CRM creates delivery work — and it does so in Konnect Hub, never here.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { env } from "@/config/app";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { canRunHandoff } from "@/lib/auth/permissions";
import type { Handoff, ProjectHealth, Rag } from "@/lib/domain/types";
import { CONTRACT_VERSION, HandoffAck, OpportunityWonPayload, ProjectExtendedPayload } from "@/lib/integration/contract";
import { retryOne, send } from "@/lib/integration/outbox";
import type { Transport } from "@/lib/integration/transport";
import { audit } from "./audit";
import type { Ctx } from "./context-types";
import { getAccount, logActivity, notify } from "./core";
import { getOpportunity } from "./capture";
import { emitEvent, webhookData } from "./webhooks";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");

export const HandoffInput = z
  .object({
    contract_no: z.string().trim().min(2, "Contract number is required").max(80),
    contract_value: z.coerce.number().positive("Contract value is required"),
    start_date: isoDate,
    end_date: isoDate,
    delivery_lead_id: z.string().uuid("Pick a delivery lead"),
    client_contacts: z
      .array(z.object({ contact_id: z.string().uuid(), role: z.enum(["client_admin", "client_approver", "client_member"]) }))
      .min(1, "Invite at least one client contact"),
    scope_summary: z.string().trim().min(10, "Summarise the scope").max(4000),
    acceptance_criteria: z.array(z.string().trim().min(3)).min(1, "Add at least one acceptance criterion"),
    document_file_ids: z.array(z.string().uuid()).default([]),
  })
  .refine((v) => v.end_date > v.start_date, { message: "End date must be after the start date", path: ["end_date"] });
export type HandoffInputT = z.input<typeof HandoffInput>;

/** 7-day signed download link for documents Konnect Hub pulls during handoff. */
export function signedFileUrl(fileId: string, now: Date, baseUrl = process.env.APP_URL ?? "http://localhost:3000") {
  const exp = now.getTime() + 7 * 86_400_000;
  const sig = createHmac("sha256", env.integrationSecret).update(`${fileId}.${exp}`).digest("hex");
  return `${baseUrl.replace(/\/$/, "")}/api/public-files/${fileId}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(fileId: string, exp: string | null, sig: string | null, now = Date.now()) {
  if (!exp || !sig || Number(exp) < now) return false;
  const expected = createHmac("sha256", env.integrationSecret).update(`${fileId}.${exp}`).digest("hex");
  return expected === sig;
}

export async function buildWonPayload(c: Ctx, opportunityId: string, input: HandoffInputT, idempotencyKey: string) {
  const v = HandoffInput.parse(input);
  const o = await getOpportunity(c, opportunityId);
  const account = await getAccount(c, o.account_id);
  const lead = await c.store.get("users", v.delivery_lead_id);
  if (!lead || !lead.role || !["delivery_lead", "admin", "executive"].includes(lead.role))
    throw new ValidationError("Pick a delivery lead.");
  const contacts = await Promise.all(v.client_contacts.map(async (cc) => ({ cc, row: await c.store.get("contacts", cc.contact_id) })));
  const invites = contacts.map(({ cc, row }) => {
    if (!row || row.account_id !== account.id) throw new ValidationError("Client contacts must belong to this account.");
    if (!row.email) throw new ValidationError(`${row.first_name} ${row.last_name} has no email address.`);
    return { name: `${row.first_name} ${row.last_name}`, email: row.email, role: cc.role };
  });
  const files = (await Promise.all(v.document_file_ids.map((id) => c.store.get("files", id)))).filter((f) => !!f);
  return OpportunityWonPayload.parse({
    version: CONTRACT_VERSION,
    event: "opportunity.won",
    idempotency_key: idempotencyKey,
    account: { crm_id: account.id, name: account.name, type: account.type, konnect_hub_client_id: account.konnect_hub_client_id },
    project: {
      name: o.name,
      contract_no: v.contract_no,
      value: v.contract_value,
      currency: o.currency,
      start_date: v.start_date,
      end_date: v.end_date,
      service_lines: o.service_lines,
      scope_summary: v.scope_summary,
      acceptance_criteria: v.acceptance_criteria,
    },
    delivery_lead_email: lead.email,
    client_contacts: invites,
    documents: files.map((f) => ({ name: f!.name, url: signedFileUrl(f!.id, c.now) })),
  });
}

/** Run the Won wizard: create (or reuse) the handoff, send it signed, record the result. */
export async function startHandoff(c: Ctx, opportunityId: string, input: HandoffInputT, transport?: Transport): Promise<Handoff> {
  if (!canRunHandoff(c.user)) throw new ForbiddenError("Only delivery leads and executives can run the handoff.");
  const o = await getOpportunity(c, opportunityId);
  if (o.stage !== "won") throw new ValidationError("Only won opportunities can be handed off.");
  const existing = (
    await c.store.list("handoffs", { where: { opportunity_id: o.id }, orderBy: { column: "created_at", ascending: false } })
  )[0];
  if (existing?.status === "acknowledged") throw new ValidationError("This opportunity has already been handed off.");
  const handoff =
    existing ??
    (await c.store.insert("handoffs", {
      opportunity_id: o.id,
      status: "pending",
      attempts: 0,
      last_error: null,
      konnect_hub_project_id: null,
      konnect_hub_url: null,
      payload_version: CONTRACT_VERSION,
      payload: {},
      next_attempt_at: null,
    }));
  // The handoff id is the idempotency key, so a retried wizard never creates a second project.
  const payload = await buildWonPayload(c, o.id, input, handoff.id);
  await c.store.update("handoffs", handoff.id, { payload });
  await audit(c, "handoff.started", "handoffs", handoff.id, null, { opportunity_id: o.id, contract_value: payload.project.value });
  const event = await send(c, "opportunity.won", payload, handoff.id, transport);
  return applyDelivery(c, handoff.id, event);
}

async function applyDelivery(c: Ctx, handoffId: string, event: Awaited<ReturnType<typeof send>>): Promise<Handoff> {
  const h = (await c.store.get("handoffs", handoffId))!;
  const o = (await c.store.get("opportunities", h.opportunity_id))!;
  if (event.status === "delivered") {
    const ack = HandoffAck.parse(event.response);
    const row = await c.store.update("handoffs", h.id, {
      status: "acknowledged",
      attempts: event.attempts,
      last_error: null,
      konnect_hub_project_id: ack.konnect_hub_project_id,
      konnect_hub_url: ack.project_url,
      next_attempt_at: null,
    });
    const acc = (await c.store.get("accounts", o.account_id))!;
    await c.store.update("accounts", acc.id, {
      konnect_hub_client_id: ack.konnect_hub_client_id,
      status: acc.status === "prospect" || acc.status === "past_client" ? "active_client" : acc.status,
    });
    await logActivity(c, {
      type: "handoff",
      subject: "Handed off to Konnect Hub",
      body: `Project created in Konnect Hub (${ack.konnect_hub_project_id}).`,
      related_type: "opportunity",
      related_id: o.id,
      account_id: o.account_id,
    });
    await audit(
      c,
      "handoff.acknowledged",
      "handoffs",
      h.id,
      { status: h.status },
      { status: "acknowledged", konnect_hub_project_id: ack.konnect_hub_project_id },
    );
    await notify(c, o.owner_id, "handoff", `${o.name} is live in Konnect Hub`, `/opportunities/${o.id}`);
    await emitEvent(c, "handoff.acknowledged", webhookData.handoff(row, o.account_id));
    return row;
  }
  const next = (event.response as { next_attempt_at?: string } | null)?.next_attempt_at ?? null;
  const row = await c.store.update("handoffs", h.id, {
    status: event.status === "failed" ? "failed" : "sent",
    attempts: event.attempts,
    last_error: event.last_error,
    next_attempt_at: next,
  });
  if (event.status === "failed") {
    for (const u of (await c.store.list("users")).filter((x) => x.role === "admin" || x.role === "delivery_lead")) {
      await notify(c, u.id, "alert", `Handoff failed: ${o.name}`, `/opportunities/${o.id}?tab=handoff`, event.last_error);
    }
  }
  return row;
}

export async function retryHandoff(c: Ctx, handoffId: string, transport?: Transport) {
  if (!canRunHandoff(c.user)) throw new ForbiddenError();
  const h = await c.store.get("handoffs", handoffId);
  if (!h) throw new ForbiddenError("Handoff not found.");
  const [event] = await c.store.list("integration_events", { where: { direction: "outbound", idempotency_key: h.id } });
  if (!event) throw new ValidationError("Nothing to retry.");
  const out = await retryOne(c, event.id, transport);
  return applyDelivery(c, h.id, out!);
}

/** After a cron retry pass, bring handoff rows in line with their outbound events. */
export async function syncHandoffs(c: Ctx) {
  for (const h of await c.store.list("handoffs", { where: { status: ["pending", "sent"] } })) {
    const [event] = await c.store.list("integration_events", { where: { direction: "outbound", idempotency_key: h.id } });
    if (event && (event.status === "delivered" || event.status === "failed")) await applyDelivery(c, h.id, event);
  }
}

// ---------------- Inbound: project.health_updated ----------------

export async function applyHealthUpdate(
  c: Ctx,
  e: {
    konnect_hub_project_id: string;
    health_schedule: Rag;
    health_budget: Rag;
    health_acceptance: Rag;
    percent_complete: number;
    status: string;
    updated_at: string;
  },
): Promise<Record<string, unknown>> {
  const [h] = await c.store.list("handoffs", { where: { konnect_hub_project_id: e.konnect_hub_project_id } });
  const o = h ? await c.store.get("opportunities", h.opportunity_id) : null;
  const [prev] = await c.store.list("project_health", { where: { konnect_hub_project_id: e.konnect_hub_project_id } });
  if (prev && prev.hub_updated_at >= e.updated_at) return { ignored: "stale update" };
  const data: Partial<ProjectHealth> = {
    health_schedule: e.health_schedule,
    health_budget: e.health_budget,
    health_acceptance: e.health_acceptance,
    percent_complete: e.percent_complete,
    status: e.status,
    hub_updated_at: e.updated_at,
  };
  const row = prev
    ? await c.store.update("project_health", prev.id, data)
    : await c.store.insert("project_health", {
        konnect_hub_project_id: e.konnect_hub_project_id,
        opportunity_id: o?.id ?? null,
        account_id: o?.account_id ?? null,
        project_name: o?.name ?? e.konnect_hub_project_id,
        end_date: null,
        health_schedule: e.health_schedule,
        health_budget: e.health_budget,
        health_acceptance: e.health_acceptance,
        percent_complete: e.percent_complete,
        status: e.status,
        hub_updated_at: e.updated_at,
      });
  const rags = [e.health_schedule, e.health_budget, e.health_acceptance];
  const worse = prev && rags.some((r, i) => rank(r) > rank([prev.health_schedule, prev.health_budget, prev.health_acceptance][i]));
  if (row.account_id && (worse || !prev)) {
    const label = (["Schedule", "Budget", "Acceptance"] as const).map((n, i) => `${n} ${rags[i]}`).join(", ");
    await logActivity(c, {
      type: "system",
      subject: `Health updated from Konnect Hub: ${row.project_name}`,
      body: label,
      related_type: "account",
      related_id: row.account_id,
      account_id: row.account_id,
    });
    if (rags.includes("red") || worse) {
      const acc = await c.store.get("accounts", row.account_id);
      if (acc) await notify(c, acc.owner_id, "alert", `${row.project_name} health: ${label}`, `/accounts/${acc.id}`);
    }
  }
  return { project_health_id: row.id };
}
const rank = (r: Rag) => (r === "green" ? 0 : r === "amber" ? 1 : 2);

// ---------------- Outbound: project.extended ----------------

export async function sendProjectExtended(
  c: Ctx,
  projectId: string,
  input: { new_end_date: string | null; additional_value: number | null; currency: string; reason: string; key: string },
  transport?: Transport,
) {
  const payload = ProjectExtendedPayload.parse({
    version: CONTRACT_VERSION,
    event: "project.extended",
    idempotency_key: input.key,
    konnect_hub_project_id: projectId,
    new_end_date: input.new_end_date,
    additional_value: input.additional_value,
    currency: input.currency,
    reason: input.reason,
  });
  const ev = await send(c, "project.extended", payload, input.key, transport);
  const [h] = await c.store.list("project_health", { where: { konnect_hub_project_id: projectId } });
  if (h && input.new_end_date) await c.store.update("project_health", h.id, { end_date: input.new_end_date });
  return ev;
}
