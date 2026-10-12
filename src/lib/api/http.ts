/**
 * REST API v1 request pipeline: bearer API key → rate limit → scope check → Ctx for the
 * key's user → resource (services) → JSON. Errors are always `{ error: { code, message, details? } }`.
 * Framework-agnostic (standard Request/Response) so it is unit-tested without Next.
 */
import { ZodError } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import type { Store } from "@/lib/data/store";
import type { ApiScope } from "@/lib/domain/types";
import { authenticateApiKey } from "@/lib/services/api-keys";
import type { Ctx } from "@/lib/services/context-types";
import { rateLimitHeaders, takeToken } from "./rate-limit";
import { BadRequest, paginate, resources, type Resource } from "./resources";

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "insufficient_scope"
  | "not_found"
  | "method_not_allowed"
  | "validation_failed"
  | "rate_limited"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  insufficient_scope: 403,
  not_found: 404,
  method_not_allowed: 405,
  validation_failed: 422,
  rate_limited: 429,
  internal: 500,
};

export function apiError(code: ErrorCode, message: string, details?: unknown, headers: Record<string, string> = {}) {
  return json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, STATUS[code], headers);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export type Op = "list" | "get" | "create" | "update";
const SCOPE: Record<Op, ApiScope> = { list: "read", get: "read", create: "write", update: "write" };

function mapError(e: unknown, op: Op, headers: Record<string, string>): Response {
  if (e instanceof BadRequest) return apiError("bad_request", e.message, undefined, headers);
  if (e instanceof ZodError) {
    return apiError(
      "validation_failed",
      e.issues[0]?.message ?? "Invalid input.",
      e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      headers,
    );
  }
  if (e instanceof ValidationError) return apiError("validation_failed", e.message, undefined, headers);
  if (e instanceof ForbiddenError) {
    // Reads never reveal whether a record exists; writes say why they were refused.
    if (op === "get" || /not found/i.test(e.message)) return apiError("not_found", "Not found.", undefined, headers);
    return apiError("forbidden", e.message, undefined, headers);
  }
  console.error("api/v1", e);
  return apiError("internal", "Something went wrong.", undefined, headers);
}

/**
 * Handles one API request. `store` must be the API store (see src/lib/api/store.ts): scoping
 * is done by the services for the key's user, exactly as in the UI.
 */
export async function handleApi(
  req: Request,
  route: { resource: Resource; id?: string },
  deps: { store: Store; now?: () => Date },
): Promise<Response> {
  const def = resources[route.resource];
  const op: Op | null =
    req.method === "GET"
      ? route.id
        ? "get"
        : "list"
      : req.method === "POST" && !route.id
        ? "create"
        : req.method === "PATCH" && route.id
          ? "update"
          : null;
  if (!op || (op === "create" && !def.create) || (op === "update" && !def.update)) {
    const allow = route.id ? ["GET", ...(def.update ? ["PATCH"] : [])] : ["GET", ...(def.create ? ["POST"] : [])];
    return apiError("method_not_allowed", `${req.method} is not supported on this resource.`, undefined, { Allow: allow.join(", ") });
  }

  const now = deps.now?.() ?? new Date();
  const auth = await authenticateApiKey(deps.store, req.headers.get("authorization"), now);
  if (!auth.ok) return apiError("unauthorized", auth.reason, undefined, { "WWW-Authenticate": 'Bearer realm="konnector-crm"' });

  const rl = takeToken(auth.key.id, now.getTime());
  const headers = rateLimitHeaders(rl);
  if (!rl.allowed) return apiError("rate_limited", `Rate limit exceeded (${rl.limit} requests per minute).`, undefined, headers);

  if (!auth.scopes.includes(SCOPE[op]))
    return apiError("insufficient_scope", `This key needs the "${SCOPE[op]}" scope.`, { required: SCOPE[op] }, headers);

  const c: Ctx = { user: auth.user, store: deps.store, now };
  try {
    if (op === "list") return json(paginate(await def.list(c), def, new URL(req.url).searchParams), 200, headers);
    if (op === "get") return json({ data: await def.get(c, route.id!) }, 200, headers);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError("bad_request", "Request body must be valid JSON.", undefined, headers);
    }
    if (op === "create") return json({ data: await def.create!(c, body) }, 201, headers);
    return json({ data: await def.update!(c, route.id!, body) }, 200, headers);
  } catch (e) {
    return mapError(e, op, headers);
  }
}
