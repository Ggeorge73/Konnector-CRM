import { randomUUID } from "node:crypto";
import type { MailProvider } from "@/lib/domain/types";
import { GOOGLE_SCOPES } from "./google";
import { MICROSOFT_SCOPES } from "./microsoft";
import { ProviderError, type MailProviderClient, type ProviderEvent, type ProviderMessage, type SendArgs } from "./types";

/**
 * Deterministic fake mailbox + calendar for demo mode and e2e. The inbox mixes mail with seeded
 * contacts (which sync) and unrelated personal mail (which must never reach the CRM).
 * The "OAuth" round trip redirects straight back to the callback with a code that carries the login hint.
 */

export interface MockSent extends SendArgs {
  id: string;
  provider: MailProvider;
  mailbox: string;
  sentAt: string;
}

const g = globalThis as unknown as { __kcrmMockOutbox?: MockSent[] };
/** Messages "sent" through the mock, newest last. Process-wide so the e2e server can show them. */
export function mockOutbox(): MockSent[] {
  return (g.__kcrmMockOutbox ??= []);
}
export function resetMockOutbox() {
  g.__kcrmMockOutbox = [];
}

const enc = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const dec = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** Mailbox address carried in a mock token/code: `mock-<kind>.<b64url(email)>[.<n>]`. */
function mailboxOf(token: string): string {
  const [kind, email] = token.split(".");
  if (!kind?.startsWith("mock-") || !email) throw new ProviderError("google", 401, "Invalid mock token");
  return dec(email);
}

const H = 3_600_000;
const D = 24 * H;

export function mockInbox(mailbox: string, provider: MailProvider, now: number): ProviderMessage[] {
  const id = (n: number) => `${provider}-mock-msg-${n}`;
  const at = (ms: number) => new Date(now - ms).toISOString();
  return [
    {
      id: id(1),
      subject: "Re: Phased migration plan for ITSM",
      from: "denise.walker@gta.example.gov",
      to: [mailbox],
      cc: ["keisha.adams@gta.example.gov"],
      occurredAt: at(2 * H),
      snippet:
        "Thanks for the phased plan. Wave 1 on the service desk works for us; can you add a cut-over rehearsal before go-live and confirm the licence true-up assumptions?",
    },
    {
      id: id(2),
      subject: "Pre-RFP questions — statewide ITSM vehicle",
      from: mailbox,
      to: ["robert.nguyen@gta.example.gov"],
      cc: ["denise.walker@gta.example.gov"],
      occurredAt: at(1 * D),
      snippet: "Robert, ahead of the RFP release could you confirm whether the vehicle allows teaming arrangements with an OEM partner?",
    },
    {
      id: id(3),
      subject: "Weekend sale: 40% off running shoes",
      from: "deals@shop.example.com",
      to: [mailbox],
      cc: [],
      occurredAt: at(5 * H),
      snippet: "Our biggest sale of the season ends Sunday.",
    },
    {
      id: id(4),
      subject: "Dinner Saturday?",
      from: "family.member@personal.example.com",
      to: [mailbox],
      cc: [],
      occurredAt: at(20 * H),
      snippet: "Are we still on for dinner on Saturday at 7?",
    },
    {
      id: id(5),
      subject: "DOR clarification timeline",
      from: "angela.price@dor.example.gov",
      to: [mailbox],
      cc: [],
      occurredAt: at(3 * D),
      snippet: "Clarification answers will be posted on the 20th. Please route questions through the procurement portal only.",
    },
    {
      id: id(6),
      subject: "Kick-off thoughts (old thread)",
      from: "denise.walker@gta.example.gov",
      to: [mailbox],
      cc: [],
      occurredAt: at(45 * D),
      snippet: "Older message outside the 30-day first-sync window.",
    },
  ];
}

export function mockCalendar(mailbox: string, provider: MailProvider, now: number): ProviderEvent[] {
  const id = (n: number) => `${provider}-mock-evt-${n}`;
  return [
    {
      id: id(1),
      subject: "Permit backlog working session",
      organizer: mailbox,
      attendees: [mailbox, "jasmine.carter@atl.example.gov", "brian.holloway@atl.example.gov"],
      startsAt: new Date(now - 2 * D).toISOString(),
      snippet: "Walk through permit SLA data and the 90-day stabilisation option.",
      cancelled: false,
    },
    {
      id: id(2),
      subject: "Dentist",
      organizer: mailbox,
      attendees: [],
      startsAt: new Date(now - 1 * D).toISOString(),
      snippet: "",
      cancelled: false,
    },
    {
      id: id(3),
      subject: "Team stand-up",
      organizer: "adaeze.okafor@konnectorllc.com",
      attendees: [mailbox, "adaeze.okafor@konnectorllc.com"],
      startsAt: new Date(now - 6 * H).toISOString(),
      snippet: "Internal only.",
      cancelled: false,
    },
  ];
}

/** Two items per page so paging is exercised. Cursor = next offset. */
function paginate<T>(all: T[], cursor: string | null | undefined, size = 2) {
  const start = cursor ? Number(cursor) : 0;
  const items = all.slice(start, start + size);
  return { items, nextCursor: start + size < all.length ? String(start + size) : null };
}

export function createMockClient(provider: MailProvider, opts: { redirectUri: string; now?: () => number }): MailProviderClient {
  const now = opts.now ?? (() => Date.now());
  return {
    provider,
    mode: "mock",
    scopes: provider === "google" ? GOOGLE_SCOPES : MICROSOFT_SCOPES,
    authUrl(state, o) {
      const code = `mock-code.${enc(o.loginHint ?? `demo.user@konnectorllc.com`)}`;
      return `${opts.redirectUri}?${new URLSearchParams({ code, state })}`;
    },
    async exchangeCode(code) {
      const email = mailboxOf(code).toLowerCase();
      return {
        email,
        accessToken: `mock-access.${enc(email)}.${randomUUID().slice(0, 8)}`,
        refreshToken: `mock-refresh.${enc(email)}`,
        expiresAt: new Date(now() + H).toISOString(),
        scopes: [...(provider === "google" ? GOOGLE_SCOPES : MICROSOFT_SCOPES)],
      };
    },
    async refresh(refreshToken) {
      const email = mailboxOf(refreshToken);
      return {
        accessToken: `mock-access.${enc(email)}.${randomUUID().slice(0, 8)}`,
        refreshToken: null,
        expiresAt: new Date(now() + H).toISOString(),
        scopes: [],
      };
    },
    async revoke() {
      return true;
    },
    async listMessages(accessToken, args) {
      const mailbox = mailboxOf(accessToken);
      const since = new Date(args.since).getTime();
      const sent: ProviderMessage[] = mockOutbox()
        .filter((m) => m.mailbox === mailbox && m.provider === provider)
        .map((m) => ({
          id: m.id,
          subject: m.subject,
          from: mailbox,
          to: m.to,
          cc: m.cc ?? [],
          occurredAt: m.sentAt,
          snippet: m.text.slice(0, 200),
        }));
      const all = [...mockInbox(mailbox, provider, now()), ...sent].filter((m) => new Date(m.occurredAt).getTime() >= since);
      return paginate(all, args.cursor);
    },
    async listEvents(accessToken, args) {
      const mailbox = mailboxOf(accessToken);
      // Mirrors updatedMin: everything counts as "updated" just after the window opens on first sync.
      void args.since;
      return paginate(mockCalendar(mailbox, provider, now()), args.cursor);
    },
    async sendMessage(accessToken, args) {
      const mailbox = mailboxOf(accessToken);
      const id = `${provider}-mock-sent-${mockOutbox().length + 1}-${now()}`;
      mockOutbox().push({ ...args, id, provider, mailbox, sentAt: new Date(now()).toISOString() });
      return id;
    },
  };
}
