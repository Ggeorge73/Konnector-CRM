/**
 * Re-encrypts every secret stored with APP_ENCRYPTION_KEY under a new key, in one transaction:
 *   - mail_connections.access_token_enc / refresh_token_enc (OAuth tokens)
 *   - webhook_subscriptions.secret_enc (webhook signing secrets)
 *
 *   OLD_APP_ENCRYPTION_KEY=… NEW_APP_ENCRYPTION_KEY=… DATABASE_URL=postgres://… pnpm keys:rotate-encryption [--apply]
 *
 * Without --apply it is a dry run: it decrypts everything with the old key (proving the key is right)
 * and rolls back. Rows that already decrypt with the new key are skipped, so a re-run is safe.
 * Runbook: docs/SECURITY.md → "APP_ENCRYPTION_KEY".
 */
import { Client } from "pg";
import { decryptWith, parseKey, reencrypt } from "../src/lib/server/crypto";

const COLUMNS: { table: string; columns: string[] }[] = [
  { table: "mail_connections", columns: ["access_token_enc", "refresh_token_enc"] },
  { table: "webhook_subscriptions", columns: ["secret_enc"] },
];

function need(name: string) {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required`);
    process.exit(2);
  }
  return v;
}

function decryptsWith(token: string, key: Buffer) {
  try {
    decryptWith(token, key);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const oldKey = parseKey(need("OLD_APP_ENCRYPTION_KEY"));
  const newKey = parseKey(need("NEW_APP_ENCRYPTION_KEY"));
  const apply = process.argv.includes("--apply");
  const db = new Client({ connectionString: need("DATABASE_URL") });
  await db.connect();
  let changed = 0;
  let skipped = 0;
  try {
    await db.query("begin");
    for (const { table, columns } of COLUMNS) {
      const { rows } = await db.query<Record<string, string | null>>(`select id, ${columns.join(", ")} from public.${table} for update`);
      for (const row of rows) {
        const patch: Record<string, string> = {};
        for (const col of columns) {
          const v = row[col];
          if (!v) continue;
          if (decryptsWith(v, newKey)) {
            skipped++;
            continue;
          }
          patch[col] = reencrypt(v, oldKey, newKey); // throws if the old key is wrong → rollback
        }
        const cols = Object.keys(patch);
        if (!cols.length) continue;
        await db.query(`update public.${table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1`, [
          row.id,
          ...cols.map((c) => patch[c]),
        ]);
        changed += cols.length;
      }
    }
    await db.query(apply ? "commit" : "rollback");
    console.log(`${apply ? "Re-encrypted" : "Dry run: would re-encrypt"} ${changed} value(s); ${skipped} already on the new key.`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    console.error("Rotation failed, nothing changed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

void main();
