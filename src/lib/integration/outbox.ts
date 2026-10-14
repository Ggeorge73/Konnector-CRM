import type { IntegrationEvent } from "@/lib/domain/types";
import { logEvent, reportError } from "@/lib/server/observability";
import type { Ctx } from "@/lib/services/context-types";
import { findForbiddenKeys } from "./contract";
import { defaultTransport, signBody, type Transport, type TransportResult } from "./transport";

export const MAX_ATTEMPTS = 6;
/** 1, 2, 4, 8, 16 minutes between attempts. */
export const backoffMs = (attempt: number) => 60_000 * 2 ** Math.max(0, attempt - 1);

export class ContractViolation extends Error {}

/**
 * Records an outbound event and tries to deliver it. Idempotent on `idempotency_key`:
 * re-sending a delivered key returns the stored response without another network call.
 */
export async function send(
  c: Ctx,
  event: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  transport: Transport = defaultTransport(),
): Promise<IntegrationEvent> {
  const leaks = findForbiddenKeys(payload);
  if (leaks.length) throw new ContractViolation(`Refusing to send internal fields: ${leaks.join(", ")}`);
  const [existing] = await c.store.list("integration_events", { where: { direction: "outbound", idempotency_key: idempotencyKey } });
  if (existing?.status === "delivered") return existing;
  const row =
    existing ??
    (await c.store.insert("integration_events", {
      direction: "outbound",
      event,
      idempotency_key: idempotencyKey,
      status: "pending",
      attempts: 0,
      last_error: null,
      payload,
      response: null,
      created_by: c.user.id,
    }));
  return attempt(c, existing ? { ...row, payload } : row, transport);
}

async function attempt(c: Ctx, row: IntegrationEvent, transport: Transport): Promise<IntegrationEvent> {
  const body = JSON.stringify(row.payload);
  let result: TransportResult;
  try {
    result = await transport(row.event, body, signBody(body)); // wall-clock: signatures must be fresh for the receiver
  } catch (e) {
    result = { ok: false, status: 0, body: { error: (e as Error).message } };
  }
  const attempts = row.attempts + 1;
  if (result.ok) {
    return c.store.update("integration_events", row.id, { status: "delivered", attempts, last_error: null, response: result.body });
  }
  const error = `HTTP ${result.status}: ${String(result.body.error ?? "delivery failed")}`;
  // 4xx (other than 408/429) is a contract error — retrying won't help.
  const permanent = result.status >= 400 && result.status < 500 && result.status !== 408 && result.status !== 429;
  const failed = permanent || attempts >= MAX_ATTEMPTS;
  // Status codes and ids only: the Hub's error text could echo payload content.
  logEvent(
    "konnect_hub.delivery_failed",
    { integrationEventId: row.id, eventType: row.event, attempts, httpStatus: result.status, final: failed },
    "warn",
  );
  if (failed) {
    reportError(new Error(`Konnect Hub delivery of ${row.event} failed after ${attempts} attempt(s) (HTTP ${result.status})`), {
      source: "integration.konnect_hub",
      userId: c.user.id,
    });
  }
  return c.store.update("integration_events", row.id, {
    status: failed ? "failed" : "pending",
    attempts,
    last_error: error,
    response: { ...result.body, next_attempt_at: permanent ? null : new Date(c.now.getTime() + backoffMs(attempts)).toISOString() },
  });
}

/** Retries pending outbound events whose backoff has elapsed. Called by the cron route. */
export async function retryDue(c: Ctx, transport: Transport = defaultTransport(), force = false) {
  const due = (await c.store.list("integration_events", { where: { direction: "outbound", status: "pending" } })).filter((e) => {
    const next = (e.response as { next_attempt_at?: string } | null)?.next_attempt_at;
    return force || !next || new Date(next) <= c.now;
  });
  const out: IntegrationEvent[] = [];
  for (const e of due) out.push(await attempt(c, e, transport));
  return out;
}

export async function retryOne(c: Ctx, id: string, transport: Transport = defaultTransport()) {
  const e = await c.store.get("integration_events", id);
  if (!e || e.direction !== "outbound" || e.status === "delivered") return e;
  return attempt(c, { ...e, status: "pending" }, transport);
}
