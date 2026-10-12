/**
 * OpenAPI 3.1 document for REST API v1. Request bodies are generated from the same Zod
 * schemas the services validate with; response shapes mirror the row types in types.ts.
 * Served at GET /api/v1/openapi.json.
 */
import { z } from "zod";
import { APP_NAME } from "@/config/app";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  ACTIVITY_TYPES,
  BUYING_ROLES,
  OPP_KINDS,
  OPP_SOURCES,
  SERVICE_LINES,
  STAGES,
} from "@/lib/domain/types";
import { MoveInput, OpportunityInput } from "@/lib/services/capture";
import { AccountInput, ActivityInput, ContactInput, TaskInput } from "@/lib/services/core";
import { RATE_LIMIT } from "./rate-limit";
import { DEFAULT_LIMIT, MAX_LIMIT, resources, type Resource } from "./resources";

type Schema = Record<string, unknown>;

/** Zod → JSON Schema (input side), without the noisy regexes Zod adds next to `format`. */
function fromZod(s: z.ZodType): Schema {
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") {
      const o = { ...(v as Schema) };
      delete o.$schema;
      if (o.format && o.pattern) delete o.pattern;
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, clean(x)]));
    }
    return v;
  };
  return clean(z.toJSONSchema(s, { io: "input", unrepresentable: "any" })) as Schema;
}

const str = { type: "string" };
const nstr = { type: ["string", "null"] };
const uuid = { type: "string", format: "uuid" };
const nuuid = { type: ["string", "null"], format: "uuid" };
const ts = { type: "string", format: "date-time" };
const nts = { type: ["string", "null"], format: "date-time" };
const ndate = { type: ["string", "null"], format: "date" };
const num = { type: "number" };
const enumOf = (v: readonly string[], nullable = false) => ({
  type: nullable ? ["string", "null"] : "string",
  enum: nullable ? [...v, null] : [...v],
});
const BASE = { id: uuid, created_at: ts, updated_at: ts, created_by: nuuid, archived_at: nts };

const RELATED = ["account", "contact", "opportunity", "quote", "consultant", "event", "registration", "partner_vetting", "client_item"];

const rows: Record<Resource, Schema> = {
  accounts: {
    ...BASE,
    org_id: uuid,
    name: str,
    type: enumOf(ACCOUNT_TYPES),
    sector: str,
    country: str,
    state_region: nstr,
    city: nstr,
    lat: { type: ["number", "null"] },
    lng: { type: ["number", "null"] },
    website: nstr,
    logo_url: nstr,
    owner_id: uuid,
    tier: enumOf(["A", "B", "C"]),
    status: enumOf(ACCOUNT_STATUSES),
    konnect_hub_client_id: nstr,
    survey_score: { type: ["number", "null"] },
    description: nstr,
  },
  contacts: {
    ...BASE,
    org_id: uuid,
    account_id: uuid,
    first_name: str,
    last_name: str,
    title: nstr,
    email: nstr,
    phone: nstr,
    role_in_buying: enumOf(BUYING_ROLES, true),
    owner_id: uuid,
  },
  opportunities: {
    ...BASE,
    org_id: uuid,
    name: str,
    account_id: uuid,
    owner_id: uuid,
    kind: enumOf(OPP_KINDS),
    stage: enumOf(STAGES),
    value: num,
    currency: str,
    probability: num,
    pwin: { type: ["number", "null"] },
    expected_close: ndate,
    source: enumOf(OPP_SOURCES),
    service_lines: { type: "array", items: enumOf(SERVICE_LINES) },
    next_step: nstr,
    next_step_due: ndate,
    lost_reason: nstr,
    no_bid_reason: nstr,
    shared_with: { type: "array", items: uuid },
    parent_opportunity_id: nuuid,
    solicitation_no: nstr,
    agency_buyer: nstr,
    procurement_vehicle: nstr,
    naics: nstr,
    set_aside: nstr,
    questions_due: ndate,
    proposal_due: ndate,
    submission_method: nstr,
    incumbent: nstr,
  },
  activities: {
    ...BASE,
    org_id: uuid,
    type: enumOf(ACTIVITY_TYPES),
    subject: str,
    body: nstr,
    occurred_at: ts,
    related_type: enumOf(RELATED),
    related_id: uuid,
    account_id: nuuid,
    actor_id: nuuid,
    mentions: { type: "array", items: uuid },
    reactions: { type: "object", additionalProperties: { type: "array", items: uuid } },
  },
  tasks: {
    ...BASE,
    org_id: uuid,
    title: str,
    due_at: nts,
    assignee_id: uuid,
    priority: enumOf(["low", "medium", "high"]),
    status: enumOf(["open", "done"]),
    related_type: enumOf(RELATED, true),
    related_id: nuuid,
    account_id: nuuid,
    notes: nstr,
  },
  quotes: {
    ...BASE,
    org_id: uuid,
    opportunity_id: uuid,
    account_id: uuid,
    number: str,
    title: str,
    currency: str,
    status: str,
    valid_until: ndate,
    terms: nstr,
    approved_by: nuuid,
    approved_at: nts,
    owner_id: uuid,
    total: { type: "number", description: "Total price (client-facing)." },
    lines: {
      type: "array",
      description: "Client-facing lines. Unit cost and margin are never returned by the API.",
      items: {
        type: "object",
        properties: {
          id: uuid,
          position: { type: "integer" },
          item: str,
          description: nstr,
          qty: num,
          unit_price: num,
          oem_partner_account_id: nuuid,
        },
      },
    },
  },
};

const bodies: Partial<Record<Resource, { create?: Schema; update?: Schema; updateNote?: string }>> = {
  accounts: { create: fromZod(AccountInput), update: fromZod(AccountInput.partial()) },
  contacts: { create: fromZod(ContactInput), update: fromZod(ContactInput.omit({ account_id: true }).partial()) },
  opportunities: {
    create: fromZod(OpportunityInput),
    update: (() => {
      const s = fromZod(OpportunityInput.omit({ account_id: true }).partial());
      const move = fromZod(MoveInput) as { properties: Schema };
      (s.properties as Schema).stage = {
        ...(move.properties.to as Schema),
        description: "Moves the deal through the stage gates (moveStage).",
      };
      (s.properties as Schema).lost_reason = { type: "string", description: "Required with stage = lost." };
      (s.properties as Schema).no_bid_reason = { type: "string", description: "Required with stage = no_bid." };
      return s;
    })(),
  },
  activities: {
    create: (() => {
      const s = fromZod(ActivityInput) as { properties: Schema };
      s.properties.type = { type: "string", enum: ACTIVITY_TYPES.filter((t) => !["system", "stage_change", "handoff"].includes(t)) };
      s.properties.related_type = { type: "string", enum: ["account", "contact", "opportunity", "quote"] };
      return s;
    })(),
  },
  tasks: {
    create: fromZod(TaskInput),
    update: { type: "object", properties: { status: enumOf(["open", "done"]) }, required: ["status"], additionalProperties: false },
  },
};

const LABEL: Record<Resource, string> = {
  accounts: "Accounts",
  contacts: "Contacts",
  opportunities: "Opportunities",
  activities: "Activities",
  tasks: "Tasks",
  quotes: "Quotes",
};
const SINGULAR: Record<Resource, string> = {
  accounts: "Account",
  contacts: "Contact",
  opportunities: "Opportunity",
  activities: "Activity",
  tasks: "Task",
  quotes: "Quote",
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const err = (desc: string) => ({ description: desc, content: { "application/json": { schema: ref("Error") } } });
const RL_HEADERS = {
  "RateLimit-Limit": { schema: { type: "integer" }, description: "Requests allowed per minute." },
  "RateLimit-Remaining": { schema: { type: "integer" } },
  "RateLimit-Reset": { schema: { type: "integer" }, description: "Seconds until the bucket is full." },
};

export function openApiDocument(serverUrl = "/api/v1") {
  const paths: Schema = {};
  const schemas: Schema = {
    Error: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: {
              type: "string",
              enum: [
                "bad_request",
                "unauthorized",
                "forbidden",
                "insufficient_scope",
                "not_found",
                "method_not_allowed",
                "validation_failed",
                "rate_limited",
                "internal",
              ],
            },
            message: { type: "string" },
            details: {},
          },
        },
      },
    },
  };

  for (const r of Object.keys(rows) as Resource[]) {
    const def = resources[r];
    const name = SINGULAR[r];
    schemas[name] = { type: "object", properties: rows[r] };
    const b = bodies[r] ?? {};
    if (def.create && b.create) schemas[`${name}Create`] = b.create;
    if (def.update && b.update) schemas[`${name}Update`] = b.update;

    const common = {
      "401": err("Missing, invalid, revoked or expired API key."),
      "429": { ...err("Rate limit exceeded."), headers: { ...RL_HEADERS, "Retry-After": { schema: { type: "integer" } } } },
    };
    const filters = [...def.filters, "updated_since", ...(def.search ? ["q"] : [])];
    paths[`/${r}`] = {
      get: {
        tags: [LABEL[r]],
        summary: `List ${LABEL[r].toLowerCase()} visible to the key's user`,
        operationId: `list${LABEL[r]}`,
        "x-required-scope": "read",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT } },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "`next_cursor` from the previous page." },
          ...filters.map((f) => ({
            name: f,
            in: "query",
            schema: f === "updated_since" ? { type: "string", format: "date-time" } : { type: "string" },
            description:
              f === "q"
                ? `Case-insensitive search over ${def.search!.join(", ")}.`
                : f === "updated_since"
                  ? "Rows updated at or after this time."
                  : `Exact match on ${f}.`,
          })),
        ],
        responses: {
          "200": {
            description: "One page, oldest first.",
            headers: RL_HEADERS,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data", "next_cursor"],
                  properties: { data: { type: "array", items: ref(name) }, next_cursor: { type: ["string", "null"] } },
                },
              },
            },
          },
          "400": err("Unknown filter, bad limit or cursor."),
          ...common,
        },
      },
      ...(def.create && b.create
        ? {
            post: {
              tags: [LABEL[r]],
              summary: `Create ${name.toLowerCase()}`,
              operationId: `create${name}`,
              "x-required-scope": "write",
              requestBody: { required: true, content: { "application/json": { schema: ref(`${name}Create`) } } },
              responses: {
                "201": {
                  description: "Created.",
                  headers: RL_HEADERS,
                  content: { "application/json": { schema: { type: "object", properties: { data: ref(name) } } } },
                },
                "400": err("Body is not valid JSON."),
                "403": err("The key lacks the write scope, or the user's role can't do this."),
                "404": err("A referenced record isn't visible to the user."),
                "422": err("Validation failed (details lists each field)."),
                ...common,
              },
            },
          }
        : {}),
    };
    paths[`/${r}/{id}`] = {
      parameters: [{ name: "id", in: "path", required: true, schema: uuid }],
      get: {
        tags: [LABEL[r]],
        summary: `Get one ${name.toLowerCase()}`,
        operationId: `get${name}`,
        "x-required-scope": "read",
        responses: {
          "200": {
            description: "OK",
            headers: RL_HEADERS,
            content: { "application/json": { schema: { type: "object", properties: { data: ref(name) } } } },
          },
          "404": err("Not found, or not visible to the key's user."),
          ...common,
        },
      },
      ...(def.update && b.update
        ? {
            patch: {
              tags: [LABEL[r]],
              summary: `Update ${name.toLowerCase()}`,
              operationId: `update${name}`,
              "x-required-scope": "write",
              requestBody: { required: true, content: { "application/json": { schema: ref(`${name}Update`) } } },
              responses: {
                "200": {
                  description: "Updated.",
                  headers: RL_HEADERS,
                  content: { "application/json": { schema: { type: "object", properties: { data: ref(name) } } } },
                },
                "400": err("Body is not valid JSON."),
                "403": err("The key lacks the write scope, or the user can't edit this record."),
                "404": err("Not found, or not visible to the key's user."),
                "422": err("Validation failed, or a stage gate isn't met."),
                ...common,
              },
            },
          }
        : {}),
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: `${APP_NAME} REST API`,
      version: "1.0.0",
      description: [
        `Internal REST API for ${APP_NAME}. Authenticate with a personal API key from **API & webhooks** (/developer):`,
        "`Authorization: Bearer kcrm_<prefix>_<secret>`.",
        "",
        "Every request runs as the key's user, with the same role scoping, redaction and validation as the UI.",
        "Cost-side fields (unit cost, margins, consultant cost rates, bid scores, vetting) are never returned.",
        `Scopes: \`read\` allows GET; \`write\` adds POST and PATCH. Rate limit: ${RATE_LIMIT} requests per minute per key.`,
      ].join("\n"),
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    tags: (Object.keys(rows) as Resource[]).map((r) => ({ name: LABEL[r] })),
    paths,
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", bearerFormat: "kcrm_<prefix>_<secret>" } },
      schemas,
    },
  };
}
