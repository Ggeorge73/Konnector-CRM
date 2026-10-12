import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { seedIds, sid } from "@/lib/data/seed";
import { findForbiddenKeys } from "@/lib/integration/contract";
import { inboundHandlers } from "@/lib/integration/handlers";
import { handleInbound } from "@/lib/integration/inbound";
import { mockKonnectHub } from "@/lib/integration/mock-konnect-hub";
import { ContractViolation, retryDue, send } from "@/lib/integration/outbox";
import { sign, verify } from "@/lib/integration/signing";
import { mockTransport } from "@/lib/integration/transport";
import { buildWonPayload, retryHandoff, startHandoff, type HandoffInputT } from "@/lib/services/handoff";
import { systemCtx } from "@/lib/services/system";
import { asUser, NOW, switchUser } from "./helpers";

const ids = seedIds();
const SECRET = "dev-only-shared-secret";
const input = (overrides: Partial<HandoffInputT> = {}): HandoffInputT => ({
  contract_no: "PHP-2026-044",
  contract_value: 980000,
  start_date: "2026-11-01",
  end_date: "2027-10-31",
  delivery_lead_id: ids.users.delivery,
  client_contacts: [{ contact_id: sid("contact:hannah.brooks"), role: "client_admin" }],
  scope_summary: "Integrate the EHR with the regional data platform and patient portal.",
  acceptance_criteria: ["HL7 FHIR interfaces live for 3 facilities", "Data latency under 5 minutes"],
  document_file_ids: [],
  ...overrides,
});

beforeEach(() => mockKonnectHub.reset());

describe("signing", () => {
  it("signs and verifies with timestamp and rejects tampering, staleness and wrong secrets", () => {
    const t = NOW.getTime();
    const s = sign('{"a":1}', SECRET, t);
    expect(verify('{"a":1}', s, SECRET, t)).toEqual({ ok: true });
    expect(verify('{"a":2}', s, SECRET, t)).toMatchObject({ ok: false, reason: "bad signature" });
    expect(verify('{"a":1}', s, "other", t)).toMatchObject({ ok: false });
    expect(verify('{"a":1}', s, SECRET, t + 6 * 60_000)).toMatchObject({ ok: false, reason: "stale signature" });
    expect(verify('{"a":1}', null, SECRET, t)).toMatchObject({ ok: false, reason: "missing signature" });
  });
});

describe("handoff (Won → Konnect Hub)", () => {
  it("builds a strict, client-facing payload", async () => {
    const d = await asUser("delivery");
    const p = await buildWonPayload(d, ids.opp("peach-ehr"), input(), "key-1");
    expect(p.event).toBe("opportunity.won");
    expect(p.version).toBe("1");
    expect(p.client_contacts).toEqual([{ name: "Hannah Brooks", email: "hannah.brooks@peachtree.example.com", role: "client_admin" }]);
    expect(findForbiddenKeys(p)).toEqual([]);
    await expect(
      buildWonPayload(
        d,
        ids.opp("peach-ehr"),
        input({ client_contacts: [{ contact_id: sid("contact:denise.walker"), role: "client_admin" }] }),
        "k",
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(buildWonPayload(d, ids.opp("peach-ehr"), input({ end_date: "2026-01-01" }), "k")).rejects.toThrow(/after the start/);
  });

  it("creates the project, links the account, and is idempotent", async () => {
    const d = await asUser("delivery");
    const h = await startHandoff(d, ids.opp("peach-ehr"), input(), mockTransport);
    expect(h.status).toBe("acknowledged");
    expect(h.konnect_hub_project_id).toMatch(/^khp_/);
    expect(h.konnect_hub_url).toContain(h.konnect_hub_project_id!);
    const acc = await d.store.get("accounts", ids.account("peachtree"));
    expect(acc!.konnect_hub_client_id).toMatch(/^khc_/);
    expect(mockKonnectHub.received()).toHaveLength(1);
    await expect(startHandoff(d, ids.opp("peach-ehr"), input(), mockTransport)).rejects.toThrow(/already been handed off/);
    const timeline = await d.store.list("activities", { where: { related_id: ids.opp("peach-ehr"), type: "handoff" } });
    expect(timeline).toHaveLength(1);
  });

  it("retries with backoff after Konnect Hub is unavailable", async () => {
    const d = await asUser("delivery");
    mockKonnectHub.failNext(2);
    const h1 = await startHandoff(d, ids.opp("peach-ehr"), input(), mockTransport);
    expect(h1.status).toBe("sent");
    expect(h1.attempts).toBe(1);
    expect(h1.last_error).toMatch(/503/);
    expect(h1.next_attempt_at).toBeTruthy();
    const h2 = await retryHandoff(d, h1.id, mockTransport);
    expect(h2.attempts).toBe(2);
    expect(h2.status).toBe("sent");
    // Cron pass before backoff elapses does nothing; after it, delivery succeeds once.
    const sys = await systemCtx(d.store, NOW);
    expect(await retryDue(sys, mockTransport)).toHaveLength(0);
    const later = await systemCtx(d.store, new Date(NOW.getTime() + 60 * 60_000));
    const out = await retryDue(later, mockTransport);
    expect(out[0].status).toBe("delivered");
    expect(mockKonnectHub.received()).toHaveLength(1);
  });

  it("only delivery leads and executives can hand off, and only won deals", async () => {
    const bd = await asUser("bd2");
    await expect(startHandoff(bd, ids.opp("peach-ehr"), input(), mockTransport)).rejects.toBeInstanceOf(ForbiddenError);
    const d = await switchUser(bd, "delivery");
    await expect(startHandoff(d, ids.opp("dor-mvs"), input(), mockTransport)).rejects.toThrow(/Only won/);
  });

  it("refuses to send payloads that contain internal fields", async () => {
    const d = await asUser("delivery");
    await expect(
      send(d, "client_item.published", { item: { lines: [{ item: "x", unit_cost: 5 }] } }, "k", mockTransport),
    ).rejects.toBeInstanceOf(ContractViolation);
    expect(findForbiddenKeys({ a: [{ b: { margin_pct: 1 } }], internal_notes: "x" })).toEqual(["$.a[0].b.margin_pct", "$.internal_notes"]);
  });
});

describe("inbound project.health_updated", () => {
  const health = (over: Record<string, unknown> = {}) => ({
    event: "project.health_updated",
    konnect_hub_project_id: "khp_atl311",
    health_schedule: "green",
    health_budget: "red",
    health_acceptance: "amber",
    percent_complete: 70,
    status: "in_progress",
    updated_at: new Date(NOW.getTime() + 1000).toISOString(),
    ...over,
  });
  const post = async (c: Awaited<ReturnType<typeof systemCtx>>, payload: object, secret = SECRET) => {
    const body = JSON.stringify(payload);
    return handleInbound(c, body, sign(body, secret, c.now.getTime()), SECRET, inboundHandlers);
  };

  it("verifies, applies, alerts the owner on red, and de-duplicates", async () => {
    const d = await asUser("admin");
    const sys = await systemCtx(d.store, NOW);
    expect((await post(sys, health(), "wrong")).status).toBe(401);
    const r = await post(sys, health());
    expect(r.status).toBe(200);
    const [row] = await d.store.list("project_health", { where: { konnect_hub_project_id: "khp_atl311" } });
    expect(row).toMatchObject({ health_budget: "red", percent_complete: 70 });
    const alerts = await d.store.list("notifications", { where: { user_id: ids.users.bd2, kind: "alert" } });
    expect(alerts.length).toBe(1);
    expect((await post(sys, health())).body).toMatchObject({ idempotent_replay: true });
    expect((await post(sys, health({ updated_at: new Date(NOW.getTime() - 86400000).toISOString() }))).body).toMatchObject({
      ignored: "stale update",
    });
    expect((await post(sys, { event: "project.health_updated", konnect_hub_project_id: "x" })).status).toBe(422);
    const logged = await d.store.list("integration_events", { where: { direction: "inbound" } });
    expect(logged.length).toBeGreaterThanOrEqual(2);
  });
});
