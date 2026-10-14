import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets at rest (OAuth tokens, webhook signing secrets).
 * Key: APP_ENCRYPTION_KEY (32 bytes, base64). Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
/** Decodes a base64 APP_ENCRYPTION_KEY value; throws unless it is exactly 32 bytes. */
export function parseKey(raw: string): Buffer {
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (raw) return parseKey(raw);
  if (process.env.NODE_ENV === "production" && process.env.DATA_BACKEND === "supabase") {
    throw new Error("APP_ENCRYPTION_KEY is required in production");
  }
  // Demo/dev/test only: a fixed derived key so the in-memory store works without setup.
  return createHash("sha256").update("konnector-crm-dev-only-key").digest();
}

export function encrypt(plain: string): string {
  return encryptWith(plain, key());
}

export function decrypt(token: string): string {
  return decryptWith(token, key());
}

/** Key rotation (scripts/rotate-encryption-key.ts): decrypt with the old key, encrypt with the new one. */
export function reencrypt(token: string, oldKey: Buffer, newKey: Buffer): string {
  return encryptWith(decryptWith(token, oldKey), newKey);
}

export function encryptWith(plain: string, k: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptWith(token: string, k: Buffer): string {
  const [v, iv, tag, ct] = token.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised ciphertext");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
