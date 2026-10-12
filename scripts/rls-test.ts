/**
 * Row-level security test: applies supabase/migrations + supabase/seed.sql to a
 * throwaway database and checks, per seeded role, what each user can and cannot
 * read or write. Expectations are computed from buildSeed() and the app-side
 * rules in src/lib/auth/permissions.ts, so RLS and the UI cannot drift apart.
 *
 *   DATABASE_URL=postgres://user:pass@localhost:5432/postgres pnpm test:rls
 *
 * DATABASE_URL must be a superuser (it creates a database and the Supabase API
 * roles if missing). Set KEEP_DB=1 to keep the database for inspection.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  canSeeAccount,
  canSeeBench,
  canSeeBidDecision,
  canSeeConsultantCost,
  canSeeOpportunity,
  canSeeQuoteCost,
  canSeeVetting,
  canViewAudit,
} from "../src/lib/auth/permissions";
import { buildSeed, SEED_USERS } from "../src/lib/data/seed";
import type { TableName, User } from "../src/lib/domain/types";
import { SEED_NOW } from "./generate-seed-sql";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const SEED_SQL = join(ROOT, "supabase/seed.sql");

/** Minimal stand-in for what Supabase provides before migrations run. */
const BOOTSTRAP = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  confirmation_token varchar(255),
  recovery_token varchar(255),
  email_change_token_new varchar(255),
  email_change varchar(255)
);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role'
$$;
grant usage on schema auth to anon, authenticated, service_role;
-- Supabase grants everything on new public objects to the API roles by default;
-- mirror that so the migrations must revoke explicitly.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
`;

// ---------------------------------------------------------------------------
// Expectations from the JS rules
// ---------------------------------------------------------------------------

const data = buildSeed(SEED_NOW);
type Who = Pick<User, "id" | "role">;
const userById = new Map(data.users.map((u) => [u.id, u]));
const who = (id: string): Who => {
  const u = userById.get(id);
  if (!u) throw new Error(`seed user ${id} missing`);
  return { id: u.id, role: u.role };
};
const oppById = new Map(data.opportunities.map((o) => [o.id, o]));
const quoteById = new Map(data.quotes.map((q) => [q.id, q]));

const expect = {
  opportunities: (u: Who) => data.opportunities.filter((o) => canSeeOpportunity(u, o)).map((o) => o.id),
  accounts: (u: Who) => {
    const opps = data.opportunities.filter((o) => canSeeOpportunity(u, o));
    return data.accounts.filter((a) => canSeeAccount(u, a, opps)).map((a) => a.id);
  },
  quotes: (u: Who) => data.quotes.filter((q) => canSeeOpportunity(u, oppById.get(q.opportunity_id)!)).map((q) => q.id),
  quoteLinesClient: (u: Who) =>
    data.quote_lines.filter((l) => canSeeOpportunity(u, oppById.get(quoteById.get(l.quote_id)!.opportunity_id)!)).map((l) => l.id),
  quoteLinesInternal: (u: Who) => data.quote_lines.filter((l) => canSeeQuoteCost(u, quoteById.get(l.quote_id)!)).map((l) => l.id),
  bidDecisions: (u: Who) => data.bid_decisions.filter((b) => canSeeBidDecision(u, oppById.get(b.opportunity_id)!)).map((b) => b.id),
  consultants: (u: Who) => (canSeeConsultantCost(u) ? data.consultants.map((c) => c.id) : []),
  consultantsPublic: (u: Who) => (canSeeBench(u) ? data.consultants.map((c) => c.id) : []),
  partnerVetting: (u: Who) => (canSeeVetting(u) ? data.partner_vetting.map((p) => p.id) : []),
  notifications: (u: Who) => data.notifications.filter((n) => n.user_id === u.id).map((n) => n.id),
  activities: (u: Who) => {
    const opps = data.opportunities.filter((o) => canSeeOpportunity(u, o));
    return data.activities
      .filter((a) => {
        if (a.related_type === "opportunity") {
          const o = oppById.get(a.related_id);
          return !!o && canSeeOpportunity(u, o);
        }
        if (!a.account_id) return true;
        return canSeeAccount(
          u,
          data.accounts.find((x) => x.id === a.account_id)!,
          opps,
        );
      })
      .map((a) => a.id);
  },
};

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];
function record(ok: boolean, name: string, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sameSet = (a: string[], b: string[]) => {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

interface PgError {
  code?: string;
  message: string;
}

class Session {
  constructor(
    private client: Client,
    readonly label: string,
    private userId: string | null,
    private dbRole: "authenticated" | "anon" = "authenticated",
  ) {}

  /** Runs fn inside a transaction as this user, always rolled back. */
  private async tx<T>(fn: () => Promise<T>): Promise<T> {
    await this.client.query("begin");
    try {
      await this.client.query(`set local role ${this.dbRole}`);
      await this.client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: this.userId, role: this.dbRole }),
      ]);
      return await fn();
    } finally {
      await this.client.query("rollback");
    }
  }

  async rows(sql: string, params: unknown[] = []) {
    return this.tx(async () => (await this.client.query(sql, params)).rows as Record<string, unknown>[]);
  }

  async ids(sql: string, params: unknown[] = []) {
    return (await this.rows(sql, params)).map((r) => String(r.id));
  }

  /** Executes and returns rowCount, or the error. */
  async exec(sql: string, params: unknown[] = []): Promise<{ rowCount: number } | { error: PgError }> {
    return this.tx(async () => {
      try {
        const r = await this.client.query(sql, params);
        return { rowCount: r.rowCount ?? 0 };
      } catch (e) {
        return { error: e as PgError };
      }
    });
  }

  async expectIds(name: string, sql: string, expected: string[]) {
    try {
      const got = await this.ids(sql);
      record(sameSet(got, expected), `${this.label}: ${name} (${expected.length} rows)`, sameSet(got, expected) ? "" : `got ${got.length}`);
    } catch (e) {
      record(false, `${this.label}: ${name}`, (e as PgError).message);
    }
  }

  async expectError(name: string, sql: string, params: unknown[] = [], code = "42501") {
    const r = await this.exec(sql, params);
    if ("error" in r) {
      record(r.error.code === code, `${this.label}: ${name} → error ${r.error.code}`, r.error.code === code ? "" : r.error.message);
    } else {
      record(false, `${this.label}: ${name}`, `expected error ${code}, got rowCount ${r.rowCount}`);
    }
  }

  async expectRowCount(name: string, sql: string, params: unknown[], expected: number) {
    const r = await this.exec(sql, params);
    if ("error" in r) record(false, `${this.label}: ${name}`, r.error.message);
    else record(r.rowCount === expected, `${this.label}: ${name} (${expected} rows)`, `got ${r.rowCount}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required (a superuser connection, e.g. postgres://postgres:postgres@localhost:5432/postgres)");

  const dbName = `konnector_rls_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  const testUrl = new URL(url);
  testUrl.pathname = `/${dbName}`;
  const client = new Client({ connectionString: testUrl.toString() });

  try {
    await client.connect();
    await client.query("set client_min_messages = warning");
    console.log(`Database ${dbName}`);

    // 1. Bootstrap, migrations, seed
    await client.query(BOOTSTRAP);
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files) {
      try {
        await client.query(readFileSync(join(MIGRATIONS, f), "utf8"));
      } catch (e) {
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
      console.log(`applied ${f}`);
    }
    await client.query(readFileSync(SEED_SQL, "utf8"));
    console.log("loaded seed.sql\n");

    // An audit entry so "cannot read audit_log" is meaningful.
    await client.query(
      `insert into public.audit_log (org_id, actor_id, action, entity, entity_id, before, after)
       values ($1, $2, 'update', 'opportunities', $3, '{}'::jsonb, '{"stage":"proposal"}'::jsonb)`,
      [data.organizations[0].id, SEED_USERS.admin, data.opportunities[0].id],
    );

    // 2. Schema contract and RLS coverage
    console.log("Schema");
    const tables = (
      await client.query(
        `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`,
      )
    ).rows as { relname: string; relrowsecurity: boolean }[];
    const expectedTables = Object.keys(data).sort();
    record(
      sameSet(
        tables.map((t) => t.relname),
        expectedTables,
      ),
      `public tables match types.ts Tables (${expectedTables.length})`,
      tables.map((t) => t.relname).join(","),
    );
    const noRls = tables.filter((t) => !t.relrowsecurity).map((t) => t.relname);
    record(noRls.length === 0, "RLS enabled on every table", noRls.join(", "));
    const leaky = (
      await client.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'v')
           and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
                or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))`,
      )
    ).rows.map((r) => r.relname as string);
    record(leaky.length === 0, "anon has no table privileges; authenticated cannot TRUNCATE", leaky.join(", "));
    const columns = (
      await client.query(
        `select table_name, array_agg(column_name::text) as cols from information_schema.columns
       where table_schema = 'public' group by table_name`,
      )
    ).rows as { table_name: string; cols: string[] }[];
    const colMap = new Map(columns.map((c) => [c.table_name, c.cols]));
    const drift: string[] = [];
    for (const t of Object.keys(data) as TableName[]) {
      const rows = data[t] as unknown as Record<string, unknown>[];
      if (!rows.length) continue;
      if (!sameSet(colMap.get(t) ?? [], Object.keys(rows[0]))) drift.push(t);
    }
    record(drift.length === 0, "columns match seed rows for every seeded table", drift.join(", "));
    const badCounts: string[] = [];
    for (const t of Object.keys(data) as TableName[]) {
      const n = Number((await client.query(`select count(*) from public.${t}`)).rows[0].count);
      const want = data[t].length + (t === "audit_log" ? 1 : 0);
      if (n !== want) badCounts.push(`${t}: ${n} vs ${want}`);
    }
    record(badCounts.length === 0, "seed.sql row counts match buildSeed()", badCounts.join("; "));

    // Superuser cannot rewrite history either (trigger, not just grants).
    {
      await client.query("begin");
      try {
        await client.query("update public.audit_log set action = 'tampered'");
        record(false, "audit_log trigger blocks UPDATE even for the table owner");
      } catch (e) {
        record((e as PgError).code === "42501", "audit_log trigger blocks UPDATE even for the table owner");
      } finally {
        await client.query("rollback");
      }
    }

    const sessions = {
      admin: new Session(client, "admin (Olugbenga)", SEED_USERS.admin),
      exec: new Session(client, "executive (Adaeze)", SEED_USERS.exec),
      bd1: new Session(client, "bd (Marcus)", SEED_USERS.bd1),
      bd2: new Session(client, "bd (Priya)", SEED_USERS.bd2),
      delivery: new Session(client, "delivery_lead (Lara)", SEED_USERS.delivery),
      recruiter: new Session(client, "recruiter (Tiara)", SEED_USERS.recruiter),
    };

    // 3. Read matrix for every seeded user, against the JS rules
    for (const [key, s] of Object.entries(sessions) as [keyof typeof sessions, Session][]) {
      const u = who(SEED_USERS[key]);
      console.log(`\n${s.label} — role ${u.role}`);
      await s.expectIds("opportunities = canSeeOpportunity", "select id from opportunities", expect.opportunities(u));
      await s.expectIds("accounts = canSeeAccount", "select id from accounts", expect.accounts(u));
      await s.expectIds("quotes follow their opportunity", "select id from quotes", expect.quotes(u));
      await s.expectIds("quote_lines_client follows the quote", "select id from quote_lines_client", expect.quoteLinesClient(u));
      await s.expectIds("quote_lines_internal = canSeeQuoteCost", "select id from quote_lines_internal", expect.quoteLinesInternal(u));
      await s.expectIds("bid_decisions = canSeeBidDecision", "select id from bid_decisions", expect.bidDecisions(u));
      await s.expectIds("consultants table = canSeeConsultantCost", "select id from consultants", expect.consultants(u));
      await s.expectIds("consultants_public = canSeeBench", "select id from consultants_public", expect.consultantsPublic(u));
      await s.expectIds("partner_vetting = canSeeVetting", "select id from partner_vetting", expect.partnerVetting(u));
      await s.expectIds("notifications = own only", "select id from notifications", expect.notifications(u));
      await s.expectIds("activities follow record visibility", "select id from activities", expect.activities(u));
      await s.expectIds(
        "users: all internal users",
        "select id from users",
        data.users.map((x) => x.id),
      );
      await s.expectIds(
        "registrations: all",
        "select id from registrations",
        data.registrations.map((x) => x.id),
      );
      const auditRows = (await s.rows("select count(*)::int as n from audit_log"))[0].n as number;
      record(
        canViewAudit(u) ? auditRows === 1 : auditRows === 0,
        `${s.label}: audit_log readable = canViewAudit (${canViewAudit(u)})`,
        `got ${auditRows}`,
      );
      await s.expectError("select quote_lines.unit_cost directly → permission denied", "select unit_cost from quote_lines");
      await s.expectError("update audit_log", "update audit_log set action = 'x'");
      await s.expectError("delete audit_log", "delete from audit_log");
    }

    // 4. Named scenarios
    const { bd1, bd2, exec, admin: adminS, delivery, recruiter } = sessions;
    const oppByName = (name: string) => data.opportunities.find((o) => o.name === name)!;
    const dorMvs = oppByName("Motor Vehicle System Integration");
    const cdc = oppByName("Data Modernisation Staffing Recompete");
    const dorTax = oppByName("Taxpayer Portal Accessibility Remediation");
    const marcusQuote = data.quotes.find((q) => q.owner_id === SEED_USERS.bd1)!;
    const marcusBid = data.bid_decisions.find((b) => b.opportunity_id === dorMvs.id)!;

    console.log("\nbd (Marcus) — named checks");
    const bd1Opps = await bd1.rows("select owner_id, shared_with from opportunities");
    record(
      bd1Opps.length > 0 && bd1Opps.every((o) => o.owner_id === SEED_USERS.bd1 || (o.shared_with as string[]).includes(SEED_USERS.bd1)),
      `bd (Marcus): every visible opportunity is his own or shared (${bd1Opps.length})`,
    );
    await bd1.expectIds(
      "quote_lines_client for his quotes has rows",
      "select id from quote_lines_client",
      expect.quoteLinesClient(who(SEED_USERS.bd1)),
    );
    const clientCols = await bd1.rows("select * from quote_lines_client limit 1");
    record(clientCols.length === 1 && !("unit_cost" in clientCols[0]), "bd (Marcus): quote_lines_client has no unit_cost column");
    await bd1.expectIds("bid decision on DOR MVS (his) is readable", `select id from bid_decisions where opportunity_id = '${dorMvs.id}'`, [
      marcusBid.id,
    ]);
    await bd1.expectIds(
      "bid decision on CDC (executive's) is hidden",
      `select id from bid_decisions where opportunity_id = '${cdc.id}'`,
      [],
    );
    await bd1.expectIds("consultants: nothing at all", "select id from consultants union all select id from consultants_public", []);
    await bd1.expectIds("partner_vetting: 0 rows", "select id from partner_vetting", []);
    await bd1.expectIds("audit_log: 0 rows", "select id from audit_log", []);
    await bd1.expectIds("another user's notifications: 0 rows", `select id from notifications where user_id = '${SEED_USERS.exec}'`, []);
    await bd1.expectRowCount("can update his own opportunity", "update opportunities set next_step = 'x' where id = $1", [dorMvs.id], 1);
    await bd1.expectRowCount("cannot update Priya's opportunity", "update opportunities set next_step = 'x' where id = $1", [dorTax.id], 0);
    await bd1.expectError("cannot approve his own bid decision", "update bid_decisions set status = 'approved' where id = $1", [
      marcusBid.id,
    ]);
    await bd1.expectError("cannot log an activity as someone else", insertActivity, [SEED_USERS.exec, dorMvs.id, dorMvs.account_id]);
    await bd1.expectRowCount("can log an activity as himself", insertActivity, [SEED_USERS.bd1, dorMvs.id, dorMvs.account_id], 1);
    await bd1.expectRowCount(
      "can append to audit_log as himself",
      "insert into audit_log (org_id, actor_id, action, entity, entity_id) values ($1, $2, 'view', 'opportunities', $3)",
      [data.organizations[0].id, SEED_USERS.bd1, dorMvs.id],
      1,
    );
    await bd1.expectRowCount(
      "can add a quote line (with cost) to his quote",
      "insert into quote_lines (quote_id, position, item, qty, unit_cost, unit_price) values ($1, 99, 'Test', 1, 10, 20)",
      [marcusQuote.id],
      1,
    );
    await bd1.expectError(
      "…but cannot read the cost back via RETURNING",
      "insert into quote_lines (quote_id, position, item, qty, unit_cost, unit_price) values ($1, 99, 'Test', 1, 10, 20) returning unit_cost",
      [marcusQuote.id],
    );
    await bd1.expectError("cannot create a handoff", "insert into handoffs (opportunity_id) values ($1)", [dorMvs.id]);

    console.log("\nbd (Priya) — shared opportunity");
    await bd2.expectIds("sees DOR MVS through shared_with", `select id from opportunities where id = '${dorMvs.id}'`, [dorMvs.id]);
    await bd2.expectRowCount("can edit the shared opportunity", "update opportunities set next_step = 'x' where id = $1", [dorMvs.id], 1);
    await bd2.expectIds("but not its bid decision (owner only)", `select id from bid_decisions where opportunity_id = '${dorMvs.id}'`, []);

    console.log("\nexecutive / admin — named checks");
    for (const s of [exec, adminS]) {
      await s.expectIds(
        "all opportunities",
        "select id from opportunities",
        data.opportunities.map((o) => o.id),
      );
      const costs = await s.rows("select unit_cost, margin_pct from quote_lines_internal");
      record(
        costs.length === data.quote_lines.length && costs.every((r) => r.unit_cost !== null),
        `${s.label}: unit_cost + margin for all ${data.quote_lines.length} quote lines (quote_lines_internal)`,
      );
      const rates = await s.rows("select rate_cost from consultants where rate_cost is not null");
      record(
        rates.length === data.consultants.filter((c) => c.rate_cost !== null).length && rates.length > 0,
        `${s.label}: consultants.rate_cost readable (${rates.length})`,
      );
      await s.expectRowCount("can approve a bid decision", "update bid_decisions set status = 'approved' where id = $1", [marcusBid.id], 1);
    }
    await adminS.expectIds(
      "admin reads audit_log",
      "select id from audit_log where actor_id is not null",
      (await client.query("select id from audit_log")).rows.map((r) => r.id as string),
    );

    console.log("\nrecruiter — named checks");
    const recOpps = await recruiter.rows("select kind from opportunities");
    record(
      recOpps.length === data.opportunities.filter((o) => o.kind === "staffing_placement").length &&
        recOpps.every((o) => o.kind === "staffing_placement"),
      `recruiter (Tiara): only staffing_placement opportunities (${recOpps.length})`,
    );
    const recRates = await recruiter.rows("select rate_cost from consultants where rate_cost is not null");
    record(recRates.length > 0, `recruiter (Tiara): consultants with rate_cost (${recRates.length})`);
    await recruiter.expectRowCount("can update the bench", "update consultants set status = status", [], data.consultants.length);

    console.log("\ndelivery_lead — named checks");
    await delivery.expectIds(
      "all opportunities",
      "select id from opportunities",
      data.opportunities.map((o) => o.id),
    );
    await delivery.expectIds(
      "consultants_public: whole bench",
      "select id from consultants_public",
      data.consultants.map((c) => c.id),
    );
    const pubCols = await delivery.rows("select * from consultants_public limit 1");
    record(pubCols.length === 1 && !("rate_cost" in pubCols[0]), "delivery_lead (Lara): consultants_public has no rate_cost column");
    await delivery.expectIds("consultants table (rate_cost) → 0 rows", "select id from consultants where rate_cost is not null", []);
    await delivery.expectIds(
      "handoffs: all",
      "select id from handoffs",
      data.handoffs.map((h) => h.id),
    );
    await delivery.expectRowCount("can create a handoff (wizard)", "insert into handoffs (opportunity_id) values ($1)", [dorMvs.id], 1);
    await delivery.expectError("cannot update a handoff (service role only)", "update handoffs set status = 'failed'");
    await delivery.expectError("cannot write project_health (service role only)", "update project_health set percent_complete = 0");
    await delivery.expectError(
      "cannot write integration_events (service role only)",
      "insert into integration_events (direction, event, idempotency_key) values ('inbound', 'x', 'y')",
    );
    await adminS.expectError("cannot delete client_items (withdraw instead)", "delete from client_items");
    await adminS.expectError("cannot TRUNCATE opportunities", "truncate opportunities cascade");

    console.log("\nanon");
    const anon = new Session(client, "anon", null, "anon");
    await anon.expectError("cannot read opportunities", "select id from opportunities");
    await anon.expectError("cannot read quote_lines_client", "select id from quote_lines_client");
  } finally {
    await client.end().catch(() => undefined);
    if (process.env.KEEP_DB) console.log(`\nkept database ${dbName}`);
    else await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

const insertActivity = `insert into activities (org_id, type, subject, occurred_at, related_type, related_id, account_id, actor_id)
  values ((select id from organizations limit 1), 'note', 'RLS test', now(), 'opportunity', $2, $3, $1)`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
