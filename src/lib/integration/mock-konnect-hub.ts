/**
 * Mock Konnect Hub (dev/test flag MOCK_KONNECT_HUB). Behaves like the real integration API from
 * docs/kit/KONNECT_HUB_ADDON_PROMPT.md: verifies signatures, is idempotent, creates clients and
 * projects on handoff, stores published client items, and can simulate client/portal activity by
 * sending signed events back to the CRM's inbound webhook.
 */
import { env } from "@/config/app";
import {
  OpportunityWonPayload,
  ClientItemPublishedPayload,
  ClientItemWithdrawnPayload,
  ProjectExtendedPayload,
  findForbiddenKeys,
} from "./contract";
import { sign, verify } from "./signing";
import type { TransportResult } from "./transport";

interface MockState {
  seen: Map<string, Record<string, unknown>>;
  clients: Map<string, { id: string; name: string }>;
  projects: Map<string, { id: string; client_id: string; name: string; end_date: string; value: number }>;
  items: Map<string, { item_id: string; version: number; status: "open" | "withdrawn"; payload: Record<string, unknown> }>;
  failNext: number;
  received: Array<{ event: string; payload: Record<string, unknown> }>;
}

const g = globalThis as unknown as { __kcrmMockHub?: MockState };
const state = (): MockState =>
  (g.__kcrmMockHub ??= { seen: new Map(), clients: new Map(), projects: new Map(), items: new Map(), failNext: 0, received: [] });

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 10);

export const mockKonnectHub = {
  reset() {
    g.__kcrmMockHub = undefined;
  },
  /** Make the next N deliveries fail with 503 (to exercise retries). */
  failNext(n: number) {
    state().failNext = n;
  },
  received() {
    return state().received;
  },

  async receive(event: string, body: string, signature: string): Promise<TransportResult> {
    const s = state();
    const v = verify(body, signature, env.integrationSecret);
    if (!v.ok) return { ok: false, status: 401, body: { error: v.reason } };
    if (s.failNext > 0) {
      s.failNext -= 1;
      return { ok: false, status: 503, body: { error: "Konnect Hub temporarily unavailable" } };
    }
    const raw = JSON.parse(body) as Record<string, unknown>;
    // The Hub rejects anything outside the contract — including internal fields.
    if (findForbiddenKeys(raw).length) return { ok: false, status: 422, body: { error: "payload contains fields outside the contract" } };
    const key = String(raw.idempotency_key ?? "");
    if (key && s.seen.has(key)) return { ok: true, status: 200, body: { ...s.seen.get(key)!, idempotent_replay: true } };
    s.received.push({ event, payload: raw });

    let result: Record<string, unknown> = { ok: true };
    if (event === "opportunity.won") {
      const p = OpportunityWonPayload.safeParse(raw);
      if (!p.success) return { ok: false, status: 422, body: { error: p.error.issues[0]?.message ?? "invalid payload" } };
      const clientId = p.data.account.konnect_hub_client_id ?? `khc_${slug(p.data.account.name)}`;
      s.clients.set(clientId, { id: clientId, name: p.data.account.name });
      const projectId = `khp_${slug(p.data.project.name)}${s.projects.size + 1}`;
      s.projects.set(projectId, {
        id: projectId,
        client_id: clientId,
        name: p.data.project.name,
        end_date: p.data.project.end_date,
        value: p.data.project.value,
      });
      result = {
        konnect_hub_client_id: clientId,
        konnect_hub_project_id: projectId,
        project_url: `${env.konnectHubWebUrl}/projects/${projectId}`,
      };
    } else if (event === "project.extended") {
      const p = ProjectExtendedPayload.safeParse(raw);
      if (!p.success) return { ok: false, status: 422, body: { error: "invalid payload" } };
      const proj = s.projects.get(p.data.konnect_hub_project_id);
      if (proj && p.data.new_end_date) proj.end_date = p.data.new_end_date;
      result = { ok: true, change_entry: `Extended by CRM: ${p.data.reason}` };
    } else if (event === "client_item.published") {
      const p = ClientItemPublishedPayload.safeParse(raw);
      if (!p.success) return { ok: false, status: 422, body: { error: p.error.issues[0]?.message ?? "invalid payload" } };
      s.items.set(p.data.item.item_id, { item_id: p.data.item.item_id, version: p.data.item.version, status: "open", payload: raw });
      result = { ok: true, portal_url: `${env.konnectHubWebUrl}/portal/review/${p.data.item.item_id}` };
    } else if (event === "client_item.withdrawn") {
      const p = ClientItemWithdrawnPayload.safeParse(raw);
      if (!p.success) return { ok: false, status: 422, body: { error: "invalid payload" } };
      const it = s.items.get(p.data.item_id);
      if (it) it.status = "withdrawn";
    } else {
      return { ok: false, status: 400, body: { error: `unknown event ${event}` } };
    }
    if (key) s.seen.set(key, result);
    return { ok: true, status: 200, body: result };
  },

  /** Builds a signed inbound event as Konnect Hub would send it to the CRM. */
  signed(payload: Record<string, unknown>, t = Date.now()) {
    const body = JSON.stringify(payload);
    return { body, signature: sign(body, env.integrationSecret, t) };
  },
};
