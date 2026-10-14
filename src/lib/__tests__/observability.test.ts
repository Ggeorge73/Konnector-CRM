import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorPayload, logEvent, reportError, scrub, setReportFetch } from "@/lib/server/observability";

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  const capture = (s: unknown) => void lines.push(String(s));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
  setReportFetch(null);
  delete process.env.ERROR_WEBHOOK_URL;
});

describe("reportError", () => {
  it("emits one JSON line with only user id, route, message and stack", () => {
    const err = new Error("Quote total mismatch");
    const ctx = {
      source: "action",
      route: "/quotes/q1?token=abc",
      userId: "u-1",
      // Not part of ErrorContext — must be dropped even if a caller passes them.
      body: { notes: "secret plan" },
      email: "ceo@konnectorllc.com",
    };
    const { payload } = reportError(err, ctx as unknown as Parameters<typeof reportError>[1]);
    expect(lines).toHaveLength(1);
    const logged = JSON.parse(lines[0]);
    expect(logged).toEqual(payload);
    expect(Object.keys(logged).sort()).toEqual(["event", "level", "message", "name", "route", "source", "stack", "ts", "userId"]);
    expect(logged).toMatchObject({ level: "error", source: "action", route: "/quotes/q1", userId: "u-1", message: "Quote total mismatch" });
    expect(lines[0]).not.toMatch(/secret plan|ceo@|token=abc/);
  });

  it("scrubs emails, bearer tokens, API keys, JWTs and connection strings from message and stack", () => {
    const err = new Error(
      "duplicate key (email)=(jane.doe@agency.gov) auth=Bearer abc.def.ghi key kcrm_ab12_secretpart " +
        "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig db postgres://u:p@db.host:5432/x sk-ant-api03-abcdefghijklmnop",
    );
    err.stack = `Error: ${err.message}\n    at fn (file.ts:1:1)`;
    const p = errorPayload(err, { source: "t" });
    for (const s of [p.message, p.stack!]) {
      expect(s).not.toMatch(/jane\.doe@agency\.gov|abc\.def\.ghi|secretpart|eyJhbGci|u:p@db\.host|sk-ant-api03/);
      expect(s).toContain("[email]");
    }
  });

  it("handles non-Error throws and truncates long messages", () => {
    expect(errorPayload("boom", { source: "t" })).toMatchObject({ message: "boom", stack: null, name: "string" });
    expect(errorPayload(new Error("x".repeat(2000)), { source: "t" }).message.length).toBeLessThanOrEqual(501);
  });

  it("POSTs the redacted payload to ERROR_WEBHOOK_URL when set, and swallows sink failures", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://errors.example.com/hook";
    const fetchMock = vi.fn(async () => {
      throw new Error("sink down");
    });
    setReportFetch(fetchMock as unknown as typeof fetch);
    const { payload, sent } = reportError(new Error("fail for bob@example.com"), { source: "cron.daily", userId: "sys" });
    await expect(sent).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://errors.example.com/hook");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual(payload);
    expect(String(init.body)).not.toContain("bob@example.com");
  });

  it("does not call out when ERROR_WEBHOOK_URL is unset", async () => {
    const fetchMock = vi.fn();
    setReportFetch(fetchMock as unknown as typeof fetch);
    await reportError(new Error("x"), { source: "t" }).sent;
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("logEvent", () => {
  it("writes a JSON line, dropping content-like keys and scrubbing values", () => {
    logEvent("cron.daily.completed", {
      durationMs: 12,
      expired: 2,
      email: "a@b.co",
      requestBody: "{...}",
      note: "x",
      reason: "sent to a@b.co",
    });
    const l = JSON.parse(lines[0]);
    expect(l).toMatchObject({ level: "info", event: "cron.daily.completed", durationMs: 12, expired: 2, reason: "sent to [email]" });
    expect(l).not.toHaveProperty("email");
    expect(l).not.toHaveProperty("requestBody");
    expect(l).not.toHaveProperty("note");
  });

  it("cannot overwrite the event name or level", () => {
    logEvent("x.y", { event: "spoofed", level: "error" }, "warn");
    expect(JSON.parse(lines[0])).toMatchObject({ event: "x.y", level: "warn" });
  });
});

describe("scrub", () => {
  it("redacts sensitive query parameters", () => {
    expect(scrub("/cb?code=abc123&state=xyz&ok=1")).toBe("/cb?code=[redacted]&state=[redacted]&ok=1");
  });
});
