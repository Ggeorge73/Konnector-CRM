/**
 * Mailbox + calendar sync and send-from-record (PI-2 Sprint 7).
 *
 * Privacy rule: only messages and meetings that involve an address the CRM already knows
 * (contacts.email, case-insensitive) are stored, and only as subject + a short snippet.
 * Unrelated personal mail never touches the store. OAuth tokens are stored encrypted only.
 */
import { z } from "zod";
import { env } from "@/config/app";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { hasRole } from "@/lib/auth/permissions";
import type { Contact, MailConnection, MailProvider, SyncedMessage, User } from "@/lib/domain/types";
import {
  mailClient,
  ProviderError,
  snippet,
  type ExchangeResult,
  type MailProviderClient,
  type ProviderEvent,
  type ProviderMessage,
} from "@/lib/mail";
import { decrypt, encrypt } from "@/lib/server/crypto";
import { audit } from "./audit";
import type { Ctx } from "./context-types";
import { getAccount, getContact, logActivity, notify, visibleContacts, visibleOpportunities } from "./core";
import { SYSTEM_USER_ID } from "./system";

export const FIRST_SYNC_DAYS = 30;
export const MAX_ITEMS_PER_RUN = 500;
const REFRESH_SKEW_MS = 2 * 60_000;
const SINCE_OVERLAP_MS = 5 * 60_000;

/** Lets tests (and future providers) inject a client; defaults to the env-configured provider. */
export interface MailDeps {
  client?: (provider: MailProvider) => MailProviderClient;
}
const resolveClient = (deps: MailDeps | undefined, provider: MailProvider) => (deps?.client ? deps.client(provider) : mailClient(provider));

/** The browser-safe shape of a connection: never includes tokens. */
export type PublicConnection = Omit<MailConnection, "access_token_enc" | "refresh_token_enc" | "sync_cursor">;

export function publicConnection(row: MailConnection): PublicConnection {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { access_token_enc, refresh_token_enc, sync_cursor, ...rest } = row;
  return rest;
}

// ---------------- Connections ----------------

export async function myConnections(c: Ctx): Promise<PublicConnection[]> {
  const rows = await c.store.list("mail_connections", {
    where: { user_id: c.user.id },
    orderBy: { column: "updated_at", ascending: false },
  });
  return rows.filter((r) => r.status !== "revoked").map(publicConnection);
}

async function activeConnectionRow(c: Ctx): Promise<MailConnection | null> {
  const rows = await c.store.list("mail_connections", {
    where: { user_id: c.user.id, status: "active" },
    orderBy: { column: "updated_at", ascending: false },
  });
  return rows[0] ?? null;
}

export async function mailStatus(c: Ctx) {
  const row = await activeConnectionRow(c);
  return { hasConnection: !!row, email: row?.email ?? null, provider: row?.provider ?? null };
}

async function ownConnection(c: Ctx, id: string): Promise<MailConnection> {
  const row = await c.store.get("mail_connections", id);
  if (!row || (row.user_id !== c.user.id && c.user.id !== SYSTEM_USER_ID)) throw new ForbiddenError("Connection not found.");
  return row;
}

/** OAuth callback: create or update the signed-in user's connection for this provider. Tokens are encrypted here. */
export async function saveConnection(c: Ctx, provider: MailProvider, t: ExchangeResult): Promise<PublicConnection> {
  if (c.user.id === SYSTEM_USER_ID) throw new ForbiddenError();
  const [existing] = await c.store.list("mail_connections", { where: { user_id: c.user.id, provider } });
  const patch = {
    email: t.email.toLowerCase(),
    status: "active" as const,
    scopes: t.scopes,
    access_token_enc: encrypt(t.accessToken),
    // Google only returns a refresh token on consent; keep the old one if a re-connect omits it.
    refresh_token_enc: t.refreshToken ? encrypt(t.refreshToken) : (existing?.refresh_token_enc ?? null),
    token_expires_at: t.expiresAt,
    last_error: null,
  };
  const row = existing
    ? await c.store.update(
        "mail_connections",
        existing.id,
        existing.email === patch.email ? patch : { ...patch, sync_cursor: {}, last_synced_at: null },
      )
    : await c.store.insert("mail_connections", {
        org_id: c.user.org_id,
        user_id: c.user.id,
        provider,
        last_synced_at: null,
        sync_cursor: {},
        created_by: c.user.id,
        ...patch,
      });
  // Internal-domain match is not required (work aliases are fine) but recorded for the audit trail.
  const internal = patch.email.endsWith(`@${env.allowedEmailDomain}`);
  await audit(c, "mail.connected", "mail_connections", row.id, existing ? { status: existing.status, email: existing.email } : null, {
    provider,
    email: patch.email,
    scopes: t.scopes,
    internal_domain: internal,
  });
  return publicConnection(row);
}

/** Revoke at the provider when it supports it, then mark revoked and wipe tokens. */
export async function disconnect(c: Ctx, id: string, deps?: MailDeps): Promise<PublicConnection> {
  const row = await ownConnection(c, id);
  const token = row.refresh_token_enc ?? row.access_token_enc;
  if (token && row.status !== "revoked") {
    try {
      await resolveClient(deps, row.provider).revoke(decrypt(token));
    } catch {
      // Best effort: local tokens are wiped regardless.
    }
  }
  const updated = await c.store.update("mail_connections", id, {
    status: "revoked",
    access_token_enc: null,
    refresh_token_enc: null,
    token_expires_at: null,
    sync_cursor: {},
    last_error: null,
  });
  await audit(c, "mail.disconnected", "mail_connections", id, { status: row.status }, { status: "revoked" });
  return publicConnection(updated);
}

/** Decrypt the access token, refreshing (and re-encrypting) it first when it is about to expire. */
async function accessToken(c: Ctx, conn: MailConnection, client: MailProviderClient): Promise<string> {
  if (!conn.access_token_enc) throw new ValidationError("This mailbox needs to be reconnected.");
  const exp = conn.token_expires_at ? Date.parse(conn.token_expires_at) : null;
  if (exp === null || exp - c.now.getTime() > REFRESH_SKEW_MS) return decrypt(conn.access_token_enc);
  if (!conn.refresh_token_enc) throw new ValidationError("This mailbox's access expired. Reconnect it.");
  const t = await client.refresh(decrypt(conn.refresh_token_enc));
  await c.store.update("mail_connections", conn.id, {
    access_token_enc: encrypt(t.accessToken),
    refresh_token_enc: t.refreshToken ? encrypt(t.refreshToken) : conn.refresh_token_enc,
    token_expires_at: t.expiresAt,
  });
  return t.accessToken;
}

// ---------------- Sync ----------------

interface StreamCursor {
  since: string;
  cursor: string;
}
interface SyncCursor {
  messages?: StreamCursor;
  events?: StreamCursor;
}

export interface SyncResult {
  ok: boolean;
  scanned: number;
  stored: number;
  error?: string;
}

const fullName = (x: Contact) => `${x.first_name} ${x.last_name}`;
/** External text must not trigger @mentions of internal users. Addresses (a@b) are untouched. */
const neutraliseMentions = (s: string) => s.replace(/(^|\s)@(?=\S)/g, "$1");

export async function syncConnection(c: Ctx, connectionId: string, deps?: MailDeps): Promise<SyncResult> {
  const conn = await ownConnection(c, connectionId);
  if (conn.status === "revoked") throw new ValidationError("This connection was disconnected. Connect it again to sync.");
  const owner: User | null = conn.user_id === c.user.id ? c.user : await c.store.get("users", conn.user_id);
  if (!owner || !hasRole(owner)) throw new ForbiddenError("Connection owner not found.");
  // Timeline entries are attributed to the mailbox owner, even when the cron runs the sync.
  const uc: Ctx = { ...c, user: owner };
  const client = resolveClient(deps, conn.provider);
  const runStartedAt = c.now.toISOString();
  const mailbox = conn.email.toLowerCase();
  let scanned = 0;
  let stored = 0;

  try {
    const token = await accessToken(c, conn, client);
    const contacts = (await c.store.list("contacts")).filter((x) => !!x.email);
    const byEmail = new Map(contacts.map((x) => [x.email!.toLowerCase(), x]));
    const seen = new Set((await c.store.list("synced_messages", { where: { connection_id: conn.id } })).map((m) => m.provider_message_id));
    const prior = (conn.sync_cursor ?? {}) as SyncCursor;
    const defaultSince = conn.last_synced_at
      ? new Date(Date.parse(conn.last_synced_at) - SINCE_OVERLAP_MS).toISOString()
      : new Date(c.now.getTime() - FIRST_SYNC_DAYS * 86_400_000).toISOString();

    const record = async (
      item: { id: string; subject: string; occurredAt: string; snippet: string },
      kind: SyncedMessage["kind"],
      from: string | null,
      participants: string[],
    ) => {
      if (seen.has(item.id)) return;
      const others = [...new Set(participants.map((a) => a.toLowerCase()))].filter((a) => a !== mailbox);
      const matched = others.map((a) => byEmail.get(a)).filter((x): x is Contact => !!x);
      if (!matched.length) return; // privacy: unrelated mail is dropped, nothing stored
      const direction: SyncedMessage["direction"] = kind === "event" ? "inbound" : from?.toLowerCase() === mailbox ? "outbound" : "inbound";
      const primary = (direction === "inbound" && from && byEmail.get(from.toLowerCase())) || matched[0]!;
      const names = [...new Set(matched.map(fullName))].join(", ");
      const lead = kind === "event" ? `With ${names}` : direction === "inbound" ? `From ${fullName(primary)}` : `To ${names}`;
      const text = neutraliseMentions(snippet(item.snippet));
      const activity = await logActivity(uc, {
        type: kind === "event" ? "meeting" : "email",
        subject: item.subject.slice(0, 200),
        body: text ? `${lead}\n\n${text}` : lead,
        occurred_at: item.occurredAt,
        related_type: "contact",
        related_id: primary.id,
        account_id: primary.account_id,
      });
      await c.store.insert("synced_messages", {
        connection_id: conn.id,
        user_id: conn.user_id,
        provider_message_id: item.id,
        kind,
        direction,
        subject: item.subject.slice(0, 200),
        from_address: from?.toLowerCase() ?? null,
        to_addresses: others,
        occurred_at: item.occurredAt,
        activity_id: activity.id,
        account_id: primary.account_id,
        contact_id: primary.id,
        created_by: null,
      });
      seen.add(item.id);
      stored++;
    };

    async function drain<T>(
      prev: StreamCursor | undefined,
      list: (args: { since: string; cursor: string | null }) => Promise<{ items: T[]; nextCursor: string | null }>,
      handle: (item: T) => Promise<void>,
    ): Promise<StreamCursor | undefined> {
      const since = prev?.since ?? defaultSince;
      let cursor: string | null = prev?.cursor ?? null;
      let n = 0;
      do {
        const page = await list({ since, cursor });
        for (const item of page.items) await handle(item);
        n += page.items.length;
        scanned += page.items.length;
        cursor = page.nextCursor;
      } while (cursor && n < MAX_ITEMS_PER_RUN);
      // Hit the cap: keep the window + page token so the next run continues where this one stopped.
      return cursor ? { since, cursor } : undefined;
    }

    const next: SyncCursor = {
      messages: await drain(
        prior.messages,
        (a) => client.listMessages(token, a),
        (m: ProviderMessage) => record(m, "email", m.from, [...(m.from ? [m.from] : []), ...m.to, ...m.cc]),
      ),
      events: await drain(
        prior.events,
        (a) => client.listEvents(token, a),
        async (e: ProviderEvent) => {
          if (e.cancelled) return;
          await record({ id: e.id, subject: e.subject, occurredAt: e.startsAt, snippet: e.snippet }, "event", e.organizer, [
            ...(e.organizer ? [e.organizer] : []),
            ...e.attendees,
          ]);
        },
      ),
    };
    const pending = Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as Record<string, unknown>;
    await c.store.update("mail_connections", conn.id, {
      status: "active",
      last_error: null,
      last_synced_at: runStartedAt,
      sync_cursor: pending,
    });
    return { ok: true, scanned, stored };
  } catch (e) {
    if (e instanceof ForbiddenError) throw e;
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await c.store.update("mail_connections", conn.id, { status: "error", last_error: message });
    const reconnect = e instanceof ProviderError && (e.status === 400 || e.status === 401);
    await notify(
      uc,
      conn.user_id,
      "alert",
      reconnect ? "Your mailbox needs to be reconnected" : "Mailbox sync failed",
      "/connections",
      message,
    );
    return { ok: false, scanned, stored, error: message };
  }
}

/** Cron: sync every active connection. One failure never stops the others. */
export async function syncAllActive(c: Ctx, deps?: MailDeps) {
  const rows = await c.store.list("mail_connections", { where: { status: "active" } });
  const results: Array<SyncResult & { connection_id: string }> = [];
  for (const r of rows) {
    try {
      results.push({ connection_id: r.id, ...(await syncConnection(c, r.id, deps)) });
    } catch (e) {
      results.push({ connection_id: r.id, ok: false, scanned: 0, stored: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/** Most recent items synced from (or sent through) the user's own mailboxes. */
export async function recentSynced(c: Ctx, limit = 20) {
  const [rows, contacts, accounts] = await Promise.all([
    c.store.list("synced_messages", { where: { user_id: c.user.id }, orderBy: { column: "occurred_at", ascending: false }, limit }),
    c.store.list("contacts"),
    c.store.list("accounts"),
  ]);
  const ct = new Map(contacts.map((x) => [x.id, x]));
  const ac = new Map(accounts.map((x) => [x.id, x]));
  return rows.map((r) => {
    const contact = r.contact_id ? ct.get(r.contact_id) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      direction: r.direction,
      subject: r.subject,
      occurred_at: r.occurred_at,
      contact: contact ? { id: contact.id, name: fullName(contact) } : null,
      account: r.account_id && ac.get(r.account_id) ? { id: r.account_id, name: ac.get(r.account_id)!.name } : null,
    };
  });
}

// ---------------- Send ----------------

export const SEND_RELATED_TYPES = ["account", "contact", "opportunity"] as const;

export const SendEmailInput = z.object({
  to: z.array(z.string().uuid()).min(1, "Pick at least one recipient").max(20, "Up to 20 recipients"),
  cc: z.array(z.string().uuid()).max(20).default([]),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Write a message").max(20_000),
  related_type: z.enum(SEND_RELATED_TYPES),
  related_id: z.string().uuid(),
});
export type SendEmailInputT = z.input<typeof SendEmailInput>;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function bodyToHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

async function relatedAccountId(c: Ctx, type: (typeof SEND_RELATED_TYPES)[number], id: string): Promise<string> {
  if (type === "account") return (await getAccount(c, id)).id;
  if (type === "contact") return (await getContact(c, id)).account.id;
  const opp = (await visibleOpportunities(c)).find((o) => o.id === id);
  if (!opp) throw new ForbiddenError("Opportunity not found.");
  return opp.account_id;
}

/** Send from the caller's own mailbox to contacts they can see, then log it on the record's timeline. */
export async function sendFromRecord(c: Ctx, input: SendEmailInputT, deps?: MailDeps) {
  const v = SendEmailInput.parse(input);
  const conn = await activeConnectionRow(c);
  if (!conn) throw new ValidationError("Connect your mailbox in Email & calendar before sending.");
  const accountId = await relatedAccountId(c, v.related_type, v.related_id);
  const visible = new Map((await visibleContacts(c)).map((x) => [x.id, x]));
  const pick = (ids: string[]) =>
    ids.map((id) => {
      const x = visible.get(id);
      if (!x) throw new ForbiddenError("You can only email contacts you can see.");
      if (!x.email) throw new ValidationError(`${fullName(x)} has no email address.`);
      return x;
    });
  const to = pick(v.to);
  const cc = pick(v.cc.filter((id) => !v.to.includes(id)));

  const client = resolveClient(deps, conn.provider);
  let providerId: string;
  try {
    const token = await accessToken(c, conn, client);
    providerId = await client.sendMessage(token, {
      from: conn.email,
      to: to.map((x) => x.email!),
      cc: cc.map((x) => x.email!),
      subject: v.subject,
      text: v.body,
      html: bodyToHtml(v.body),
    });
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(`Your mailbox couldn't send this message. ${e instanceof Error ? e.message : ""}`.trim().slice(0, 300));
  }

  const names = to.map(fullName).join(", ");
  const activity = await logActivity(c, {
    type: "email",
    subject: v.subject,
    body: `To ${names}${cc.length ? ` · cc ${cc.map(fullName).join(", ")}` : ""}\n\n${neutraliseMentions(snippet(v.body))}`,
    related_type: v.related_type,
    related_id: v.related_id,
    account_id: accountId,
  });
  await c.store.insert("synced_messages", {
    connection_id: conn.id,
    user_id: c.user.id,
    provider_message_id: providerId,
    kind: "email",
    direction: "outbound",
    subject: v.subject,
    from_address: conn.email,
    to_addresses: [...to, ...cc].map((x) => x.email!.toLowerCase()),
    occurred_at: c.now.toISOString(),
    activity_id: activity.id,
    account_id: accountId,
    contact_id: to[0]!.id,
    created_by: c.user.id,
  });
  return { activity_id: activity.id, provider_message_id: providerId };
}
