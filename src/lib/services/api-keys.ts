/**
 * Personal API keys for the REST API (/api/v1). Format: `kcrm_<prefix>_<secret>`.
 * Only the 8-char prefix (for display) and a SHA-256 hash of the whole key are stored;
 * the plaintext is returned once, at creation.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import type { Store } from "@/lib/data/store";
import { API_SCOPES, type ApiKey, type ApiScope, type User } from "@/lib/domain/types";
import { sha256 } from "@/lib/server/crypto";
import { audit } from "./audit";
import type { Ctx } from "./context-types";
import { privilegedStore } from "./privileged";

export const KEY_PREFIX = "kcrm";
export const MAX_ACTIVE_KEYS = 10;
/** last_used_at is written at most this often per key. */
export const LAST_USED_RESOLUTION_MS = 60_000;

export type ApiKeyView = Omit<ApiKey, "key_hash">;
const view = ({ key_hash: _omit, ...rest }: ApiKey): ApiKeyView => rest;

export const ApiKeyInput = z.object({
  name: z.string().trim().min(1, "Name the key").max(80),
  scopes: z
    .array(z.enum(API_SCOPES))
    .min(1, "Pick at least one scope")
    .transform((s) => (s.includes("write") ? (["read", "write"] as ApiScope[]) : (["read"] as ApiScope[]))),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
});
export type ApiKeyInputT = z.input<typeof ApiKeyInput>;

const isActive = (k: ApiKey, now: Date) => !k.revoked_at && !k.archived_at && (!k.expires_at || new Date(k.expires_at) > now);

/** Creates a key for the current user and returns the plaintext ONCE. */
export async function createApiKey(c: Ctx, input: ApiKeyInputT): Promise<{ key: string; apiKey: ApiKeyView }> {
  const v = ApiKeyInput.parse(input);
  if (v.expires_at && new Date(v.expires_at) <= c.now) throw new ValidationError("Expiry must be in the future.");
  const store = await privilegedStore(c);
  const mine = await store.list("api_keys", { where: { user_id: c.user.id } });
  if (mine.filter((k) => isActive(k, c.now)).length >= MAX_ACTIVE_KEYS)
    throw new ValidationError(`You already have ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`);
  const prefix = randomBytes(4).toString("hex");
  const key = `${KEY_PREFIX}_${prefix}_${randomBytes(32).toString("hex")}`;
  const row = await store.insert("api_keys", {
    org_id: c.user.org_id,
    user_id: c.user.id,
    name: v.name,
    prefix,
    key_hash: sha256(key),
    scopes: v.scopes,
    last_used_at: null,
    expires_at: v.expires_at ?? null,
    revoked_at: null,
    created_by: c.user.id,
  });
  await audit(c, "api_key.created", "api_keys", row.id, null, { name: row.name, prefix, scopes: row.scopes, expires_at: row.expires_at });
  return { key, apiKey: view(row) };
}

/** The current user's keys, newest first, without hashes. */
export async function listMyApiKeys(c: Ctx): Promise<ApiKeyView[]> {
  const store = await privilegedStore(c);
  const rows = await store.list("api_keys", {
    where: { user_id: c.user.id },
    orderBy: { column: "created_at", ascending: false },
    includeArchived: true,
  });
  return rows.map(view);
}

/** Owner revokes their key; admins can revoke anyone's. Idempotent. */
export async function revokeApiKey(c: Ctx, id: string): Promise<ApiKeyView> {
  const store = await privilegedStore(c);
  const k = await store.get("api_keys", id);
  if (!k || (k.user_id !== c.user.id && c.user.role !== "admin")) throw new ForbiddenError("API key not found.");
  if (k.revoked_at) return view(k);
  const row = await store.update("api_keys", id, { revoked_at: c.now.toISOString() });
  await audit(c, "api_key.revoked", "api_keys", id, { revoked_at: null }, { revoked_at: row.revoked_at, user_id: k.user_id });
  return view(row);
}

export type ApiAuth = { ok: true; user: User; key: ApiKeyView; scopes: ApiScope[] } | { ok: false; reason: string };

/** Parses `kcrm_<8 hex>_<64 hex>`; returns the prefix or null. */
export function parseKey(raw: string): { prefix: string } | null {
  const m = /^kcrm_([0-9a-f]{8})_([0-9a-f]{64})$/.exec(raw);
  return m ? { prefix: m[1] } : null;
}

/**
 * Resolves an `Authorization: Bearer kcrm_…` header to the key's user and scopes.
 * Lookup is by SHA-256 hash (no plaintext comparison), double-checked with a constant-time
 * compare. Rejects malformed, unknown, revoked and expired keys and archived users.
 */
export async function authenticateApiKey(store: Store, header: string | null, now: Date = new Date()): Promise<ApiAuth> {
  const m = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  if (!m) return { ok: false, reason: "Missing bearer token." };
  const parsed = parseKey(m[1]);
  if (!parsed) return { ok: false, reason: "Malformed API key." };
  const hash = sha256(m[1]);
  const [k] = await store.list("api_keys", { where: { key_hash: hash }, includeArchived: true });
  if (!k || k.prefix !== parsed.prefix || !timingSafeEqual(Buffer.from(k.key_hash, "hex"), Buffer.from(hash, "hex")))
    return { ok: false, reason: "Invalid API key." };
  if (k.revoked_at || k.archived_at) return { ok: false, reason: "API key revoked." };
  if (k.expires_at && new Date(k.expires_at) <= now) return { ok: false, reason: "API key expired." };
  const user = await store.get("users", k.user_id);
  if (!user || user.archived_at) return { ok: false, reason: "API key owner is no longer active." };
  let key = k;
  if (!k.last_used_at || now.getTime() - new Date(k.last_used_at).getTime() >= LAST_USED_RESOLUTION_MS) {
    key = await store.update("api_keys", k.id, { last_used_at: now.toISOString() });
  }
  return { ok: true, user, key: view(key), scopes: k.scopes };
}
