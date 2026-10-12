import type { Ctx } from "@/lib/services/context-types";
import { InboundEvent } from "./contract";
import { verify } from "./signing";

export type InboundHandlers = {
  [K in InboundEvent["event"]]?: (c: Ctx, payload: Extract<InboundEvent, { event: K }>) => Promise<Record<string, unknown>>;
};

/** Deterministic idempotency key per inbound event. */
export function inboundKey(e: InboundEvent): string {
  switch (e.event) {
    case "project.health_updated":
      return `${e.event}:${e.konnect_hub_project_id}:${e.updated_at}`;
    case "client_item.viewed":
      return `${e.event}:${e.item_id}:v${e.version}`;
    case "client_item.decided":
      return `${e.event}:${e.item_id}:v${e.version}`;
    case "survey.submitted":
      return `${e.event}:${e.item_id}:v${e.version}`;
  }
}

/**
 * Verifies, validates, de-duplicates, logs and dispatches one inbound Konnect Hub event.
 * Returns an HTTP-ish result for the route handler.
 */
export async function handleInbound(c: Ctx, body: string, signature: string | null, secret: string, handlers: InboundHandlers) {
  const v = verify(body, signature, secret, c.now.getTime());
  if (!v.ok) return { status: 401, body: { error: v.reason } };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: "invalid JSON" } };
  }
  const parsed = InboundEvent.safeParse(json);
  if (!parsed.success) return { status: 422, body: { error: parsed.error.issues[0]?.message ?? "invalid event" } };
  const e = parsed.data;
  const key = inboundKey(e);
  const [dup] = await c.store.list("integration_events", { where: { direction: "inbound", idempotency_key: key } });
  if (dup?.status === "processed") return { status: 200, body: { ok: true, idempotent_replay: true } };
  const row =
    dup ??
    (await c.store.insert("integration_events", {
      direction: "inbound",
      event: e.event,
      idempotency_key: key,
      status: "pending",
      attempts: 0,
      last_error: null,
      payload: json as Record<string, unknown>,
      response: null,
    }));
  const handler = handlers[e.event] as ((c: Ctx, p: InboundEvent) => Promise<Record<string, unknown>>) | undefined;
  if (!handler) {
    await c.store.update("integration_events", row.id, { status: "rejected", attempts: row.attempts + 1, last_error: "no handler" });
    return { status: 422, body: { error: `unsupported event ${e.event}` } };
  }
  try {
    const out = await handler(c, e);
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
    return { status: 422, body: { error: (err as Error).message } };
  }
}
