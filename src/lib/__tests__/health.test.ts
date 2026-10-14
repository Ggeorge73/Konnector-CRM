import { describe, expect, it } from "vitest";
import { httpStatusFor, runHealth, withTimeout, type HealthDeps } from "@/lib/server/health";

const never = () => new Promise<never>(() => {});
const deps = (over: Partial<HealthDeps> = {}): HealthDeps => ({
  pingDatabase: async () => {},
  probeKonnectHub: async () => 200,
  version: "1.2.3",
  commit: "abc1234",
  timeoutMs: 50,
  ...over,
});

describe("health checks", () => {
  it("is ok when every check passes", async () => {
    const r = await runHealth(deps());
    expect(r.status).toBe("ok");
    expect(r.checks.database).toMatchObject({ status: "ok" });
    expect(r.checks.konnectHub).toMatchObject({ status: "ok" });
    expect(r.checks.version).toEqual({ status: "ok", version: "1.2.3", commit: "abc1234" });
    expect(httpStatusFor(r)).toBe(200);
  });

  it("reports mock when the built-in Konnect Hub mock is in use", async () => {
    const r = await runHealth(deps({ probeKonnectHub: async () => "mock" }));
    expect(r.status).toBe("ok");
    expect(r.checks.konnectHub.status).toBe("mock");
  });

  it("is down with HTTP 503 when the database fails, without leaking the error", async () => {
    const r = await runHealth(
      deps({
        pingDatabase: async () => {
          throw new Error("connect ECONNREFUSED db.internal.konnector:5432 password=hunter2");
        },
      }),
    );
    expect(r.status).toBe("down");
    expect(r.checks.database).toMatchObject({ status: "down", reason: "error" });
    expect(httpStatusFor(r)).toBe(503);
    const body = JSON.stringify(r);
    expect(body).not.toMatch(/db\.internal|hunter2|ECONNREFUSED/);
  });

  it("is degraded (HTTP 200) when Konnect Hub is unreachable", async () => {
    const r = await runHealth(
      deps({
        probeKonnectHub: async () => {
          throw new Error("getaddrinfo ENOTFOUND hub.internal");
        },
      }),
    );
    expect(r.status).toBe("degraded");
    expect(r.checks.konnectHub).toMatchObject({ status: "unreachable", reason: "error" });
    expect(httpStatusFor(r)).toBe(200);
    expect(JSON.stringify(r)).not.toContain("hub.internal");
  });

  it("treats a 5xx from Konnect Hub as unreachable but a 404 as reachable", async () => {
    expect((await runHealth(deps({ probeKonnectHub: async () => 502 }))).checks.konnectHub).toMatchObject({
      status: "unreachable",
      reason: "http_5xx",
    });
    expect((await runHealth(deps({ probeKonnectHub: async () => 404 }))).checks.konnectHub.status).toBe("ok");
  });

  it("is degraded when Konnect Hub is not configured and not mocked", async () => {
    const r = await runHealth(deps({ probeKonnectHub: async () => "not_configured" }));
    expect(r.status).toBe("degraded");
    expect(r.checks.konnectHub.reason).toBe("not_configured");
  });

  it("times out a hanging database check and reports down", async () => {
    const started = Date.now();
    const r = await runHealth(deps({ pingDatabase: never }));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.status).toBe("down");
    expect(r.checks.database).toMatchObject({ status: "down", reason: "timeout" });
  });

  it("times out a hanging Konnect Hub probe and reports degraded", async () => {
    const r = await runHealth(deps({ probeKonnectHub: never }));
    expect(r.status).toBe("degraded");
    expect(r.checks.konnectHub).toMatchObject({ status: "unreachable", reason: "timeout" });
  });

  it("aborts the check's signal on timeout", async () => {
    let signal: AbortSignal | undefined;
    await expect(
      withTimeout((s) => {
        signal = s;
        return never();
      }, 10),
    ).rejects.toThrow("timeout");
    expect(signal?.aborted).toBe(true);
  });
});
