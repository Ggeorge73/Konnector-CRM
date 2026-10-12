/**
 * Outbound webhooks for other internal tools (accounting, e-signature…). Admin-managed.
 *
 * Every matching active subscription gets a `webhook_deliveries` row and a signed POST:
 *   headers  X-Konnector-Signature (same scheme as Konnect Hub: t=<ms>,v1=<hmac>),
 *            X-Konnector-Webhook-Event, X-Konnector-Webhook-Id
 *   body     { id, event, created_at, data }
 * Failures retry with the outbox backoff (1, 2, 4, 8, 16 min; 6 attempts) from the
 * integrations cron. Payloads are client-safe: no cost-side fields (findForbiddenKeys guard).
 * emitEvent never throws — a broken receiver must not break the business action.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import type { Store } from "@/lib/data/store";
import {
  WEBHOOK_EVENTS,
  type Account,
  type ClientItem,
  type Handoff,
  type Opportunity,
  type Quote,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookSubscription,
} from "@/lib/domain/types";
import { findForbiddenKeys } from "@/lib/integration/contract";
import { backoffMs, MAX_ATTEMPTS } from "@/lib/integration/outbox";
import { sign } from "@/lib/integration/signing";
import { decrypt, encrypt } from "@/lib/server/crypto";
import { audit } from "./audit";
import type { Ctx } from "./context-types";
import { privilegedStore } from "./privileged";

// ---------------- Transport (injectable for tests) ----------------

export interface WebhookResult {
  ok: boolean;
  status: number;
  error?: string;
}
export type WebhookTransport = (url: string, body: string, headers: Record<string, string>) => Promise<WebhookResult>;

export const httpWebhookTransport: WebhookTransport = async (url, body, headers) => {
  const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000), redirect: "manual" });
  let error: string | undefined;
  if (!res.ok) error = (await res.text().catch(() => "")).slice(0, 300) || res.statusText;
  return { ok: res.ok, status: res.status, error };
};

const g = globalThis as unknown as { __kcrmWebhookTransport?: WebhookTransport | null };
/** Tests: route every delivery through a fake transport (null restores HTTP). */
export function setWebhookTransport(t: WebhookTransport | null) {
  g.__kcrmWebhookTransport = t;
}
const transportFor = (t?: WebhookTransport) => t ?? g.__kcrmWebhookTransport ?? httpWebhookTransport;

// ---------------- Views ----------------

export type SubscriptionView = Omit<WebhookSubscription, "secret_enc">;
const subView = ({ secret_enc: _omit, ...rest }: WebhookSubscription): SubscriptionView => rest;

function requireAdmin(c: Ctx) {
  if (c.user.role !== "admin") throw new ForbiddenError("Only admins can manage webhooks.");
}

// ---------------- Subscriptions (admin CRUD) ----------------

export const SubscriptionInput = z.object({
  url: z
    .string()
    .trim()
    .url("Enter a full URL")
    .refine(
      (u) => /^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u),
      "Use https:// (http is allowed for localhost only)",
    ),
  description: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event"),
});
export type SubscriptionInputT = z.input<typeof SubscriptionInput>;

/** Creates a subscription; the signing secret is returned once and stored encrypted. */
export async function createSubscription(c: Ctx, input: SubscriptionInputT): Promise<{ subscription: SubscriptionView; secret: string }> {
  requireAdmin(c);
  const v = SubscriptionInput.parse(input);
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const store = await privilegedStore(c);
  const row = await store.insert("webhook_subscriptions", {
    org_id: c.user.org_id,
    url: v.url,
    description: v.description ?? null,
    events: [...new Set(v.events)],
    secret_enc: encrypt(secret),
    active: true,
    created_by: c.user.id,
  });
  await audit(c, "webhook.created", "webhook_subscriptions", row.id, null, { url: row.url, events: row.events });
  return { subscription: subView(row), secret };
}

export async function listSubscriptions(c: Ctx): Promise<SubscriptionView[]> {
  requireAdmin(c);
  const store = await privilegedStore(c);
  return (await store.list("webhook_subscriptions", { orderBy: { column: "created_at", ascending: false } }))
    .filter((s) => s.org_id === c.user.org_id)
    .map(subView);
}

async function getSub(c: Ctx, store: Store, id: string) {
  const s = await store.get("webhook_subscriptions", id);
  if (!s || s.archived_at || s.org_id !== c.user.org_id) throw new ForbiddenError("Subscription not found.");
  return s;
}

export async function updateSubscription(
  c: Ctx,
  id: string,
  patch: Partial<SubscriptionInputT> & { active?: boolean },
): Promise<SubscriptionView> {
  requireAdmin(c);
  const store = await privilegedStore(c);
  const before = await getSub(c, store, id);
  const v = SubscriptionInput.partial().extend({ active: z.boolean().optional() }).parse(patch);
  const row = await store.update("webhook_subscriptions", id, v as Partial<WebhookSubscription>);
  await audit(
    c,
    "webhook.updated",
    "webhook_subscriptions",
    id,
    { url: before.url, events: before.events, active: before.active },
    { url: row.url, events: row.events, active: row.active },
  );
  return subView(row);
}

/** Archives the subscription (delivery history is kept). */
export async function deleteSubscription(c: Ctx, id: string) {
  requireAdmin(c);
  const store = await privilegedStore(c);
  const before = await getSub(c, store, id);
  await store.update("webhook_subscriptions", id, { active: false, archived_at: c.now.toISOString() });
  await audit(c, "webhook.deleted", "webhook_subscriptions", id, { url: before.url }, { archived_at: c.now.toISOString() });
}

export async function listDeliveries(c: Ctx, opts: { subscriptionId?: string; limit?: number } = {}): Promise<WebhookDelivery[]> {
  requireAdmin(c);
  const store = await privilegedStore(c);
  const subs = new Set(
    (await store.list("webhook_subscriptions", { includeArchived: true })).filter((s) => s.org_id === c.user.org_id).map((s) => s.id),
  );
  return (
    await store.list("webhook_deliveries", {
      where: opts.subscriptionId ? { subscription_id: opts.subscriptionId } : undefined,
      orderBy: { column: "created_at", ascending: false },
    })
  )
    .filter((d) => subs.has(d.subscription_id))
    .slice(0, opts.limit ?? 50);
}

// ---------------- Delivery ----------------

export interface Envelope {
  id: string;
  event: WebhookEvent;
  created_at: string;
  test?: true;
  data: Record<string, unknown>;
}

async function attempt(
  store: Store,
  sub: WebhookSubscription | null,
  row: WebhookDelivery,
  now: Date,
  transport?: WebhookTransport,
): Promise<WebhookDelivery> {
  const attempts = row.attempts + 1;
  if (!sub || sub.archived_at) {
    return store.update("webhook_deliveries", row.id, {
      status: "failed",
      attempts,
      last_error: "Subscription deleted",
      next_attempt_at: null,
    });
  }
  const body = JSON.stringify(row.payload);
  let result: WebhookResult;
  try {
    const signature = sign(body, decrypt(sub.secret_enc)); // wall clock: receivers reject stale signatures
    result = await transportFor(transport)(sub.url, body, {
      "Content-Type": "application/json",
      "User-Agent": "Konnector-CRM-Webhooks/1",
      "X-Konnector-Signature": signature,
      "X-Konnector-Webhook-Event": row.event,
      "X-Konnector-Webhook-Id": row.event_id,
    });
  } catch (e) {
    result = { ok: false, status: 0, error: (e as Error).message };
  }
  if (result.ok) {
    return store.update("webhook_deliveries", row.id, {
      status: "delivered",
      attempts,
      response_status: result.status,
      last_error: null,
      next_attempt_at: null,
    });
  }
  // 4xx other than 408/429 means the receiver rejected the request; retrying won't help.
  const permanent = result.status >= 400 && result.status < 500 && result.status !== 408 && result.status !== 429;
  const failed = permanent || attempts >= MAX_ATTEMPTS;
  return store.update("webhook_deliveries", row.id, {
    status: failed ? "failed" : "pending",
    attempts,
    response_status: result.status || null,
    last_error: `${result.status ? `HTTP ${result.status}` : "Network error"}: ${result.error ?? "delivery failed"}`.slice(0, 500),
    next_attempt_at: failed ? null : new Date(now.getTime() + backoffMs(attempts)).toISOString(),
  });
}

async function deliverTo(
  store: Store,
  sub: WebhookSubscription,
  envelope: Envelope,
  now: Date,
  transport?: WebhookTransport,
): Promise<WebhookDelivery> {
  const row = await store.insert("webhook_deliveries", {
    subscription_id: sub.id,
    event: envelope.event,
    event_id: envelope.id,
    payload: envelope as unknown as Record<string, unknown>,
    status: "pending",
    attempts: 0,
    response_status: null,
    last_error: null,
    next_attempt_at: now.toISOString(),
  });
  return attempt(store, sub, row, now, transport);
}

/**
 * Records and delivers `event` to every active subscription for it. Never throws: errors are
 * logged and recorded on the delivery row. Refuses payloads that carry cost-side fields.
 */
export async function emitEvent(
  c: Ctx,
  event: WebhookEvent,
  data: Record<string, unknown>,
  opts: { transport?: WebhookTransport } = {},
): Promise<WebhookDelivery[]> {
  try {
    const leaks = findForbiddenKeys(data);
    if (leaks.length) {
      console.error(`webhooks: refusing to emit ${event} with internal fields: ${leaks.join(", ")}`);
      return [];
    }
    const store = await privilegedStore(c);
    const subs = (await store.list("webhook_subscriptions", { where: { active: true } })).filter(
      (s) => s.org_id === c.user.org_id && s.events.includes(event),
    );
    if (!subs.length) return [];
    const envelope: Envelope = { id: randomUUID(), event, created_at: c.now.toISOString(), data };
    const out: WebhookDelivery[] = [];
    for (const s of subs) {
      try {
        out.push(await deliverTo(store, s, envelope, c.now, opts.transport));
      } catch (e) {
        console.error(`webhooks: delivery of ${event} to ${s.id} failed`, e);
      }
    }
    return out;
  } catch (e) {
    console.error(`webhooks: emit ${event} failed`, e);
    return [];
  }
}

/** Sends a signed sample event (flagged `test: true`) to one subscription, even if it is disabled. */
export async function sendTestEvent(c: Ctx, subscriptionId: string, transport?: WebhookTransport): Promise<WebhookDelivery> {
  requireAdmin(c);
  const store = await privilegedStore(c);
  const sub = await getSub(c, store, subscriptionId);
  const envelope: Envelope = {
    id: randomUUID(),
    event: sub.events[0],
    created_at: c.now.toISOString(),
    test: true,
    data: { message: "Test event from Konnector CRM", subscription_id: sub.id, sent_by: c.user.email },
  };
  return deliverTo(store, sub, envelope, c.now, transport);
}

/** Admin "Retry" on one delivery, regardless of its backoff. */
export async function retryDelivery(c: Ctx, id: string, transport?: WebhookTransport): Promise<WebhookDelivery> {
  requireAdmin(c);
  const store = await privilegedStore(c);
  const d = await store.get("webhook_deliveries", id);
  if (!d) throw new ForbiddenError("Delivery not found.");
  const sub = await store.get("webhook_subscriptions", d.subscription_id);
  if (!sub || sub.org_id !== c.user.org_id) throw new ForbiddenError("Delivery not found.");
  if (d.status === "delivered") throw new ValidationError("This delivery already succeeded.");
  return attempt(store, sub, d, c.now, transport);
}

/** Cron: retries pending deliveries whose backoff has elapsed. Run with a system context. */
export async function retryDueWebhooks(c: Ctx, transport?: WebhookTransport, force = false) {
  const store = await privilegedStore(c);
  const due = (await store.list("webhook_deliveries", { where: { status: "pending" } })).filter(
    (d) => force || !d.next_attempt_at || new Date(d.next_attempt_at) <= c.now,
  );
  const subs = new Map<string, WebhookSubscription | null>();
  const out: WebhookDelivery[] = [];
  for (const d of due) {
    if (!subs.has(d.subscription_id)) subs.set(d.subscription_id, await store.get("webhook_subscriptions", d.subscription_id));
    out.push(await attempt(store, subs.get(d.subscription_id) ?? null, d, c.now, transport));
  }
  return out;
}

// ---------------- Payload builders (client-safe fields only) ----------------

const pick = <T extends object, K extends keyof T>(o: T, keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

export const webhookData = {
  account: (a: Account, changed?: string[]) => ({
    account: pick(a, [
      "id",
      "name",
      "type",
      "sector",
      "country",
      "state_region",
      "city",
      "website",
      "tier",
      "status",
      "owner_id",
      "konnect_hub_client_id",
      "created_at",
      "updated_at",
    ] as const),
    ...(changed ? { changed } : {}),
  }),
  opportunity: (o: Opportunity, previousStage?: string) => ({
    opportunity: pick(o, [
      "id",
      "name",
      "account_id",
      "owner_id",
      "kind",
      "stage",
      "value",
      "currency",
      "probability",
      "expected_close",
      "source",
      "service_lines",
      "solicitation_no",
      "proposal_due",
      "created_at",
      "updated_at",
    ] as const),
    ...(previousStage ? { previous_stage: previousStage } : {}),
  }),
  quote: (q: Quote, previousStatus: string) => ({
    quote: pick(q, ["id", "number", "title", "opportunity_id", "account_id", "status", "currency", "valid_until", "updated_at"] as const),
    previous_status: previousStatus,
  }),
  clientItem: (i: ClientItem) => ({
    client_item: pick(i, [
      "id",
      "type",
      "title",
      "account_id",
      "opportunity_id",
      "quote_id",
      "version",
      "status",
      "amount",
      "currency",
      "decided_by_name",
      "decided_by_email",
      "decided_at",
    ] as const),
  }),
  handoff: (h: Handoff, accountId: string) => ({
    handoff: pick(h, ["id", "opportunity_id", "konnect_hub_project_id", "konnect_hub_url", "updated_at"] as const),
    account_id: accountId,
  }),
};
