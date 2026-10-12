import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { seedIds } from "@/lib/data/seed";
import type { MailProvider } from "@/lib/domain/types";
import { pkceChallenge, pkceVerifier, ProviderError, signState, verifyState, type MailProviderClient } from "@/lib/mail";
import { buildMime, createGoogleClient, GOOGLE_SCOPES } from "@/lib/mail/google";
import { createMicrosoftClient } from "@/lib/mail/microsoft";
import { createMockClient, mockOutbox, resetMockOutbox } from "@/lib/mail/mock";
import { decrypt } from "@/lib/server/crypto";
import { timelineFor } from "@/lib/services/core";
import {
  disconnect,
  myConnections,
  saveConnection,
  sendFromRecord,
  syncAllActive,
  syncConnection,
  type MailDeps,
} from "@/lib/services/mail";
import { systemCtx } from "@/lib/services/system";
import gmailList from "./fixtures/mail/gmail-list.json";
import gmailMessage from "./fixtures/mail/gmail-message.json";
import googleEvents from "./fixtures/mail/google-events.json";
import googleToken from "./fixtures/mail/google-token.json";
import graphEvents from "./fixtures/mail/graph-events.json";
import graphMessages from "./fixtures/mail/graph-messages.json";
import msToken from "./fixtures/mail/ms-token.json";
import { asUser, NOW, switchUser } from "./helpers";

const ids = seedIds();

// ---------- a recording fetch ----------

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function fakeFetch(route: (url: string, init: RequestInit) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const f = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: init.body == null ? null : String(init.body),
    });
    const r = route(url, init);
    const status = r.status ?? 200;
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

const cfg = { clientId: "cid", clientSecret: "secret", redirectUri: "https://crm.example.com/api/oauth/google/callback" };

// ---------- Google ----------

describe("Google provider", () => {
  it("builds the consent URL with offline access, PKCE, state and login hint", () => {
    const g = createGoogleClient(cfg);
    const u = new URL(g.authUrl("STATE", { codeChallenge: "CHAL", loginHint: "marcus.bell@konnectorllc.com" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = u.searchParams;
    expect(q.get("client_id")).toBe("cid");
    expect(q.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("code_challenge")).toBe("CHAL");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("state")).toBe("STATE");
    expect(q.get("login_hint")).toBe("marcus.bell@konnectorllc.com");
    expect(q.get("scope")!.split(" ")).toEqual([...GOOGLE_SCOPES]);
  });

  it("exchanges the code (form body + verifier) and reads the email from the id_token", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: googleToken }));
    const r = await createGoogleClient({ ...cfg, fetch }).exchangeCode("CODE", "VERIFIER");
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]!.method).toBe("POST");
    const body = new URLSearchParams(calls[0]!.body!);
    expect(Object.fromEntries(body)).toMatchObject({
      code: "CODE",
      code_verifier: "VERIFIER",
      grant_type: "authorization_code",
      client_id: "cid",
      client_secret: "secret",
      redirect_uri: cfg.redirectUri,
    });
    expect(r.email).toBe("marcus.bell@konnectorllc.com");
    expect(r.accessToken).toBe("ya29.a0AfB_byC-recorded");
    expect(r.refreshToken).toBe("1//0gRecordedRefresh");
    expect(r.scopes).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(Date.parse(r.expiresAt!)).toBeGreaterThan(Date.now());
  });

  it("lists Gmail messages (metadata only) and maps headers + snippet", async () => {
    const { fetch, calls } = fakeFetch((url) => ({ json: url.includes("/messages?") ? gmailList : gmailMessage }));
    const page = await createGoogleClient({ ...cfg, fetch }).listMessages("AT", { since: "2026-09-12T15:00:00Z", cursor: "PREV" });
    const list = new URL(calls[0]!.url);
    expect(list.pathname).toBe("/gmail/v1/users/me/messages");
    expect(list.searchParams.get("q")).toBe(`after:${Date.parse("2026-09-12T15:00:00Z") / 1000} -in:chats`);
    expect(list.searchParams.get("pageToken")).toBe("PREV");
    expect(calls[0]!.headers.Authorization).toBe("Bearer AT");
    const get = new URL(calls[1]!.url);
    expect(get.pathname).toBe("/gmail/v1/users/me/messages/18f2a1b2c3d4e5f6");
    expect(get.searchParams.get("format")).toBe("metadata");
    expect(get.searchParams.getAll("metadataHeaders")).toEqual(["From", "To", "Cc", "Subject", "Date", "Message-ID"]);
    expect(calls).toHaveLength(3);
    expect(page.nextCursor).toBe("09876543210987654321");
    expect(page.items[0]).toEqual({
      id: "18f2a1b2c3d4e5f6",
      subject: "Re: Phased migration plan for ITSM",
      from: "denise.walker@gta.example.gov",
      to: ["marcus.bell@konnectorllc.com"],
      cc: ["keisha.adams@gta.example.gov", "robert.nguyen@gta.example.gov"],
      occurredAt: "2026-10-12T15:00:00.000Z",
      snippet: "Thanks for the phased plan. Wave 1 on the service desk works for us & we'd like a rehearsal.",
    });
  });

  it("lists Calendar events and maps attendees, cancelled and all-day events", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: googleEvents }));
    const page = await createGoogleClient({ ...cfg, fetch }).listEvents("AT", { since: "2026-09-12T15:00:00Z" });
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(u.searchParams.get("updatedMin")).toBe("2026-09-12T15:00:00.000Z");
    expect(u.searchParams.get("singleEvents")).toBe("true");
    expect(page.nextCursor).toBe("CigKGjdrcTFj");
    expect(page.items[0]).toMatchObject({
      id: "7kq1c2d3e4f5g6h7",
      subject: "Permit backlog working session",
      organizer: "marcus.bell@konnectorllc.com",
      attendees: ["marcus.bell@konnectorllc.com", "jasmine.carter@atl.example.gov"],
      startsAt: "2026-10-10T15:00:00.000Z",
      snippet: "Walk through permit SLA data.",
      cancelled: false,
    });
    expect(page.items[1]).toMatchObject({ cancelled: true, startsAt: "2026-10-20T00:00:00.000Z", attendees: [] });
  });

  it("sends a base64url MIME message and returns the Gmail id", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { id: "sent-1", threadId: "t", labelIds: ["SENT"] } }));
    const id = await createGoogleClient({ ...cfg, fetch }).sendMessage("AT", {
      to: ["denise.walker@gta.example.gov"],
      cc: ["robert.nguyen@gta.example.gov"],
      subject: "Follow-up: ITSM",
      text: "Hi Denise",
      html: "<p>Hi Denise</p>",
      inReplyTo: "<CAF=abc@mail.gmail.com>",
    });
    expect(id).toBe("sent-1");
    expect(calls[0]!.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const mime = Buffer.from(JSON.parse(calls[0]!.body!).raw, "base64url").toString("utf8");
    expect(mime).toContain("To: denise.walker@gta.example.gov\r\n");
    expect(mime).toContain("Cc: robert.nguyen@gta.example.gov\r\n");
    expect(mime).toContain("Subject: Follow-up: ITSM\r\n");
    expect(mime).toContain("In-Reply-To: <CAF=abc@mail.gmail.com>\r\n");
    expect(mime).toContain(Buffer.from("<p>Hi Denise</p>").toString("base64"));
  });

  it("MIME headers can't be injected and non-ASCII subjects are encoded", () => {
    const mime = buildMime({ to: ["a@x.com\r\nBcc: evil@x.com"], subject: "Café\r\nBcc: evil@x.com", text: "t", html: "h" });
    expect(mime).not.toMatch(/\r\nBcc:/);
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("surfaces provider errors with status", async () => {
    const { fetch } = fakeFetch(() => ({ status: 401, json: { error: { code: 401, message: "Invalid Credentials" } } }));
    await expect(createGoogleClient({ ...cfg, fetch }).listEvents("AT", { since: NOW.toISOString() })).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("Invalid Credentials"),
    });
  });
});

// ---------- Microsoft ----------

describe("Microsoft provider", () => {
  const mcfg = { ...cfg, redirectUri: "https://crm.example.com/api/oauth/microsoft/callback", tenantId: "contoso.onmicrosoft.com" };

  it("builds the authorize URL for the tenant with offline_access and PKCE", () => {
    const u = new URL(createMicrosoftClient(mcfg).authUrl("S", { codeChallenge: "C" }));
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize");
    expect(u.searchParams.get("scope")).toBe("Mail.Read Mail.Send Calendars.Read offline_access openid email");
    expect(u.searchParams.get("response_mode")).toBe("query");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(new URL(createMicrosoftClient({ ...mcfg, tenantId: undefined }).authUrl("S", { codeChallenge: "C" })).pathname).toBe(
      "/common/oauth2/v2.0/authorize",
    );
  });

  it("exchanges the code and falls back to preferred_username for the email", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: msToken }));
    const r = await createMicrosoftClient({ ...mcfg, fetch }).exchangeCode("CODE", "V");
    expect(calls[0]!.url).toBe("https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token");
    const body = Object.fromEntries(new URLSearchParams(calls[0]!.body!));
    expect(body).toMatchObject({
      code: "CODE",
      code_verifier: "V",
      grant_type: "authorization_code",
      scope: expect.stringContaining("Mail.Send"),
    });
    expect(r.email).toBe("marcus.bell@konnectorllc.com");
    expect(r.refreshToken).toBe("0.AXoA-recorded-refresh");
  });

  it("lists /me/messages with a filter, immutable ids and nextLink paging", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: graphMessages }));
    const c = createMicrosoftClient({ ...mcfg, fetch });
    const page = await c.listMessages("AT", { since: "2026-09-12T15:00:00Z" });
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe("/v1.0/me/messages");
    expect(u.searchParams.get("$filter")).toBe("receivedDateTime ge 2026-09-12T15:00:00.000Z");
    expect(u.searchParams.get("$select")).toContain("bodyPreview");
    expect(u.searchParams.get("$select")).not.toContain("body,");
    expect(calls[0]!.headers.Prefer).toBe('IdType="ImmutableId"');
    expect(page.items[0]).toEqual({
      id: "AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0AImmutable1",
      subject: "DOR clarification timeline",
      from: "angela.price@dor.example.gov",
      to: ["marcus.bell@konnectorllc.com"],
      cc: [],
      occurredAt: "2026-10-09T14:30:00.000Z",
      snippet: "Clarification answers will be posted on the 20th.",
    });
    expect(page.nextCursor).toBe(graphMessages["@odata.nextLink"]);
    await c.listMessages("AT", { since: NOW.toISOString(), cursor: page.nextCursor });
    expect(calls[1]!.url).toBe(graphMessages["@odata.nextLink"]);
    await expect(c.listMessages("AT", { since: NOW.toISOString(), cursor: "https://evil.example.com/x" })).rejects.toThrow(/non-Graph/);
  });

  it("maps /me/events with naive UTC times", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: graphEvents }));
    const page = await createMicrosoftClient({ ...mcfg, fetch }).listEvents("AT", { since: "2026-09-12T15:00:00Z" });
    expect(new URL(calls[0]!.url).searchParams.get("$filter")).toBe("lastModifiedDateTime ge 2026-09-12T15:00:00.000Z");
    expect(page.items[0]).toMatchObject({
      startsAt: "2026-10-10T15:00:00.000Z",
      attendees: ["jasmine.carter@atl.example.gov"],
      organizer: "marcus.bell@konnectorllc.com",
    });
    expect(page.nextCursor).toBeNull();
  });

  it("sends via draft + send and returns the immutable id", async () => {
    const { fetch, calls } = fakeFetch((url) => (url.endsWith("/send") ? { status: 202 } : { status: 201, json: { id: "IMM-1" } }));
    const id = await createMicrosoftClient({ ...mcfg, fetch }).sendMessage("AT", {
      to: ["denise.walker@gta.example.gov"],
      subject: "Hello",
      text: "Hi",
      html: "<p>Hi</p>",
    });
    expect(id).toBe("IMM-1");
    expect(calls[0]!.url).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      subject: "Hello",
      body: { contentType: "HTML", content: "<p>Hi</p>" },
      toRecipients: [{ emailAddress: { address: "denise.walker@gta.example.gov" } }],
      ccRecipients: [],
    });
    expect(calls[1]).toMatchObject({ url: "https://graph.microsoft.com/v1.0/me/messages/IMM-1/send", method: "POST" });
  });
});

// ---------- OAuth state ----------

describe("OAuth state + PKCE", () => {
  it("accepts only an unexpired state for the same user and provider", () => {
    const s = signState("user-1", "google", NOW.getTime());
    expect(verifyState(s, { uid: "user-1", provider: "google" }, NOW.getTime())).toMatchObject({ uid: "user-1" });
    expect(verifyState(s, { uid: "user-2", provider: "google" }, NOW.getTime())).toBeNull();
    expect(verifyState(s, { uid: "user-1", provider: "microsoft" }, NOW.getTime())).toBeNull();
    expect(verifyState(s, { uid: "user-1", provider: "google" }, NOW.getTime() + 11 * 60_000)).toBeNull();
    const [payload] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "user-2", provider: "google", nonce: "x", exp: NOW.getTime() + 1e6 })).toString(
      "base64url",
    );
    expect(verifyState(`${forged}.${s.split(".")[1]}`, { uid: "user-2", provider: "google" }, NOW.getTime())).toBeNull();
    expect(payload).toBeTruthy();
  });

  it("derives a stable verifier whose challenge is S256", () => {
    const s = signState("u", "google");
    expect(pkceVerifier(s)).toBe(pkceVerifier(s));
    expect(pkceVerifier(s)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

// ---------- Sync + send (mock provider over the seeded store) ----------

const mockDeps = (overrides: Partial<MailProviderClient> = {}): MailDeps => ({
  client: (p: MailProvider) => ({ ...createMockClient(p, { redirectUri: "http://x/cb", now: () => NOW.getTime() }), ...overrides }),
});

async function connected(key: "bd1" | "bd2" | "admin" = "bd1", provider: MailProvider = "google") {
  const c = await asUser(key);
  const client = mockDeps().client!(provider);
  const code = new URL(client.authUrl("s", { codeChallenge: "c", loginHint: c.user.email })).searchParams.get("code")!;
  const tokens = await client.exchangeCode(code, "v");
  const conn = await saveConnection(c, provider, tokens);
  return { c, conn, tokens };
}

beforeEach(() => resetMockOutbox());

describe("mail sync", () => {
  it("stores tokens only encrypted and never returns them", async () => {
    const { c, conn, tokens } = await connected();
    const row = (await c.store.get("mail_connections", conn.id))!;
    expect(row.access_token_enc).not.toBe(tokens.accessToken);
    expect(row.access_token_enc).toMatch(/^v1\./);
    expect(decrypt(row.access_token_enc!)).toBe(tokens.accessToken);
    expect(decrypt(row.refresh_token_enc!)).toBe(tokens.refreshToken);
    const dump = JSON.stringify((c.store as unknown as { data: unknown }).data);
    expect(dump).not.toContain(tokens.accessToken);
    expect(dump).not.toContain(tokens.refreshToken!);
    const mine = await myConnections(c);
    expect(mine[0]).not.toHaveProperty("access_token_enc");
    expect(mine[0]).not.toHaveProperty("refresh_token_enc");
    expect(mine[0]).toMatchObject({ provider: "google", email: c.user.email, status: "active" });
    const auditRow = (await c.store.list("audit_log")).find((a) => a.action === "mail.connected");
    expect(auditRow?.after).toMatchObject({ internal_domain: true, provider: "google" });
  });

  it("stores only mail and meetings with known contacts, as snippets, on the contact + account timeline", async () => {
    const { c, conn } = await connected();
    const r = await syncConnection(c, conn.id, mockDeps());
    expect(r.ok).toBe(true);
    const synced = await c.store.list("synced_messages", { where: { connection_id: conn.id } });
    const subjects = synced.map((s) => s.subject).sort();
    expect(subjects).toEqual([
      "DOR clarification timeline",
      "Permit backlog working session",
      "Pre-RFP questions — statewide ITSM vehicle",
      "Re: Phased migration plan for ITSM",
    ]);
    // Personal mail, internal-only meetings and anything older than 30 days never touch the store.
    const everything = JSON.stringify((c.store as unknown as { data: unknown }).data);
    for (const s of ["Weekend sale", "Dinner Saturday", "Dentist", "Team stand-up", "Kick-off thoughts", "deals@shop.example.com"])
      expect(everything).not.toContain(s);

    const denise = synced.find((s) => s.subject.startsWith("Re: Phased"))!;
    expect(denise).toMatchObject({
      direction: "inbound",
      kind: "email",
      account_id: ids.account("gta"),
      from_address: "denise.walker@gta.example.gov",
    });
    const contact = (await c.store.get("contacts", denise.contact_id!))!;
    expect(`${contact.first_name} ${contact.last_name}`).toBe("Denise Walker");
    const outbound = synced.find((s) => s.subject.startsWith("Pre-RFP"))!;
    expect(outbound.direction).toBe("outbound");
    expect((await c.store.get("contacts", outbound.contact_id!))!.last_name).toBe("Nguyen");
    const meeting = synced.find((s) => s.kind === "event")!;
    expect(meeting.account_id).toBe(ids.account("atl"));

    const act = (await c.store.get("activities", denise.activity_id!))!;
    expect(act).toMatchObject({
      type: "email",
      related_type: "contact",
      related_id: contact.id,
      account_id: ids.account("gta"),
      actor_id: c.user.id,
    });
    expect(act.body!.length).toBeLessThanOrEqual(600);
    expect(act.body).toContain("From Denise Walker");
    expect((await c.store.get("activities", meeting.activity_id!))!.type).toBe("meeting");
    const gta = await timelineFor(c, "account", ids.account("gta"));
    expect(gta.some((a) => a.subject === "Re: Phased migration plan for ITSM")).toBe(true);

    const after = (await c.store.get("mail_connections", conn.id))!;
    expect(after.last_synced_at).toBe(NOW.toISOString());
    expect(after.sync_cursor).toEqual({});
  });

  it("is idempotent across runs", async () => {
    const { c, conn } = await connected();
    await syncConnection(c, conn.id, mockDeps());
    const before = (await c.store.list("activities")).length;
    const again = await syncConnection(c, conn.id, mockDeps());
    expect(again).toMatchObject({ ok: true, stored: 0 });
    expect((await c.store.list("activities")).length).toBe(before);
    expect((await c.store.list("synced_messages")).length).toBe(4);
  });

  it("refreshes an expiring token and re-encrypts it", async () => {
    const { c, conn, tokens } = await connected();
    await c.store.update("mail_connections", conn.id, { token_expires_at: new Date(NOW.getTime() + 30_000).toISOString() });
    const refresh = vi.fn(createMockClient("google", { redirectUri: "x", now: () => NOW.getTime() }).refresh);
    await syncConnection(c, conn.id, mockDeps({ refresh }));
    expect(refresh).toHaveBeenCalledWith(tokens.refreshToken);
    const row = (await c.store.get("mail_connections", conn.id))!;
    expect(decrypt(row.access_token_enc!)).not.toBe(tokens.accessToken);
    expect(Date.parse(row.token_expires_at!)).toBeGreaterThan(NOW.getTime());
  });

  it("marks the connection as errored and notifies the owner on provider failure", async () => {
    const { c, conn } = await connected();
    const r = await syncConnection(
      c,
      conn.id,
      mockDeps({
        listMessages: async () => {
          throw new ProviderError("google", 401, "google 401: Invalid Credentials");
        },
      }),
    );
    expect(r.ok).toBe(false);
    const row = (await c.store.get("mail_connections", conn.id))!;
    expect(row).toMatchObject({ status: "error", last_error: "google 401: Invalid Credentials" });
    const notes = await c.store.list("notifications", { where: { user_id: c.user.id } });
    expect(notes.some((n) => n.title === "Your mailbox needs to be reconnected" && n.href === "/connections")).toBe(true);
  });

  it("only the owner (or the cron system user) can sync a connection", async () => {
    const { c, conn } = await connected("bd1");
    const other = await switchUser(c, "bd2");
    await expect(syncConnection(other, conn.id, mockDeps())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(disconnect(other, conn.id, mockDeps())).rejects.toBeInstanceOf(ForbiddenError);
    const results = await syncAllActive(await systemCtx(c.store, NOW), mockDeps());
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, stored: 4 });
    // Cron-synced activity is attributed to the mailbox owner.
    const row = (await c.store.list("synced_messages"))[0]!;
    expect((await c.store.get("activities", row.activity_id!))!.actor_id).toBe(c.user.id);
  });

  it("disconnect revokes at the provider, marks revoked and wipes tokens", async () => {
    const { c, conn, tokens } = await connected();
    const revoke = vi.fn(async () => true);
    const out = await disconnect(c, conn.id, mockDeps({ revoke }));
    expect(revoke).toHaveBeenCalledWith(tokens.refreshToken);
    expect(out.status).toBe("revoked");
    const row = (await c.store.get("mail_connections", conn.id))!;
    expect(row).toMatchObject({ status: "revoked", access_token_enc: null, refresh_token_enc: null, token_expires_at: null });
    expect(await myConnections(c)).toEqual([]);
    await expect(syncConnection(c, conn.id, mockDeps())).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("send from record", () => {
  const denise = async (c: Awaited<ReturnType<typeof asUser>>) =>
    (await c.store.list("contacts")).find((x) => x.email === "denise.walker@gta.example.gov")!;

  it("requires the caller's own active connection", async () => {
    const { c } = await connected("bd1");
    const other = await switchUser(c, "admin");
    const d = await denise(other);
    await expect(
      sendFromRecord(other, { to: [d.id], subject: "Hi", body: "Hello", related_type: "contact", related_id: d.id }, mockDeps()),
    ).rejects.toThrow(/Connect your mailbox/);
  });

  it("only sends to contacts the user can see", async () => {
    const { c } = await connected("bd1");
    const hannah = (await c.store.list("contacts")).find((x) => x.email?.startsWith("hannah.brooks"))!; // Peachtree: not bd1's
    const d = await denise(c);
    await expect(
      sendFromRecord(c, { to: [d.id, hannah.id], subject: "Hi", body: "Hello", related_type: "contact", related_id: d.id }, mockDeps()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      sendFromRecord(
        c,
        { to: [hannah.id], subject: "Hi", body: "Hello", related_type: "account", related_id: ids.account("peachtree") },
        mockDeps(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates input", async () => {
    const { c } = await connected("bd1");
    const d = await denise(c);
    await expect(
      sendFromRecord(c, { to: [], subject: "", body: "x", related_type: "contact", related_id: d.id }, mockDeps()),
    ).rejects.toThrow();
  });

  it("sends via the provider, logs an outbound email activity and a synced row, and later sync de-duplicates it", async () => {
    const { c, conn } = await connected("bd1");
    const d = await denise(c);
    const robert = (await c.store.list("contacts")).find((x) => x.last_name === "Nguyen")!;
    const out = await sendFromRecord(
      c,
      {
        to: [d.id],
        cc: [robert.id],
        subject: "Rehearsal plan",
        body: "Hi Denise,\n\nAttached is the <rehearsal> plan.",
        related_type: "contact",
        related_id: d.id,
      },
      mockDeps(),
    );
    const sent = mockOutbox().at(-1)!;
    expect(sent).toMatchObject({ to: ["denise.walker@gta.example.gov"], cc: ["robert.nguyen@gta.example.gov"], subject: "Rehearsal plan" });
    expect(sent.html).toContain("&lt;rehearsal&gt;");
    const act = (await c.store.get("activities", out.activity_id))!;
    expect(act).toMatchObject({
      type: "email",
      subject: "Rehearsal plan",
      related_type: "contact",
      related_id: d.id,
      account_id: ids.account("gta"),
    });
    expect(act.body).toContain("To Denise Walker · cc Robert Nguyen");
    const row = (await c.store.list("synced_messages", { where: { provider_message_id: out.provider_message_id } }))[0]!;
    expect(row).toMatchObject({ direction: "outbound", connection_id: conn.id, activity_id: act.id });
    await syncConnection(c, conn.id, mockDeps());
    expect((await c.store.list("synced_messages", { where: { provider_message_id: out.provider_message_id } })).length).toBe(1);
  });
});
