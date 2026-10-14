/**
 * One-time bootstrap for an empty staging or production database (KCRM-68). Idempotent.
 *
 *   DATABASE_URL=postgres://… pnpm db:bootstrap                     # step 1: create the organization
 *   DATABASE_URL=postgres://… pnpm db:bootstrap --admin you@konnectorllc.com   # step 2, after you sign in once
 *
 * Step 1 must run before anyone signs in: a new user row needs the organization to exist.
 * Step 2 promotes the first admin. It refuses when an admin already exists; after that, roles are
 * assigned in Settings → Team. Both steps write audit_log rows. No seed or demo data is created.
 */
import { Client } from "pg";
import { DEFAULT_SETTINGS } from "../src/lib/data/seed";

const ORG_NAME = "Konnector LLC";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the target database (session pooler connection string).");
  const adminIdx = process.argv.indexOf("--admin");
  const adminEmail = adminIdx > 0 ? process.argv[adminIdx + 1]?.trim().toLowerCase() : undefined;
  if (adminIdx > 0 && !adminEmail) throw new Error("--admin needs an email address.");

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("begin");

    let { rows: orgs } = await db.query<{ id: string; name: string }>(
      "select id, name from public.organizations order by created_at limit 2",
    );
    if (orgs.length > 1) throw new Error("More than one organization exists; this script expects a single-org database.");
    if (!orgs.length) {
      ({ rows: orgs } = await db.query<{ id: string; name: string }>(
        "insert into public.organizations (name, settings) values ($1, $2) returning id, name",
        [ORG_NAME, DEFAULT_SETTINGS],
      ));
      console.log(`Created organization "${orgs[0].name}" (${orgs[0].id}).`);
    } else {
      console.log(`Organization "${orgs[0].name}" already exists (${orgs[0].id}).`);
    }
    const org = orgs[0];

    if (adminEmail) {
      const { rows: admins } = await db.query("select email from public.users where role = 'admin' and archived_at is null");
      if (admins.length)
        throw new Error(`An admin already exists (${admins.map((a) => a.email).join(", ")}). Assign roles in Settings → Team.`);
      const { rows: users } = await db.query<{ id: string; role: string | null }>(
        "select id, role from public.users where lower(email) = $1 and archived_at is null",
        [adminEmail],
      );
      if (!users.length) throw new Error(`${adminEmail} hasn't signed in yet. Sign in once with that account, then rerun.`);
      const user = users[0];
      await db.query("update public.users set role = 'admin', updated_at = now() where id = $1", [user.id]);
      await db.query(
        "insert into public.audit_log (org_id, actor_id, action, entity, entity_id, before, after) values ($1, null, 'user.role_changed', 'users', $2, $3, $4)",
        [org.id, user.id, { role: user.role }, { role: "admin", via: "bootstrap" }],
      );
      console.log(`${adminEmail} is now an admin.`);
    }

    await db.query("commit");
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
