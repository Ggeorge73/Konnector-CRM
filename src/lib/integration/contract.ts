/**
 * The Konnect Hub integration contract (version 1). Mirrors
 * .claude/skills/konnector-crm-builder/references/data-model.md — change both sides together.
 * Outbound payloads are built ONLY from these schemas (strict), so internal fields
 * (unit cost, margin, internal notes, bid scores, vetting) can never leak.
 */
import { z } from "zod";

export const CONTRACT_VERSION = "1";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().nonnegative();

export const OpportunityWonPayload = z
  .object({
    version: z.literal(CONTRACT_VERSION),
    event: z.literal("opportunity.won"),
    idempotency_key: z.string().min(1),
    account: z.object({ crm_id: z.string(), name: z.string(), type: z.string(), konnect_hub_client_id: z.string().nullable() }).strict(),
    project: z
      .object({
        name: z.string(),
        contract_no: z.string(),
        value: money,
        currency: z.string().length(3),
        start_date: isoDate,
        end_date: isoDate,
        service_lines: z.array(z.string()),
        scope_summary: z.string(),
        acceptance_criteria: z.array(z.string()),
      })
      .strict(),
    delivery_lead_email: z.string().email(),
    client_contacts: z.array(
      z
        .object({ name: z.string(), email: z.string().email(), role: z.enum(["client_admin", "client_approver", "client_member"]) })
        .strict(),
    ),
    documents: z.array(z.object({ name: z.string(), url: z.string().url() }).strict()),
  })
  .strict();
export type OpportunityWonPayload = z.infer<typeof OpportunityWonPayload>;

export const HandoffAck = z.object({
  konnect_hub_client_id: z.string(),
  konnect_hub_project_id: z.string(),
  project_url: z.string().url(),
});

export const ProjectExtendedPayload = z
  .object({
    version: z.literal(CONTRACT_VERSION),
    event: z.literal("project.extended"),
    idempotency_key: z.string(),
    konnect_hub_project_id: z.string(),
    new_end_date: isoDate.nullable(),
    additional_value: money.nullable(),
    currency: z.string().length(3),
    reason: z.string(),
  })
  .strict();

const rag = z.enum(["green", "amber", "red"]);
export const HealthUpdatedPayload = z.object({
  version: z.literal(CONTRACT_VERSION).optional(),
  event: z.literal("project.health_updated"),
  konnect_hub_project_id: z.string(),
  health_schedule: rag,
  health_budget: rag,
  health_acceptance: rag,
  percent_complete: z.number().min(0).max(100),
  status: z.string(),
  updated_at: z.string().datetime({ offset: true }),
});

/** Client-facing item line: no cost, no margin. */
export const ClientItemLinePayload = z
  .object({ item: z.string(), description: z.string().nullable(), qty: z.number(), unit_price: money })
  .strict();

export const ClientItemPublishedPayload = z
  .object({
    version: z.literal(CONTRACT_VERSION),
    event: z.literal("client_item.published"),
    idempotency_key: z.string(),
    item: z
      .object({
        item_id: z.string(),
        lineage_id: z.string(),
        version: z.number().int().positive(),
        supersedes_version: z.number().int().positive().nullable(),
        type: z.enum(["quote", "contract_amendment", "renewal_offer", "survey"]),
        konnect_hub_client_id: z.string(),
        konnect_hub_project_id: z.string().nullable(),
        title: z.string(),
        summary: z.string().nullable(),
        amount: money.nullable(),
        currency: z.string().length(3),
        lines: z.array(ClientItemLinePayload),
        terms: z.string().nullable(),
        new_end_date: isoDate.nullable(),
        respond_by: isoDate.nullable(),
        document: z.object({ name: z.string(), url: z.string().url() }).strict().nullable(),
        requires_signature: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type ClientItemPublishedPayload = z.infer<typeof ClientItemPublishedPayload>;

export const ClientItemWithdrawnPayload = z
  .object({
    version: z.literal(CONTRACT_VERSION),
    event: z.literal("client_item.withdrawn"),
    idempotency_key: z.string(),
    item_id: z.string(),
    version_no: z.number().int(),
    reason: z.string().nullable(),
  })
  .strict();

export const ClientItemViewedPayload = z.object({
  event: z.literal("client_item.viewed"),
  item_id: z.string(),
  version: z.number().int(),
  viewed_by: z.object({ name: z.string(), email: z.string().email() }).optional(),
  viewed_at: z.string(),
});

export const ClientItemDecidedPayload = z.object({
  event: z.literal("client_item.decided"),
  item_id: z.string(),
  version: z.number().int(),
  decision: z.enum(["accepted", "declined", "changes_requested"]),
  note: z.string().nullable().optional(),
  decided_by: z.object({ name: z.string(), title: z.string().nullable().optional(), email: z.string().email() }),
  decided_at: z.string(),
  ip: z.string().nullable().optional(),
});

export const SurveySubmittedPayload = z.object({
  event: z.literal("survey.submitted"),
  item_id: z.string(),
  version: z.number().int(),
  score: z.number().int().min(0).max(10),
  comment: z.string().nullable().optional(),
  submitted_by: z.object({ name: z.string(), email: z.string().email() }),
  submitted_at: z.string(),
});

export const InboundEvent = z.discriminatedUnion("event", [
  HealthUpdatedPayload,
  ClientItemViewedPayload,
  ClientItemDecidedPayload,
  SurveySubmittedPayload,
]);
export type InboundEvent = z.infer<typeof InboundEvent>;

/** Keys that must never appear anywhere in an outbound payload. */
export const FORBIDDEN_OUTBOUND_KEYS =
  /^(unit_cost|cost|margin|margin_pct|internal_notes|rate_cost|total_score|scores|weights|risk_rating|sanctions_screen|pep_screen|beneficial_ownership)$/;

export function findForbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findForbiddenKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(FORBIDDEN_OUTBOUND_KEYS.test(k) ? [`${path}.${k}`] : []),
      ...findForbiddenKeys(v, `${path}.${k}`),
    ]);
  }
  return [];
}
