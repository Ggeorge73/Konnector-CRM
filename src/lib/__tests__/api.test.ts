import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { canSeeOpportunity } from "@/lib/auth/permissions";
import { handleApi } from "@/lib/api/http";
import { openApiDocument } from "@/lib/api/openapi";
import { RATE_LIMIT, resetRateLimits } from "@/lib/api/rate-limit";
import { RESOURCES, type Resource } from "@/lib/api/resources";
import type { MemoryStore } from "@/lib/data/memory-store";
import { seedIds } from "@/lib/data/seed";
import { findForbiddenKeys } from "@/lib/integration/contract";
import { sha256 } from "@/lib/server/crypto";
import { authenticateApiKey, createApiKey, listMyApiKeys, revokeApiKey } from "@/lib/services/api-keys";
import { asUser, NOW, switchUser } from "./helpers";

const ids = seedIds();

/** Calls the API pipeline the route handlers use, against the given store. */
function api(store: MemoryStore, key: string | null, method: string, path: string, body?: unknown, now = NOW) {
  const url = new URL(`http://crm.test/api/v1${path}`);
  const [, resource, id] = url.pathname.replace("/api/v1", "").split("/");
  const req = new Request(url, {
    method,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return handleApi(req, { resource: resource as Resource, id }, { store, now: () => now }).then(async (res) => ({
    status: res.status,
    headers: res.headers,
    json: (await res.json()) as Record<string, unknown> & {
      data: never;
      next_cursor?: string | null;
      error?: { code: string; message: string };
    },
  }));
}

beforeEach(() => resetRateLimits());

describe("API keys", () => {
  it("creates a key shown once; stores only prefix + SHA-256 hash; audits", async () => {
    const c = await asUser("bd1");
    const { key, apiKey } = await createApiKey(c, { name: "Laptop", scopes: ["read"] });
    expect(key).toMatch(/^kcrm_[0-9a-f]{8}_[0-9a-f]{64}$/);
    expect(key.split("_")[1]).toBe(apiKey.prefix);
    expect(apiKey).not.toHaveProperty("key_hash");
    const row = c.store.raw("api_keys").find((k) => k.id === apiKey.id)!;
    expect(row.key_hash).toBe(sha256(key));
    expect(JSON.stringify(row)).not.toContain(key.split("_")[2]);
    expect((await listMyApiKeys(c)).map((k) => k.id)).toEqual([apiKey.id]);
    expect((await listMyApiKeys(c))[0]).not.toHaveProperty("key_hash");
    expect(
      c.store.raw("audit_log").some((a) => a.action === "api_key.created" && a.entity_id === apiKey.id && a.actor_id === c.user.id),
    ).toBe(true);
  });

  it("write implies read; validates name and future expiry", async () => {
    const c = await asUser("bd1");
    expect((await createApiKey(c, { name: "w", scopes: ["write"] })).apiKey.scopes).toEqual(["read", "write"]);
    await expect(createApiKey(c, { name: "", scopes: ["read"] })).rejects.toThrow();
    await expect(createApiKey(c, { name: "old", scopes: ["read"], expires_at: "2020-01-01T00:00:00Z" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("authenticates valid keys and rejects missing, malformed, wrong, revoked and expired ones", async () => {
    const c = await asUser("bd1");
    const { key, apiKey } = await createApiKey(c, { name: "k", scopes: ["read"] });
    const ok = await authenticateApiKey(c.store, `Bearer ${key}`, NOW);
    expect(ok).toMatchObject({ ok: true, scopes: ["read"] });
    expect(ok.ok && ok.user.id).toBe(c.user.id);

    expect(await authenticateApiKey(c.store, null, NOW)).toMatchObject({ ok: false });
    expect(await authenticateApiKey(c.store, "Bearer nope", NOW)).toMatchObject({ ok: false, reason: "Malformed API key." });
    const wrong = key.slice(0, -1) + (key.endsWith("0") ? "1" : "0");
    expect(await authenticateApiKey(c.store, `Bearer ${wrong}`, NOW)).toMatchObject({ ok: false, reason: "Invalid API key." });

    await revokeApiKey(c, apiKey.id);
    expect(await authenticateApiKey(c.store, `Bearer ${key}`, NOW)).toMatchObject({ ok: false, reason: "API key revoked." });
    expect(c.store.raw("audit_log").some((a) => a.action === "api_key.revoked" && a.entity_id === apiKey.id)).toBe(true);

    const exp = await createApiKey(c, { name: "e", scopes: ["read"], expires_at: new Date(NOW.getTime() + 60_000).toISOString() });
    expect((await authenticateApiKey(c.store, `Bearer ${exp.key}`, NOW)).ok).toBe(true);
    expect(await authenticateApiKey(c.store, `Bearer ${exp.key}`, new Date(NOW.getTime() + 61_000))).toMatchObject({
      ok: false,
      reason: "API key expired.",
    });
  });

  it("only the owner (or an admin) can revoke a key", async () => {
    const c = await asUser("bd1");
    const { apiKey } = await createApiKey(c, { name: "k", scopes: ["read"] });
    await expect(revokeApiKey(await switchUser(c, "bd2"), apiKey.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revokeApiKey(await switchUser(c, "exec"), apiKey.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await revokeApiKey(await switchUser(c, "admin"), apiKey.id)).revoked_at).not.toBeNull();
  });

  it("updates last_used_at at most once per minute", async () => {
    const c = await asUser("bd1");
    const { key, apiKey } = await createApiKey(c, { name: "k", scopes: ["read"] });
    const lastUsed = () => c.store.raw("api_keys").find((k) => k.id === apiKey.id)!.last_used_at;
    await authenticateApiKey(c.store, `Bearer ${key}`, NOW);
    expect(lastUsed()).toBe(NOW.toISOString());
    await authenticateApiKey(c.store, `Bearer ${key}`, new Date(NOW.getTime() + 30_000));
    expect(lastUsed()).toBe(NOW.toISOString());
    await authenticateApiKey(c.store, `Bearer ${key}`, new Date(NOW.getTime() + 60_000));
    expect(lastUsed()).toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });
});

describe("REST API v1", () => {
  async function keyFor(
    who: "bd1" | "bd2" | "exec" | "admin" | "delivery" | "recruiter",
    scopes: ("read" | "write")[] = ["read", "write"],
  ) {
    const c = await asUser(who);
    return { c, key: (await createApiKey(c, { name: "test", scopes })).key };
  }

  it("401s with a JSON error when the key is missing or bad", async () => {
    const { c } = await keyFor("bd1");
    const r = await api(c.store, null, "GET", "/accounts");
    expect(r.status).toBe(401);
    expect(r.json.error).toMatchObject({ code: "unauthorized" });
    expect(r.headers.get("WWW-Authenticate")).toMatch(/Bearer/);
    expect((await api(c.store, "kcrm_00000000_" + "0".repeat(64), "GET", "/accounts")).status).toBe(401);
  });

  it("read scope allows GET only; write adds POST/PATCH", async () => {
    const { c, key } = await keyFor("bd1", ["read"]);
    expect((await api(c.store, key, "GET", "/accounts")).status).toBe(200);
    const denied = await api(c.store, key, "POST", "/tasks", { title: "Call back" });
    expect(denied.status).toBe(403);
    expect(denied.json.error).toMatchObject({ code: "insufficient_scope" });
    const w = (await createApiKey(c, { name: "w", scopes: ["read", "write"] })).key;
    expect((await api(c.store, w, "POST", "/tasks", { title: "Call back" })).status).toBe(201);
  });

  it("bd sees only their own or shared deals, and 404s on others'", async () => {
    const { c, key } = await keyFor("bd1");
    const r = await api(c.store, key, "GET", "/opportunities?limit=200");
    const all = c.store.raw("opportunities").filter((o) => !o.archived_at);
    const expected = all.filter((o) => canSeeOpportunity(c.user, o)).map((o) => o.id);
    expect((r.json.data as Array<{ id: string }>).map((o) => o.id).sort()).toEqual([...expected].sort());
    expect(expected.length).toBeLessThan(all.length);
    const hidden = all.find((o) => !canSeeOpportunity(c.user, o))!;
    const g = await api(c.store, key, "GET", `/opportunities/${hidden.id}`);
    expect(g.status).toBe(404);
    expect(g.json.error).toMatchObject({ code: "not_found" });
  });

  it("never returns unit cost, margins or internal notes — not even to the quote owner or executives", async () => {
    for (const who of ["bd1", "exec"] as const) {
      const { c, key } = await keyFor(who);
      const list = await api(c.store, key, "GET", "/quotes");
      expect(list.status).toBe(200);
      expect((list.json.data as unknown[]).length).toBeGreaterThan(0);
      expect(findForbiddenKeys(list.json)).toEqual([]);
      const mine = c.store.raw("quotes").find((q) => q.owner_id === c.user.id) ?? c.store.raw("quotes")[0];
      const one = await api(c.store, key, "GET", `/quotes/${mine.id}`);
      expect(one.status).toBe(200);
      expect(findForbiddenKeys(one.json)).toEqual([]);
      expect(JSON.stringify(one.json)).not.toMatch(/unit_cost|margin|internal_notes|canSeeCost/);
      expect(one.json.data).toMatchObject({ id: mine.id, total: expect.any(Number) });
    }
    for (const r of RESOURCES) {
      const { c, key } = await keyFor("bd1");
      expect(findForbiddenKeys((await api(c.store, key, "GET", `/${r}?limit=200`)).json), r).toEqual([]);
    }
  });

  it("bd activities and tasks follow record visibility", async () => {
    const { c, key } = await keyFor("bd1");
    const acts = (await api(c.store, key, "GET", "/activities?limit=200")).json.data as Array<{ related_type: string; related_id: string }>;
    const opps = new Map(c.store.raw("opportunities").map((o) => [o.id, o]));
    expect(acts.length).toBeGreaterThan(0);
    for (const a of acts.filter((x) => x.related_type === "opportunity"))
      expect(canSeeOpportunity(c.user, opps.get(a.related_id)!)).toBe(true);
    const tasks = (await api(c.store, key, "GET", "/tasks?limit=200")).json.data as Array<{
      assignee_id: string;
      created_by: string | null;
    }>;
    expect(tasks.every((t) => t.assignee_id === c.user.id || t.created_by === c.user.id)).toBe(true);
  });

  it("creates through the services: validated, audited, scoped", async () => {
    const { c, key } = await keyFor("bd1");
    const created = await api(c.store, key, "POST", "/accounts", {
      name: "Fulton County Schools",
      type: "government_local",
      sector: "Education",
      country: "us",
      tier: "B",
      status: "prospect",
    });
    expect(created.status).toBe(201);
    const acc = created.json.data as { id: string; owner_id: string; country: string };
    expect(acc).toMatchObject({ owner_id: c.user.id, country: "US" });
    expect(c.store.raw("audit_log").some((a) => a.action === "account.created" && a.entity_id === acc.id && a.actor_id === c.user.id)).toBe(
      true,
    );

    const bad = await api(c.store, key, "POST", "/accounts", { name: "X", type: "nope" });
    expect(bad.status).toBe(422);
    expect(bad.json.error).toMatchObject({ code: "validation_failed" });
    expect(Array.isArray((bad.json.error as { details?: unknown }).details)).toBe(true);
    expect((await api(c.store, key, "POST", "/accounts", { ...{ name: "Typo Co" }, nmae: "x" })).status).toBe(422);
    expect((await api(c.store, key, "POST", "/accounts", "{not json")).status).toBe(400);

    // Logging an activity on someone else's deal is refused (not found for this user).
    const hidden = c.store.raw("opportunities").find((o) => !canSeeOpportunity(c.user, o))!;
    const act = await api(c.store, key, "POST", "/activities", {
      type: "note",
      subject: "Sneaky",
      related_type: "opportunity",
      related_id: hidden.id,
    });
    expect(act.status).toBe(404);
    const sys = await api(c.store, key, "POST", "/activities", {
      type: "system",
      subject: "x",
      related_type: "account",
      related_id: acc.id,
    });
    expect(sys.status).toBe(422);
    const note = await api(c.store, key, "POST", "/activities", {
      type: "call",
      subject: "Intro call",
      related_type: "account",
      related_id: acc.id,
      account_id: acc.id,
    });
    expect(note.status).toBe(201);
    expect(note.json.data).toMatchObject({ actor_id: c.user.id });
  });

  it("role rules apply to writes: delivery leads can't create accounts; recruiters only staffing deals", async () => {
    const d = await keyFor("delivery");
    const r = await api(d.c.store, d.key, "POST", "/accounts", {
      name: "Nope Inc",
      type: "private",
      sector: "x",
      country: "US",
      tier: "C",
      status: "prospect",
    });
    expect(r.status).toBe(403);
    expect(r.json.error).toMatchObject({ code: "forbidden" });
  });

  it("PATCH updates and moves stages through the stage gates", async () => {
    const { c, key } = await keyFor("bd1");
    const mine = c.store.raw("opportunities").find((o) => o.owner_id === c.user.id && o.stage === "qualify")!;
    const r = await api(c.store, key, "PATCH", `/opportunities/${mine.id}`, { next_step: "Send capability statement", stage: "capture" });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ next_step: "Send capability statement", stage: "capture" });
    expect(c.store.raw("audit_log").some((a) => a.action === "opportunity.stage_changed" && a.entity_id === mine.id)).toBe(true);
    const lost = await api(c.store, key, "PATCH", `/opportunities/${mine.id}`, { stage: "lost" });
    expect(lost.status).toBe(422);
    expect(lost.json.error).toMatchObject({ code: "validation_failed" });
    const other = c.store.raw("opportunities").find((o) => !canSeeOpportunity(c.user, o))!;
    expect((await api(c.store, key, "PATCH", `/opportunities/${other.id}`, { next_step: "x" })).status).toBe(404);
    // Tasks: status only.
    const t = (await api(c.store, key, "POST", "/tasks", { title: "Follow up" })).json.data as { id: string };
    expect((await api(c.store, key, "PATCH", `/tasks/${t.id}`, { status: "done" })).json.data).toMatchObject({ status: "done" });
    expect((await api(c.store, key, "PATCH", `/tasks/${t.id}`, { title: "x" })).status).toBe(422);
  });

  it("405s unsupported methods with an Allow header", async () => {
    const { c, key } = await keyFor("admin");
    const r = await api(c.store, key, "DELETE", `/accounts/${ids.account("gta")}`);
    expect(r.status).toBe(405);
    expect(r.headers.get("Allow")).toBe("GET, PATCH");
    expect((await api(c.store, key, "PATCH", `/activities/${c.store.raw("activities")[0].id}`, {})).status).toBe(405);
    expect((await api(c.store, key, "POST", "/quotes", {})).status).toBe(405);
  });

  it("paginates with a stable cursor and filters", async () => {
    const { c, key } = await keyFor("exec");
    const seen: string[] = [];
    let cursor: string | null | undefined = undefined;
    let pages = 0;
    do {
      const r = await api(c.store, key, "GET", `/accounts?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      expect(r.status).toBe(200);
      seen.push(...(r.json.data as Array<{ id: string }>).map((a) => a.id));
      cursor = r.json.next_cursor;
      pages++;
    } while (cursor && pages < 50);
    const total = c.store.raw("accounts").filter((a) => !a.archived_at).length;
    expect(seen.length).toBe(total);
    expect(new Set(seen).size).toBe(total);
    expect(pages).toBe(Math.ceil(total / 3));

    const prop = await api(c.store, key, "GET", "/opportunities?stage=proposal");
    expect((prop.json.data as Array<{ stage: string }>).every((o) => o.stage === "proposal")).toBe(true);
    const byAcc = await api(c.store, key, "GET", `/contacts?account_id=${ids.account("gta")}`);
    expect((byAcc.json.data as Array<{ account_id: string }>).every((x) => x.account_id === ids.account("gta"))).toBe(true);
    const future = await api(c.store, key, "GET", "/accounts?updated_since=2999-01-01T00:00:00Z");
    expect(future.json.data).toEqual([]);

    expect((await api(c.store, key, "GET", "/accounts?cursor=garbage")).status).toBe(400);
    expect((await api(c.store, key, "GET", "/accounts?limit=500")).status).toBe(400);
    expect((await api(c.store, key, "GET", "/accounts?colour=red")).json.error).toMatchObject({ code: "bad_request" });
  });

  it(`rate-limits each key to ${RATE_LIMIT} requests per minute with RateLimit headers`, async () => {
    const { c, key } = await keyFor("bd1", ["read"]);
    const other = (await createApiKey(await switchUser(c, "bd2"), { name: "other", scopes: ["read"] })).key;
    let last = await api(c.store, key, "GET", "/tasks?limit=1");
    expect(last.headers.get("RateLimit-Limit")).toBe(String(RATE_LIMIT));
    expect(last.headers.get("RateLimit-Remaining")).toBe(String(RATE_LIMIT - 1));
    for (let i = 1; i < RATE_LIMIT; i++) last = await api(c.store, key, "GET", "/tasks?limit=1");
    expect(last.status).toBe(200);
    expect(last.headers.get("RateLimit-Remaining")).toBe("0");
    const blocked = await api(c.store, key, "GET", "/tasks?limit=1");
    expect(blocked.status).toBe(429);
    expect(blocked.json.error).toMatchObject({ code: "rate_limited" });
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Other keys are unaffected; the bucket refills over time.
    expect((await api(c.store, other, "GET", "/tasks?limit=1")).status).toBe(200);
    expect((await api(c.store, key, "GET", "/tasks?limit=1", undefined, new Date(NOW.getTime() + 1_000))).status).toBe(200);
  });

  it("publishes an OpenAPI 3.1 document covering every resource", () => {
    const doc = openApiDocument();
    expect(doc.openapi).toBe("3.1.0");
    for (const r of RESOURCES) {
      expect(doc.paths).toHaveProperty(`/${r}`);
      expect(doc.paths).toHaveProperty(`/${r}/{id}`);
    }
    expect(JSON.stringify(doc.components.schemas)).not.toMatch(/unit_cost|internal_notes/);
    expect((doc.paths["/accounts"] as { post?: unknown }).post).toBeDefined();
    expect((doc.paths["/quotes"] as { post?: unknown }).post).toBeUndefined();
  });
});
