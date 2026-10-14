import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptWith, encryptWith, parseKey, reencrypt } from "@/lib/server/crypto";

describe("APP_ENCRYPTION_KEY rotation", () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);

  it("re-encrypts a value from the old key to the new key", () => {
    const token = encryptWith("refresh-token-123", oldKey);
    const rotated = reencrypt(token, oldKey, newKey);
    expect(rotated).not.toBe(token);
    expect(decryptWith(rotated, newKey)).toBe("refresh-token-123");
    expect(() => decryptWith(rotated, oldKey)).toThrow();
  });

  it("refuses to rotate with the wrong old key", () => {
    const token = encryptWith("secret", oldKey);
    expect(() => reencrypt(token, randomBytes(32), newKey)).toThrow();
  });

  it("only accepts 32-byte base64 keys", () => {
    expect(parseKey(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
