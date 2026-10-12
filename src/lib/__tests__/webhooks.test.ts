import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";
import { seedIds } from "@/lib/data/seed";
import { WEBHOOK_EVENTS } from "@/lib/domain/types";
import { findForbiddenKeys } from "@/lib/integration/contract";
import { backoffMs, MAX_ATTEMPTS } from "@/lib/integration/outbox";
import { verify } from "@/lib/integration/signing";
import { decrypt } from "@/lib/server/crypto";
import { approveQuote, createOpportunity, moveStage } from "@/lib/services/capture";
import { createAccount, updateAccount } from "@/lib/services/core";
import {
  createSubscription,
  emitEvent,
  listDeliveries,
  retryDelivery,
  retryDueWebhooks,
  sendTestEvent,
  setWebhookTransport,
  updateSubscription,
  type WebhookResult,
} from "@/lib/services/webhooks";
import { asUser, NOW, switchUser } from "./helpers";

const ids = seedIds();

interface Sent {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** Fake receiver: records requests and answers with the queued results (default 200). */
function fakeTransport() {
  const sent: Sent[] = [];
  const queue: Array<WebhookResult | Error> = [];
  const t = async (url: string, body: string, headers: Record<string, string>) => {
    sent.push({ url, body, headers });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next ?? { ok: true, status: 200 };
  };
  return { t, sent, queue };
}

let fake = fakeTransport();
beforeEach(() => {
  fake = fakeTransport();
  setWebhookTransport(fake.t);
});
afterEach(() => setWebhookTransport(null));

const accountInput = {
  name: "Cobb County Water",
  type: "government_local",
  sector: "Utilities",
  country: "US",
  tier: "B",
  status: "prospect",
} as const;

describe("webhook subscriptions", () => {
  it("admin only; secret shown once, stored encrypted, never in the view", async () => {
    const admin = await asUser("admin");
    await expect(
      createSubscription(await switchUser(admin, "exec"), { url: "https://x.example.com", events: ["account.created"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createSubscription(await switchUser(admin, "bd1"), { url: "https://x.example.com", events: ["account.created"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const { subscription, secret } = await createSubscription(admin, { url: "https://acct.example.com/hook", events: ["account.created"] });
    expect(secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(subscription).not.toHaveProperty("secret_enc");
    const row = admin.store.raw("webhook_subscriptions")[0];
    expect(row.secret_enc).not.toContain(secret);
    expect(decrypt(row.secret_enc)).toBe(secret);
    expect(admin.store.raw("audit_log").some((a) => a.action === "webhook.created")).toBe(true);
    await expect(createSubscription(admin, { url: "http://evil.example.com", events: ["account.created"] })).rejects.toThrow(/https/);
    await expect(createSubscription(admin, { url: "https://x.example.com", events: [] })).rejects.toThrow();
  });
});

describe("emitEvent", () => {
  it("delivers a signed envelope that verifies with the subscription secret", async () => {
    const admin = await asUser("admin");
    const { secret, subscription } = await createSubscription(admin, { url: "https://acct.example.com/hook", events: ["account.created"] });
    const bd = await switchUser(admin, "bd1");
    const acc = await createAccount(bd, accountInput);
    expect(fake.sent).toHaveLength(1);
    const [req] = fake.sent;
    expect(req.url).toBe("https://acct.example.com/hook");
    expect(req.headers["X-Konnector-Webhook-Event"]).toBe("account.created");
    expect(verify(req.body, req.headers["X-Konnector-Signature"], secret)).toEqual({ ok: true });
    expect(verify(req.body, req.headers["X-Konnector-Signature"], "whsec_wrong")).toMatchObject({ ok: false });
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({
      event: "account.created",
      created_at: NOW.toISOString(),
      data: { account: { id: acc.id, name: acc.name } },
    });
    expect(body.id).toBe(req.headers["X-Konnector-Webhook-Id"]);
    const [d] = await listDeliveries(admin);
    expect(d).toMatchObject({ subscription_id: subscription.id, status: "delivered", attempts: 1, response_status: 200 });
  });

  it("skips inactive subscriptions and subscriptions for other events", async () => {
    const admin = await asUser("admin");
    const a = await createSubscription(admin, { url: "https://a.example.com", events: ["account.created"] });
    await createSubscription(admin, { url: "https://b.example.com", events: ["opportunity.created"] });
    await updateSubscription(admin, a.subscription.id, { active: false });
    await createAccount(admin, accountInput);
    expect(fake.sent).toHaveLength(0);
    expect(admin.store.raw("webhook_deliveries")).toHaveLength(0);
    await updateSubscription(admin, a.subscription.id, { active: true });
    await createAccount(admin, { ...accountInput, name: "Second Co" });
    expect(fake.sent.map((s) => s.url)).toEqual(["https://a.example.com"]);
  });

  it("retries with the outbox backoff and fails fast on 4xx", async () => {
    const admin = await asUser("admin");
    await createSubscription(admin, { url: "https://flaky.example.com", events: ["account.created"] });
    fake.queue.push({ ok: false, status: 503, error: "busy" });
    await createAccount(admin, accountInput);
    let [d] = admin.store.raw("webhook_deliveries");
    expect(d).toMatchObject({ status: "pending", attempts: 1, response_status: 503 });
    expect(d.next_attempt_at).toBe(new Date(NOW.getTime() + backoffMs(1)).toISOString());
    expect(d.last_error).toMatch(/HTTP 503/);

    // Not due yet.
    expect(await retryDueWebhooks({ ...admin, now: new Date(NOW.getTime() + 30_000) })).toHaveLength(0);
    // Due: fails again → backoff doubles.
    fake.queue.push(new Error("ECONNRESET"));
    const t1 = new Date(NOW.getTime() + backoffMs(1));
    await retryDueWebhooks({ ...admin, now: t1 });
    [d] = admin.store.raw("webhook_deliveries");
    expect(d).toMatchObject({ status: "pending", attempts: 2, response_status: null });
    expect(d.last_error).toMatch(/Network error: ECONNRESET/);
    expect(d.next_attempt_at).toBe(new Date(t1.getTime() + backoffMs(2)).toISOString());
    // Then succeeds.
    await retryDueWebhooks({ ...admin, now: new Date(t1.getTime() + backoffMs(2)) });
    [d] = admin.store.raw("webhook_deliveries");
    expect(d).toMatchObject({ status: "delivered", attempts: 3, next_attempt_at: null, last_error: null });

    // A 4xx is permanent.
    fake.queue.push({ ok: false, status: 410, error: "gone" });
    await createAccount(admin, { ...accountInput, name: "Gone Co" });
    const gone = admin.store.raw("webhook_deliveries").find((x) => x.status !== "delivered")!;
    expect(gone).toMatchObject({ status: "failed", attempts: 1, next_attempt_at: null });
  });

  it(`gives up after ${MAX_ATTEMPTS} attempts; admin Retry re-sends`, async () => {
    const admin = await asUser("admin");
    await createSubscription(admin, { url: "https://down.example.com", events: ["account.created"] });
    for (let i = 0; i < MAX_ATTEMPTS; i++) fake.queue.push({ ok: false, status: 500 });
    await createAccount(admin, accountInput);
    for (let i = 1; i < MAX_ATTEMPTS; i++) await retryDueWebhooks(admin, undefined, true);
    const [d] = admin.store.raw("webhook_deliveries");
    expect(d).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(await retryDueWebhooks(admin, undefined, true)).toHaveLength(0);
    expect(await retryDelivery(admin, d.id)).toMatchObject({ status: "delivered", attempts: MAX_ATTEMPTS + 1 });
    await expect(retryDelivery(await switchUser(admin, "exec"), d.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never throws into the caller when the receiver is down", async () => {
    const admin = await asUser("admin");
    await createSubscription(admin, { url: "https://down.example.com", events: ["account.created", "account.updated"] });
    setWebhookTransport(async () => {
      throw new Error("boom");
    });
    const acc = await createAccount(admin, accountInput);
    expect(acc.id).toBeTruthy();
    await expect(updateAccount(admin, acc.id, { tier: "A" })).resolves.toMatchObject({ tier: "A" });
    expect(admin.store.raw("webhook_deliveries").every((d) => d.status === "pending" && /boom/.test(d.last_error ?? ""))).toBe(true);
    // Even a store failure is swallowed.
    const broken = {
      ...admin,
      store: { ...admin.store, list: async () => Promise.reject(new Error("db down")) },
    } as unknown as typeof admin;
    await expect(emitEvent(broken, "account.created", { account: {} })).resolves.toEqual([]);
  });

  it("refuses payloads with cost-side fields, and real events carry none", async () => {
    const admin = await asUser("admin");
    await createSubscription(admin, { url: "https://all.example.com", events: [...WEBHOOK_EVENTS] });
    expect(await emitEvent(admin, "quote.status_changed", { quote: { id: "q", lines: [{ unit_cost: 1 }] } })).toEqual([]);
    expect(fake.sent).toHaveLength(0);

    // Drive real flows: account, opportunity, stage change, quote approval.
    const acc = await createAccount(admin, accountInput);
    await updateAccount(admin, acc.id, { tier: "A" });
    const o = await createOpportunity(admin, {
      name: "Water billing modernisation",
      account_id: acc.id,
      kind: "private_deal",
      value: 250_000,
      source: "inbound",
      service_lines: ["implementation"],
    });
    await moveStage(admin, o.id, { to: "qualify" });
    const exec = await switchUser(admin, "exec");
    await approveQuote(exec, ids.quote("peach-staff"), true);

    const events = fake.sent.map((s) => s.headers["X-Konnector-Webhook-Event"]);
    expect(events).toEqual([
      "account.created",
      "account.updated",
      "opportunity.created",
      "opportunity.stage_changed",
      "quote.status_changed",
    ]);
    for (const s of fake.sent) expect(findForbiddenKeys(JSON.parse(s.body))).toEqual([]);
    expect(JSON.parse(fake.sent[1].body).data.changed).toEqual(["tier"]);
    expect(JSON.parse(fake.sent[3].body).data).toMatchObject({ previous_stage: "signal", opportunity: { stage: "qualify" } });
    expect(JSON.parse(fake.sent[4].body).data).toMatchObject({ previous_status: "pending_approval", quote: { status: "approved" } });
    expect(fake.sent.some((s) => /internal_notes|unit_cost|margin/.test(s.body))).toBe(false);
  });

  it("sends a flagged test event, even to a paused subscription", async () => {
    const admin = await asUser("admin");
    const { subscription, secret } = await createSubscription(admin, { url: "https://t.example.com", events: ["handoff.acknowledged"] });
    await updateSubscription(admin, subscription.id, { active: false });
    const d = await sendTestEvent(admin, subscription.id);
    expect(d.status).toBe("delivered");
    const body = JSON.parse(fake.sent[0].body);
    expect(body).toMatchObject({ event: "handoff.acknowledged", test: true, data: { subscription_id: subscription.id } });
    expect(verify(fake.sent[0].body, fake.sent[0].headers["X-Konnector-Signature"], secret).ok).toBe(true);
    await expect(sendTestEvent(await switchUser(admin, "bd1"), subscription.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
