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
  type Who,
} from "../src/lib/auth/permissions";
import { buildSeed, SEED_USERS } from "../src/lib/data/seed";
import type { TableName } from "../src/lib/domain/types";
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
const userById = new Map(data.users.map((u) => [u.id, u]));
const who = (id: string): Who => {
  const u = userById.get(id);
  if (!u?.role) throw new Error(`seed user ${id} missing or pending`);
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

  /** Runs several statements as this user in one transaction (always rolled back). */
  async inTx<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>): Promise<T> {
    return this.tx(() => fn(async (sql, params = []) => (await this.client.query(sql, params)).rows as Record<string, unknown>[]));
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

    // PI-2 tables have no seed rows, so check their columns against types.ts explicitly.
    {
      const pi2Drift = Object.entries(PI2_COLUMNS)
        .filter(([t, cols]) => !sameSet(colMap.get(t) ?? [], [...BASE_COLS, ...cols]))
        .map(([t]) => t);
      record(pi2Drift.length === 0, "PI-2 tables have exactly the columns in types.ts", pi2Drift.join(", "));
      record(
        sameSet(colMap.get("import_batches") ?? [], [...BASE_COLS, ...IMPORT_BATCH_COLUMNS]),
        "import_batches has exactly the columns in types.ts (ImportBatch)",
        (colMap.get("import_batches") ?? []).join(","),
      );
    }
    await client.query(
      PI2_FIXTURES.replaceAll("$1", `'${data.organizations[0].id}'`)
        .replaceAll("$2", `'${SEED_USERS.bd1}'`)
        .replaceAll("$3", `'${SEED_USERS.bd2}'`)
        .replaceAll("$4", `'${SEED_USERS.admin}'`),
    );
    await client.query(
      IMPORT_FIXTURES.replaceAll("$1", `'${data.organizations[0].id}'`)
        .replaceAll("$2", `'${SEED_USERS.bd1}'`)
        .replaceAll("$3", `'${SEED_USERS.bd2}'`),
    );
    // KCRM-69: someone who signed in from the domain but has no role yet (as the auth callback creates them).
    await client.query(
      `insert into auth.users (id, email) values ($1, 'new.starter@konnectorllc.com');
       insert into public.users (id, org_id, email, full_name, title, role, avatar_color)
       values ($1, $2, 'new.starter@konnectorllc.com', 'New Starter', '', null, '#0075FF')`
        .replaceAll("$1", `'${PENDING_USER}'`)
        .replaceAll("$2", `'${data.organizations[0].id}'`),
    );
    {
      const missing = (
        await client.query(
          `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                             and p.permissive = 'RESTRICTIVE' and p.policyname = c.relname || '_active_user_only')`,
        )
      ).rows.map((r) => r.relname as string);
      record(
        missing.length === 0,
        "every table has a restrictive <table>_active_user_only policy (pending users see nothing)",
        missing.join(", "),
      );
    }

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
      await s.expectIds("users: all internal users (including pending)", "select id from users", [
        ...data.users.map((x) => x.id),
        PENDING_USER,
      ]);
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
      await pi2Checks(s, u);
      await importChecks(s, u);
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

    await pendingChecks(client);
    await rateLimitChecks(client, sessions);
    await dedupeChecks(client, sessions, colMap);

    console.log("\nanon");
    const anon = new Session(client, "anon", null, "anon");
    await anon.expectError("cannot read opportunities", "select id from opportunities");
    await anon.expectError("cannot read quote_lines_client", "select id from quote_lines_client");
    await anon.expectError("cannot read api_keys", "select id from api_keys");
    await anon.expectError("cannot read webhook_subscriptions", "select id from webhook_subscriptions");

    console.log("\nservice_role — PI-2 secrets");
    {
      await client.query("begin");
      try {
        await client.query("set local role service_role");
        const r = await client.query(
          "select access_token_enc from mail_connections union all select key_hash from api_keys union all select secret_enc from webhook_subscriptions",
        );
        record(r.rowCount === 6, `service_role reads every secret column (${r.rowCount})`);
      } catch (e) {
        record(false, "service_role reads every secret column", (e as PgError).message);
      } finally {
        await client.query("rollback");
      }
    }
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

// ---------------------------------------------------------------------------
// PI-2: Copilot runs, mail sync, API keys, webhooks
// ---------------------------------------------------------------------------

const BASE_COLS = ["id", "created_at", "updated_at", "created_by", "archived_at"];
const PI2_COLUMNS: Record<string, string[]> = {
  copilot_runs: [
    "org_id",
    "user_id",
    "task",
    "related_type",
    "related_id",
    "model",
    "status",
    "input_tokens",
    "output_tokens",
    "latency_ms",
    "error",
  ],
  mail_connections: [
    "org_id",
    "user_id",
    "provider",
    "email",
    "status",
    "scopes",
    "access_token_enc",
    "refresh_token_enc",
    "token_expires_at",
    "last_synced_at",
    "sync_cursor",
    "last_error",
  ],
  synced_messages: [
    "connection_id",
    "user_id",
    "provider_message_id",
    "kind",
    "direction",
    "subject",
    "from_address",
    "to_addresses",
    "occurred_at",
    "activity_id",
    "account_id",
    "contact_id",
  ],
  api_keys: ["org_id", "user_id", "name", "prefix", "key_hash", "scopes", "last_used_at", "expires_at", "revoked_at"],
  webhook_subscriptions: ["org_id", "url", "description", "events", "secret_enc", "active"],
  webhook_deliveries: [
    "subscription_id",
    "event",
    "event_id",
    "payload",
    "status",
    "attempts",
    "response_status",
    "last_error",
    "next_attempt_at",
  ],
};

/** Fixed ids for the PI-2 fixture rows (inserted by the superuser; seed has none). */
const F = {
  runBd1: "a2000000-0000-4000-8000-000000000001",
  runBd2: "a2000000-0000-4000-8000-000000000002",
  mailBd1: "a2000000-0000-4000-8000-000000000011",
  mailBd2: "a2000000-0000-4000-8000-000000000012",
  msgBd1: "a2000000-0000-4000-8000-000000000021",
  msgBd2: "a2000000-0000-4000-8000-000000000022",
  keyBd1: "a2000000-0000-4000-8000-000000000031",
  keyBd2: "a2000000-0000-4000-8000-000000000032",
  keyAdmin: "a2000000-0000-4000-8000-000000000033",
  hook: "a2000000-0000-4000-8000-000000000041",
  delivery: "a2000000-0000-4000-8000-000000000051",
};
const HASH = (n: number) => String(n).repeat(64).slice(0, 64);

const PI2_FIXTURES = `
insert into copilot_runs (id, org_id, user_id, task, model, status) values
  ('${F.runBd1}', $1, $2, 'account_summary', 'demo', 'demo'),
  ('${F.runBd2}', $1, $3, 'followup_email', 'demo', 'demo');
insert into mail_connections (id, org_id, user_id, provider, email, access_token_enc, refresh_token_enc) values
  ('${F.mailBd1}', $1, $2, 'google', 'marcus@konnectorllc.com', 'v1.secret', 'v1.secret'),
  ('${F.mailBd2}', $1, $3, 'microsoft', 'priya@konnectorllc.com', 'v1.secret', 'v1.secret');
insert into synced_messages (id, connection_id, user_id, provider_message_id, kind, direction, subject, occurred_at) values
  ('${F.msgBd1}', '${F.mailBd1}', $2, 'm-1', 'email', 'inbound', 'Hello', now()),
  ('${F.msgBd2}', '${F.mailBd2}', $3, 'm-2', 'event', 'outbound', 'Kickoff', now());
insert into api_keys (id, org_id, user_id, name, prefix, key_hash, scopes) values
  ('${F.keyBd1}', $1, $2, 'Marcus laptop', 'aaaaaaaa', '${HASH(1)}', '{read}'),
  ('${F.keyBd2}', $1, $3, 'Priya sheet', 'bbbbbbbb', '${HASH(2)}', '{read,write}'),
  ('${F.keyAdmin}', $1, $4, 'Admin', 'cccccccc', '${HASH(3)}', '{read,write}');
insert into webhook_subscriptions (id, org_id, url, events, secret_enc) values
  ('${F.hook}', $1, 'https://accounting.example.com/hooks', '{account.created}', 'v1.secret');
insert into webhook_deliveries (id, subscription_id, event, event_id, payload) values
  ('${F.delivery}', '${F.hook}', 'account.created', gen_random_uuid(), '{}');
`;

const OWN: Record<string, { run?: string; mail?: string; msg?: string; key?: string }> = {
  [SEED_USERS.bd1]: { run: F.runBd1, mail: F.mailBd1, msg: F.msgBd1, key: F.keyBd1 },
  [SEED_USERS.bd2]: { run: F.runBd2, mail: F.mailBd2, msg: F.msgBd2, key: F.keyBd2 },
  [SEED_USERS.admin]: { key: F.keyAdmin },
};

/** Per-role PI-2 assertions. Every write runs in a rolled-back transaction. */
async function pi2Checks(s: Session, u: Who) {
  const leader = u.role === "admin" || u.role === "executive";
  const admin = u.role === "admin";
  const own = OWN[u.id] ?? {};
  const org = data.organizations[0].id;
  const other = u.id === SEED_USERS.bd1 ? SEED_USERS.bd2 : SEED_USERS.bd1;
  const ownOr = (id: string | undefined, all: string[]) => (leader ? all : id ? [id] : []);

  // copilot_runs: own + leaders; insert as self only; no update/delete.
  await s.expectIds("copilot_runs = own (leaders: all)", "select id from copilot_runs", ownOr(own.run, [F.runBd1, F.runBd2]));
  await s.expectRowCount(
    "copilot_runs: insert as self",
    "insert into copilot_runs (org_id, user_id, task, model, status) values ($1, $2, 'rfp_checklist', 'demo', 'demo')",
    [org, u.id],
    1,
  );
  await s.expectError(
    "copilot_runs: insert as someone else",
    "insert into copilot_runs (org_id, user_id, task, model, status) values ($1, $2, 'rfp_checklist', 'demo', 'demo')",
    [org, other],
  );
  await s.expectError("copilot_runs: update", "update copilot_runs set status = 'error'");
  await s.expectError("copilot_runs: delete", "delete from copilot_runs");

  // mail_connections: own row only, tokens never selectable, no inserts.
  await s.expectIds(
    "mail_connections (non-secret columns) = own only",
    "select id, email, status, scopes from mail_connections",
    own.mail ? [own.mail] : [],
  );
  await s.expectError("mail_connections.access_token_enc → permission denied", "select access_token_enc from mail_connections");
  await s.expectError("mail_connections.refresh_token_enc → permission denied", "select refresh_token_enc from mail_connections");
  await s.expectError("mail_connections select * → permission denied", "select * from mail_connections");
  await s.expectError(
    "mail_connections: insert (service role only)",
    "insert into mail_connections (org_id, user_id, provider, email) values ($1, $2, 'google', 'x@konnectorllc.com')",
    [org, u.id],
  );
  await s.expectRowCount(
    "mail_connections: disconnect own (status + tokens nulled)",
    "update mail_connections set status = 'revoked', access_token_enc = null, refresh_token_enc = null where user_id = $1",
    [u.id],
    own.mail ? 1 : 0,
  );
  await s.expectRowCount(
    "mail_connections: cannot touch others' rows",
    "update mail_connections set status = 'error' where user_id <> $1",
    [u.id],
    0,
  );
  await s.expectRowCount("mail_connections: cannot delete others' rows", "delete from mail_connections where user_id <> $1", [u.id], 0);

  // synced_messages: own + leaders; read-only.
  await s.expectIds("synced_messages = own (leaders: all)", "select id from synced_messages", ownOr(own.msg, [F.msgBd1, F.msgBd2]));
  await s.expectError("synced_messages: update (service role only)", "update synced_messages set subject = 'x'");
  await s.expectError(
    "synced_messages: insert (service role only)",
    `insert into synced_messages (connection_id, user_id, provider_message_id, kind, direction, subject, occurred_at)
     values ('${F.mailBd1}', $1, 'x', 'email', 'inbound', 'x', now())`,
    [u.id],
  );

  // api_keys: own (admin: all), key_hash never selectable, revoke = update own.
  await s.expectIds(
    "api_keys = own (admin: all)",
    "select id, prefix, scopes, revoked_at from api_keys",
    admin ? [F.keyBd1, F.keyBd2, F.keyAdmin] : own.key ? [own.key] : [],
  );
  await s.expectError("api_keys.key_hash → permission denied", "select key_hash from api_keys");
  await s.expectError("api_keys select * → permission denied", "select * from api_keys");
  await s.expectRowCount(
    "api_keys: create own key",
    "insert into api_keys (org_id, user_id, name, prefix, key_hash, scopes) values ($1, $2, 'test', 'zzzzzzzz', $3, '{read}')",
    [org, u.id, HASH(9)],
    1,
  );
  await s.expectError(
    "api_keys: create a key for someone else",
    "insert into api_keys (org_id, user_id, name, prefix, key_hash, scopes) values ($1, $2, 'test', 'yyyyyyyy', $3, '{read}')",
    [org, other, HASH(8)],
  );
  await s.expectRowCount("api_keys: revoke own", "update api_keys set revoked_at = now() where user_id = $1", [u.id], own.key ? 1 : 0);
  await s.expectRowCount("api_keys: cannot revoke others'", "update api_keys set revoked_at = now() where user_id <> $1", [u.id], 0);
  await s.expectError("api_keys: cannot rewrite key_hash", "update api_keys set key_hash = $1", [HASH(7)]);
  await s.expectError("api_keys: no delete (revoke instead)", "delete from api_keys");

  // webhooks: admin only; secret_enc never selectable.
  await s.expectIds(
    "webhook_subscriptions = admin only",
    "select id, url, events, active from webhook_subscriptions",
    admin ? [F.hook] : [],
  );
  await s.expectIds("webhook_deliveries = admin only", "select id from webhook_deliveries", admin ? [F.delivery] : []);
  await s.expectError("webhook_subscriptions.secret_enc → permission denied", "select secret_enc from webhook_subscriptions");
  const insertHook =
    "insert into webhook_subscriptions (org_id, url, events, secret_enc) values ($1, 'https://x.example.com', '{account.updated}', 'v1.x')";
  if (admin) {
    await s.expectRowCount("webhook_subscriptions: admin creates", insertHook, [org], 1);
    await s.expectRowCount("webhook_subscriptions: admin disables", "update webhook_subscriptions set active = false", [], 1);
    await s.expectRowCount("webhook_deliveries: admin deletes", "delete from webhook_deliveries", [], 1);
  } else {
    await s.expectError("webhook_subscriptions: insert (admin only)", insertHook, [org]);
    await s.expectRowCount("webhook_subscriptions: update (admin only)", "update webhook_subscriptions set active = false", [], 0);
    await s.expectRowCount("webhook_deliveries: delete (admin only)", "delete from webhook_deliveries", [], 0);
  }
}

// ---------------------------------------------------------------------------
// KCRM-75/76: import batches — read own (leaders: all), undo own (leaders: any) within 7 days
// ---------------------------------------------------------------------------

const IMPORT_BATCH_COLUMNS = [
  "org_id",
  "user_id",
  "entity",
  "file_name",
  "status",
  "total_rows",
  "created_count",
  "skipped_count",
  "error_count",
  "created_ids",
  "undone_at",
  "undone_by",
];

const IB = {
  bd1: "a7500000-0000-4000-8000-000000000001",
  bd2: "a7500000-0000-4000-8000-000000000002",
  bd1Old: "a7500000-0000-4000-8000-000000000003",
};

const IMPORT_FIXTURES = `
insert into import_batches (id, org_id, user_id, entity, file_name, total_rows, created_count, created_at) values
  ('${IB.bd1}', $1, $2, 'contacts', 'contacts.csv', 3, 2, now() - interval '1 day'),
  ('${IB.bd2}', $1, $3, 'opportunities', 'pipeline.csv', 5, 5, now() - interval '2 days'),
  ('${IB.bd1Old}', $1, $2, 'contacts', 'old.csv', 1, 1, now() - interval '8 days');
`;

/** Per-role import_batches assertions (KCRM-75/76), mirroring canImport / canUndoImport. */
async function importChecks(s: Session, u: Who) {
  const leader = u.role === "admin" || u.role === "executive";
  const org = data.organizations[0].id;
  const other = u.id === SEED_USERS.bd1 ? SEED_USERS.bd2 : SEED_USERS.bd1;
  const own = u.id === SEED_USERS.bd1 ? [IB.bd1, IB.bd1Old] : u.id === SEED_USERS.bd2 ? [IB.bd2] : [];
  await s.expectIds("import_batches = own (leaders: all)", "select id from import_batches", leader ? Object.values(IB) : own);

  const insert = (entity: string) =>
    `insert into import_batches (org_id, user_id, entity, file_name) values ($1, $2, '${entity}', 'x.csv')`;
  const canContacts = leader || u.role === "bd";
  const canPipeline = canContacts || u.role === "recruiter";
  if (canContacts) await s.expectRowCount("import_batches: record a contacts import as self", insert("contacts"), [org, u.id], 1);
  else await s.expectError("import_batches: contacts import (bd/leaders only)", insert("contacts"), [org, u.id]);
  if (canPipeline) await s.expectRowCount("import_batches: record a pipeline import as self", insert("opportunities"), [org, u.id], 1);
  else await s.expectError("import_batches: pipeline import (bd/leaders/recruiters only)", insert("opportunities"), [org, u.id]);
  await s.expectError("import_batches: record an import as someone else", insert("contacts"), [org, other]);

  const undo = "update import_batches set status = 'undone', undone_at = now(), undone_by = $2 where id = $1";
  const ownRecent = u.id === SEED_USERS.bd1 ? IB.bd1 : u.id === SEED_USERS.bd2 ? IB.bd2 : null;
  if (ownRecent) await s.expectRowCount("import_batches: undo own recent import", undo, [ownRecent, u.id], 1);
  const othersRecent = u.id === SEED_USERS.bd1 ? IB.bd2 : IB.bd1;
  await s.expectRowCount("import_batches: undo someone else's import (leaders only)", undo, [othersRecent, u.id], leader ? 1 : 0);
  await s.expectRowCount("import_batches: undo after 7 days → refused", undo, [IB.bd1Old, u.id], 0);
  if (ownRecent || leader) await s.expectError("import_batches: undo recorded as someone else", undo, [ownRecent ?? IB.bd1, other]);
  await s.expectError("import_batches: cannot rewrite created_ids", "update import_batches set created_ids = '{}'::jsonb");
  await s.expectError("import_batches: no delete", "delete from import_batches");
}

// ---------------------------------------------------------------------------
// KCRM-69: pending access (role null) — nothing visible, nothing writable
// ---------------------------------------------------------------------------

const PENDING_USER = "a6900000-0000-4000-8000-000000000001";

async function pendingChecks(client: Client) {
  console.log("\npending (New Starter) — no role yet");
  const pending = new Session(client, "pending (New Starter)", PENDING_USER);
  const relations = (
    await client.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v') order by 1`,
    )
  ).rows.map((r) => r.relname as string);
  const leaks: string[] = [];
  for (const rel of relations) {
    const r = await pending.exec(`select count(*) from public.${rel} where ${rel === "users" ? `id <> '${PENDING_USER}'` : "true"}`);
    if ("error" in r) {
      if (r.error.code !== "42501") leaks.push(`${rel}: ${r.error.message}`);
      continue;
    }
    const n = Number(
      (await pending.rows(`select count(*)::int as n from public.${rel}${rel === "users" ? ` where id <> '${PENDING_USER}'` : ""}`))[0].n,
    );
    if (n !== 0) leaks.push(`${rel}: ${n}`);
  }
  record(leaks.length === 0, `${pending.label}: 0 rows in all ${relations.length} tables and views`, leaks.join("; "));
  await pending.expectIds("users: only their own row", "select id from users", [PENDING_USER]);
  const flags = (
    await pending.rows(
      "select public.is_active_user() as active, public.has_role('admin','executive','bd','delivery_lead','recruiter') as any_role",
    )
  )[0];
  record(flags.active === false && flags.any_role === false, `${pending.label}: is_active_user() and has_role() are false`);
  await pending.expectRowCount("cannot give themselves a role", "update users set role = 'admin' where id = $1", [PENDING_USER], 0);
  await pending.expectError(
    "cannot add a tag (tags_insert is open to every user)",
    "insert into tags (org_id, name) values ((select org_id from users where id = $1), 'x')",
    [PENDING_USER],
  );
  await pending.expectError(
    "cannot write the audit log",
    "insert into audit_log (org_id, actor_id, action, entity, entity_id) values ((select org_id from users where id = $1), $1, 'x', 'users', $1)",
    [PENDING_USER],
  );
  await pending.expectError(
    "cannot raise notifications",
    "insert into notifications (user_id, kind, title, created_by) values ($1, 'alert', 'x', $1)",
    [SEED_USERS.admin],
  );

  console.log("\nrole assignment — admin only");
  const admin = new Session(client, "admin (Olugbenga)", SEED_USERS.admin);
  const exec = new Session(client, "executive (Adaeze)", SEED_USERS.exec);
  await admin.expectRowCount("admin assigns a role to a pending user", "update users set role = 'bd' where id = $1", [PENDING_USER], 1);
  await exec.expectRowCount("executive cannot assign roles", "update users set role = 'bd' where id = $1", [PENDING_USER], 0);
  await admin.expectError("role must be a known role", "update users set role = 'owner' where id = $1", [PENDING_USER], "23514");
}

// ---------------------------------------------------------------------------
// KCRM-73: shared rate limiter — service role only
// ---------------------------------------------------------------------------

async function rateLimitChecks(client: Client, sessions: Record<string, Session>) {
  console.log("\nrate_limits — service role only");
  for (const s of Object.values(sessions)) {
    await s.expectError("rate_limits: select", "select id from rate_limits");
    await s.expectError(
      "rate_limits: insert",
      "insert into rate_limits (bucket, window_start, hits, expires_at) values ('x', now(), 0, now())",
    );
    await s.expectError("take_rate_limit(): execute", "select public.take_rate_limit('api:key:x', 120, 60, now())");
  }
  const anon = new Session(client, "anon", null, "anon");
  await anon.expectError("take_rate_limit(): execute", "select public.take_rate_limit('api:key:x', 120, 60, now())");

  await client.query("begin");
  try {
    await client.query("set local role service_role");
    const take = async (at: string) =>
      Number((await client.query("select public.take_rate_limit('test:bucket', 2, 60, $1::timestamptz) as n", [at])).rows[0].n);
    const seq = [
      await take("2026-10-12T15:00:05Z"),
      await take("2026-10-12T15:00:30Z"),
      await take("2026-10-12T15:00:59Z"),
      await take("2026-10-12T15:00:59.9Z"),
    ];
    record(JSON.stringify(seq) === "[1,2,3,3]", "service_role: take_rate_limit counts to the limit, then refuses (limit + 1)", String(seq));
    const rows = (await client.query("select hits, window_start, expires_at from rate_limits where bucket = 'test:bucket'")).rows;
    record(
      rows.length === 1 &&
        rows[0].hits === 2 &&
        new Date(rows[0].window_start).toISOString() === "2026-10-12T15:00:00.000Z" &&
        new Date(rows[0].expires_at).toISOString() === "2026-10-12T15:01:00.000Z",
      "service_role: one row per bucket+window, counter capped at the limit",
      JSON.stringify(rows),
    );
    record((await take("2026-10-12T15:01:00Z")) === 1, "service_role: next window starts again at 1");
    record((await take("2026-10-12T15:01:00Z")) === 2 && (await take("2026-10-12T15:01:01Z")) === 3, "service_role: …and fills up again");
    await take("2026-10-12T17:00:00Z");
    const left = Number((await client.query("select count(*)::int as n from rate_limits where bucket = 'test:bucket'")).rows[0].n);
    record(left === 1, "service_role: expired windows for the bucket are cleaned up", `got ${left}`);
  } catch (e) {
    record(false, "service_role: take_rate_limit", (e as PgError).message);
  } finally {
    await client.query("rollback");
  }
}

// ---------------------------------------------------------------------------
// KCRM-77: duplicate_dismissals + merge_accounts() / merge_contacts() — leaders only
// ---------------------------------------------------------------------------

const DISMISSAL = "a7700000-0000-4000-8000-000000000001";

async function dedupeChecks(client: Client, sessions: Record<string, Session>, colMap: Map<string, string[]>) {
  console.log("\nduplicates — dismissals and merge functions (leaders only)");
  const org = data.organizations[0].id;
  const acct = (name: string) => data.accounts.find((a) => a.name === name)!.id;
  const contact = (first: string, last: string) => data.contacts.find((x) => x.first_name === first && x.last_name === last)!.id;
  const harbor = acct("Harborline Logistics");
  const harborDup = acct("Harborline Logistics, Inc.");
  const sam = contact("Sam", "Porter");
  const samuel = contact("Samuel", "Porter");
  const [pa, pb] = [acct("Georgia Technology Authority"), acct("Georgia Department of Revenue")].sort();

  record(
    sameSet(colMap.get("duplicate_dismissals") ?? [], [...BASE_COLS, "org_id", "entity", "record_a", "record_b", "dismissed_by", "note"]),
    "duplicate_dismissals has exactly the columns in types.ts",
  );
  await client.query(
    `insert into duplicate_dismissals (id, org_id, entity, record_a, record_b, dismissed_by) values ($1, $2, 'accounts', $3, $4, $5)`,
    [DISMISSAL, org, pa, pb, SEED_USERS.exec],
  );

  const insertDismissal =
    "insert into duplicate_dismissals (org_id, entity, record_a, record_b, dismissed_by) values ($1, 'contacts', $2, $3, $4)";
  const [ca, cb] = [sam, samuel].sort();
  for (const [key, s] of Object.entries(sessions)) {
    const u = who(SEED_USERS[key as keyof typeof SEED_USERS]);
    const leader = u.role === "admin" || u.role === "executive";
    const other = u.id === SEED_USERS.admin ? SEED_USERS.exec : SEED_USERS.admin;
    await s.expectIds("duplicate_dismissals readable = leaders", "select id from duplicate_dismissals", leader ? [DISMISSAL] : []);
    if (leader) {
      await s.expectRowCount("duplicate_dismissals: insert as self", insertDismissal, [org, ca, cb, u.id], 1);
      await s.expectError("duplicate_dismissals: insert as someone else", insertDismissal, [org, ca, cb, other]);
      await s.expectRowCount("duplicate_dismissals: delete (restore a pair)", "delete from duplicate_dismissals", [], 1);
      await s.expectError(
        "duplicate_dismissals: pair must be in canonical order",
        insertDismissal.replace("$2, $3", "$3, $2"),
        [org, ca, cb, u.id],
        "23514",
      );
    } else {
      await s.expectError("duplicate_dismissals: insert", insertDismissal, [org, ca, cb, u.id]);
      await s.expectRowCount("duplicate_dismissals: delete", "delete from duplicate_dismissals", [], 0);
    }
    await s.expectError("duplicate_dismissals: no update for anyone", "update duplicate_dismissals set note = 'x'");

    if (!leader) {
      await s.expectError("merge_accounts(): refused", "select public.merge_accounts($1, $2, '{}'::jsonb)", [harbor, harborDup]);
      await s.expectError("merge_contacts(): refused", "select public.merge_contacts($1, $2, '{}'::jsonb)", [sam, samuel]);
    }
  }
  // Priya owns the duplicate account and can edit it, but still may not merge.
  await sessions.bd2.expectError("bd (Priya) owns the duplicate yet merge_accounts() is refused", "select public.merge_accounts($1, $2)", [
    harborDup,
    harbor,
  ]);
  await new Session(client, "pending (New Starter)", PENDING_USER).expectIds(
    "duplicate_dismissals: 0 rows",
    "select id from duplicate_dismissals",
    [],
  );
  for (const s of [new Session(client, "pending (New Starter)", PENDING_USER), new Session(client, "anon", null, "anon")]) {
    await s.expectError("merge_accounts(): refused", "select public.merge_accounts($1, $2, '{}'::jsonb)", [harbor, harborDup]);
    await s.expectError("merge_contacts(): refused", "select public.merge_contacts($1, $2, '{}'::jsonb)", [sam, samuel]);
  }
  const anon = new Session(client, "anon", null, "anon");
  await anon.expectError("duplicate_dismissals: select", "select id from duplicate_dismissals");

  // Leaders: one transaction re-points everything, archives the loser, writes timeline + audit.
  for (const s of [sessions.admin, sessions.exec]) {
    try {
      const out = await s.inTx(async (q) => {
        const [{ r }] = await q("select public.merge_accounts($1, $2, $3::jsonb) as r", [
          harbor,
          harborDup,
          JSON.stringify({ website: "https://www.harborline.example.com", org_id: "ignored" }),
        ]);
        const [left] = await q(
          `select
             (select count(*)::int from contacts where account_id = $1) as contacts,
             (select count(*)::int from opportunities where account_id = $1) as opps,
             (select count(*)::int from activities where account_id = $1 or (related_type = 'account' and related_id = $1)) as acts,
             (select archived_at is not null from accounts where id = $1) as archived,
             (select website from accounts where id = $2) as website,
             (select count(*)::int from activities where related_id = $2 and subject like 'Merged "Harborline Logistics, Inc."%') as timeline`,
          [harborDup, harbor],
        );
        return { r: r as { repointed: Record<string, number> }, left };
      });
      record(
        out.left.contacts === 0 &&
          out.left.opps === 0 &&
          out.left.acts === 0 &&
          out.left.archived === true &&
          out.left.website === "https://www.harborline.example.com" &&
          out.left.timeline === 1 &&
          out.r.repointed.contacts === 2 &&
          out.r.repointed.opportunities === 1,
        `${s.label}: merge_accounts() re-points, archives the loser and logs the timeline`,
        JSON.stringify(out),
      );
    } catch (e) {
      record(false, `${s.label}: merge_accounts()`, (e as PgError).message);
    }
  }
  try {
    const audit = await sessions.admin.inTx(async (q) => {
      await q("select public.merge_accounts($1, $2)", [harbor, harborDup]);
      return q(
        "select actor_id, after ->> 'loser_id' as loser, after -> 'loser_snapshot' ->> 'name' as name from audit_log where action = 'account.merged'",
      );
    });
    record(
      audit.length === 1 &&
        audit[0].actor_id === SEED_USERS.admin &&
        audit[0].loser === harborDup &&
        audit[0].name === "Harborline Logistics, Inc.",
      "admin: merge_accounts() audits actor, loser id and loser snapshot",
      JSON.stringify(audit),
    );
  } catch (e) {
    record(false, "admin: merge_accounts() audit", (e as PgError).message);
  }
  {
    const r = await sessions.exec.inTx(async (q) => {
      await q("update accounts set konnect_hub_client_id = 'khc_a' where id = $1", [harbor]);
      await q("update accounts set konnect_hub_client_id = 'khc_b' where id = $1", [harborDup]);
      try {
        await q("select public.merge_accounts($1, $2)", [harbor, harborDup]);
        return "merged";
      } catch (e) {
        return (e as PgError).code;
      }
    });
    record(r === "23514", "executive: merge_accounts() refuses different Konnect Hub client ids", String(r));
  }
  try {
    const r = await sessions.exec.inTx(async (q) => {
      const [{ r }] = await q('select public.merge_contacts($1, $2, \'{"title":"Director of IT"}\'::jsonb) as r', [sam, samuel]);
      const [x] = await q(
        "select (select archived_at is not null from contacts where id = $1) as archived, (select title from contacts where id = $2) as title",
        [samuel, sam],
      );
      return { r, x };
    });
    record(
      r.x.archived === true && r.x.title === "Director of IT",
      "executive: merge_contacts() archives the loser and applies picks",
      JSON.stringify(r),
    );
  } catch (e) {
    record(false, "executive: merge_contacts()", (e as PgError).message);
  }
}

const insertActivity = `insert into activities (org_id, type, subject, occurred_at, related_type, related_id, account_id, actor_id)
  values ((select id from organizations limit 1), 'note', 'RLS test', now(), 'opportunity', $2, $3, $1)`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
