import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { canImport, canUndoImport } from "@/lib/auth/permissions";
import { seedIds } from "@/lib/data/seed";
import { CsvError, parseCsvRecords, parseCsvTable, toCsv } from "@/lib/import/csv";
import {
  domainOf,
  isRestrictedHeader,
  normalizeName,
  parseDate,
  parseMoney,
  parseStageHistory,
  suggestMapping,
  suggestStage,
  templateCsv,
} from "@/lib/import/fields";
import { updateContact } from "@/lib/services/core";
import { commitImport, importAccountsCsv, listImportBatches, previewImport, undoImport, type ImportRequestT } from "@/lib/services/imports";
import { asUser, switchUser } from "./helpers";

const ids = seedIds();

const contactsReq = (csv: string, extra: Partial<ImportRequestT> = {}): ImportRequestT => ({
  entity: "contacts",
  csv,
  file_name: "contacts.csv",
  mapping: suggestMapping("contacts", parseCsvTable(csv).headers),
  ...extra,
});
const pipelineReq = (csv: string, extra: Partial<ImportRequestT> = {}): ImportRequestT => ({
  entity: "opportunities",
  csv,
  file_name: "pipeline.csv",
  mapping: suggestMapping("opportunities", parseCsvTable(csv).headers),
  ...extra,
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("CSV parser", () => {
  it("handles quotes, escaped quotes, commas and newlines inside quotes", () => {
    const t = parseCsvTable('name,notes\n"Acme, Inc","Line 1\nLine 2 ""quoted"""\nPlain,x\n');
    expect(t.rows).toEqual([
      { name: "Acme, Inc", notes: 'Line 1\nLine 2 "quoted"' },
      { name: "Plain", notes: "x" },
    ]);
  });

  it("strips a BOM and accepts CRLF, CR and a missing final newline; skips blank lines", () => {
    const t = parseCsvTable("﻿name,city\r\nA,Atlanta\r\n\r\nB,Macon\rC,Athens");
    expect(t.headers).toEqual(["name", "city"]);
    expect(t.rows.map((r) => r.name)).toEqual(["A", "B", "C"]);
  });

  it("pads short rows, suffixes duplicate/blank headers, and keeps CRLF inside quotes", () => {
    const t = parseCsvTable('Email,email,\nx@y.com\n"a\r\nb",2,3\n');
    expect(t.headers).toEqual(["Email", "email (2)", "Column 3"]);
    expect(t.rows[0]).toEqual({ Email: "x@y.com", "email (2)": "", "Column 3": "" });
    expect(t.rows[1].Email).toBe("a\r\nb");
  });

  it("rejects unclosed quotes, empty files and files over the limits", () => {
    expect(() => parseCsvRecords('a,b\n"open,1\n')).toThrow(CsvError);
    expect(() => parseCsvTable("")).toThrow(/empty/);
    expect(() => parseCsvTable("h\n1\n2\n3\n", { rows: 2, bytes: 1000 })).toThrow(/3 rows; the limit is 2/);
    expect(() => parseCsvTable("h\n" + "x".repeat(50), { rows: 10, bytes: 20 })).toThrow(/larger than/);
  });

  it("round-trips through toCsv and the templates parse", () => {
    const rows = [
      ["a", "b,c"],
      ['say "hi"', "line\nbreak"],
    ];
    expect(parseCsvRecords(toCsv(rows))).toEqual(rows);
    for (const e of ["accounts", "contacts", "opportunities"] as const) expect(parseCsvTable(templateCsv(e)).rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Mapping + normalizers
// ---------------------------------------------------------------------------

describe("mapping suggestions and normalizers", () => {
  it("suggests a contacts mapping from common headers", () => {
    const m = suggestMapping("contacts", ["First Name", "Surname", "E-mail", "Company", "Company Website", "Job Title", "Mobile", "Role"]);
    expect(m).toMatchObject({
      first_name: "First Name",
      last_name: "Surname",
      email: "E-mail",
      account_name: "Company",
      account_domain: "Company Website",
      title: "Job Title",
      phone: "Mobile",
      role_in_buying: "Role",
      full_name: null,
    });
    expect(suggestMapping("contacts", ["Name", "Email", "Organisation"])).toMatchObject({
      full_name: "Name",
      first_name: null,
      account_name: "Organisation",
    });
  });

  it("suggests a pipeline mapping and never maps restricted columns", () => {
    const m = suggestMapping("opportunities", [
      "Deal Name",
      "Client",
      "Deal Stage",
      "Amount",
      "Owner",
      "Close Date",
      "Stage History",
      "Gross Margin",
      "Unit Cost",
      "Bid Score",
    ]);
    expect(m).toMatchObject({
      name: "Deal Name",
      account_name: "Client",
      stage: "Deal Stage",
      value: "Amount",
      owner_email: "Owner",
      expected_close: "Close Date",
      stage_history: "Stage History",
    });
    expect(Object.values(m)).not.toContain("Gross Margin");
    for (const h of ["Gross Margin", "Unit Cost", "Bid Score", "Quote #", "Markup %", "COGS"]) expect(isRestrictedHeader(h)).toBe(true);
    for (const h of ["Account", "Value", "Stage", "Scope", "Customer"]) expect(isRestrictedHeader(h)).toBe(false);
  });

  it("normalizes names, domains, dates, money and stages", () => {
    expect(normalizeName("The Acme Co., Inc.")).toBe(normalizeName("acme"));
    expect(normalizeName("Smith & Sons LLC")).toBe("smith and sons");
    expect(domainOf("https://www.GTA.georgia.gov/about")).toBe("gta.georgia.gov");
    expect(domainOf("jo@acme.com")).toBe("acme.com");
    expect(domainOf("not a domain")).toBeNull();
    expect(parseDate("3/1/2026")).toBe("2026-03-01");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("")).toBeUndefined();
    expect(parseMoney("$1,250,000")).toEqual({ value: 1_250_000, currency: "USD" });
    expect(parseMoney("1.2M")).toEqual({ value: 1_200_000, currency: undefined });
    expect(parseMoney("GBP 90k")).toEqual({ value: 90_000, currency: "GBP" });
    expect(parseMoney("lots")).toBeNull();
    expect(suggestStage("Proposal Sent")).toBe("submitted");
    expect(suggestStage("Closed-Won")).toBe("won");
    expect(suggestStage("Bid / No-Bid", [{ key: "bid_no_bid", label: "Bid / No-Bid" }])).toBe("bid_no_bid");
    expect(suggestStage("Banana")).toBeNull();
  });

  it("parses stage history in either order, sorted, and reports unreadable parts", () => {
    const h = parseStageHistory("2026-05-10 Proposal; Qualify (2026-03-01) | garbage");
    expect(h.entries).toEqual([
      { date: "2026-03-01", label: "Qualify" },
      { date: "2026-05-10", label: "Proposal" },
    ]);
    expect(h.unreadable).toEqual(["garbage"]);
  });
});

// ---------------------------------------------------------------------------
// Contacts (KCRM-75)
// ---------------------------------------------------------------------------

const CONTACTS = [
  "First name,Last name,Email,Account,Website,Buying role,Unit cost",
  "Ada,Lovelace,ada@dor.georgia.gov,,,Decision maker,10", // matches DOR by email domain
  "Grace,Hopper,grace@example.org,Georgia Technology Authority Inc.,,Champion,", // matches GTA by normalized name
  "Alan,Turing,alan@gmail.com,,https://gta.georgia.gov,,", // matches GTA by website domain (gmail ignored)
  "Kat,Johnson,kat@newco.example.com,NewCo Analytics,,,", // no match
  "Dup,Email,ADA@dor.georgia.gov,Georgia Department of Revenue,,,", // duplicate within the file
  "Den,Walker,denise.walker@gta.example.gov,Georgia Technology Authority,,,", // duplicate of a seeded contact
  ",NoFirst,nofirst@dor.georgia.gov,Georgia Department of Revenue,,,", // error
].join("\n");

describe("contact import", () => {
  it("dry run previews per-row results and writes nothing", async () => {
    const bd = await asUser("bd1");
    const before = {
      contacts: bd.store.raw("contacts").length,
      acts: bd.store.raw("activities").length,
      audit: bd.store.raw("audit_log").length,
    };
    const p = await previewImport(bd, contactsReq(CONTACTS));
    expect(p.rows.map((r) => r.status)).toEqual(["create", "create", "create", "error", "skip", "skip", "error"]);
    expect(p.rows[0]).toMatchObject({ account: "Georgia Department of Revenue", account_action: "match" });
    expect(p.rows[1].account).toBe("Georgia Technology Authority");
    expect(p.rows[2].account).toBe("Georgia Technology Authority");
    expect(p.rows[3].reasons[0]).toMatch(/No account matches "NewCo Analytics"/);
    expect(p.rows[4].reasons[0]).toMatch(/Same email as row 2/);
    expect(p.rows[5].reasons[0]).toMatch(/already exists/);
    expect(p.rows[6].reasons).toContain("First name is required");
    expect(p.totals).toMatchObject({ rows: 7, create: 3, skip: 2, error: 2, accounts_to_create: 0 });
    expect(p.unmatched_accounts).toEqual(["NewCo Analytics"]);
    expect(p.ignored_columns).toEqual(["Unit cost"]);
    expect(p.warnings.join(" ")).toMatch(/cost, margin/);
    expect(bd.store.raw("contacts").length).toBe(before.contacts);
    expect(bd.store.raw("activities").length).toBe(before.acts);
    expect(bd.store.raw("audit_log").length).toBe(before.audit);
    expect(bd.store.raw("import_batches")).toHaveLength(0);
  });

  it("commits in one batch with one audit entry, and can create missing accounts owned by the importer", async () => {
    const bd = await asUser("bd1");
    const auditBefore = bd.store.raw("audit_log").length;
    const { batch, preview } = await commitImport(bd, contactsReq(CONTACTS, { options: { create_missing_accounts: true } }));
    expect(preview.totals).toMatchObject({ create: 4, skip: 2, error: 1, accounts_to_create: 1 });
    expect(batch).toMatchObject({ entity: "contacts", status: "committed", user_id: bd.user.id, file_name: "contacts.csv", total_rows: 7 });
    expect(batch.created_ids.contacts).toHaveLength(4);
    expect(batch.created_ids.accounts).toHaveLength(1);
    expect(batch.created_count).toBe(5);
    const newco = (await bd.store.get("accounts", batch.created_ids.accounts[0]))!;
    expect(newco).toMatchObject({ name: "NewCo Analytics", owner_id: bd.user.id, website: "https://newco.example.com" });
    const ada = bd.store.raw("contacts").find((x) => x.email === "ada@dor.georgia.gov")!;
    expect(ada).toMatchObject({ account_id: ids.account("dor"), role_in_buying: "decision_maker", owner_id: bd.user.id });
    const audits = bd.store.raw("audit_log").slice(auditBefore);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "import.committed", entity: "import_batches", entity_id: batch.id });
    // Unit cost was never stored anywhere.
    expect(JSON.stringify(bd.store.raw("contacts"))).not.toContain('"10"');
  });

  it("doesn't create a missing account when its only row fails", async () => {
    const bd = await asUser("bd1");
    const p = await previewImport(
      bd,
      contactsReq("First name,Last name,Email,Account\n,Solo,solo@x.example.com,Ghost Corp\n", {
        options: { create_missing_accounts: true },
      }),
    );
    expect(p.rows[0]).toMatchObject({ status: "error", account_action: "create" });
    expect(p.totals.accounts_to_create).toBe(0);
  });

  it("re-importing the same file skips every contact by email", async () => {
    const bd = await asUser("bd1");
    await commitImport(bd, contactsReq(CONTACTS));
    const again = await previewImport(bd, contactsReq(CONTACTS));
    expect(again.totals.create).toBe(0);
    await expect(commitImport(bd, contactsReq(CONTACTS))).rejects.toBeInstanceOf(ValidationError);
  });

  it("only matches accounts the importer can see", async () => {
    const bd = await asUser("bd1");
    const p = await previewImport(bd, contactsReq("First name,Last name,Account\nJo,Ng,Peachtree Health Partners\n"));
    expect(p.rows[0].status).toBe("error");
    const exec = await switchUser(bd, "exec");
    expect((await previewImport(exec, contactsReq("First name,Last name,Account\nJo,Ng,Peachtree Health Partners\n"))).rows[0].status).toBe(
      "create",
    );
  });

  it("splits a full-name column and refuses a mapping without names or account columns", async () => {
    const bd = await asUser("bd1");
    const p = await previewImport(bd, contactsReq("Name,Email\nLovelace, Ada,ada2@dor.georgia.gov\n"));
    expect(p.rows[0].status).toBe("error"); // the unquoted comma makes "Ada" the email
    const ok = await previewImport(bd, contactsReq('Name,Email\n"Lovelace, Ada",ada2@dor.georgia.gov\n'));
    expect(ok.rows[0]).toMatchObject({ status: "create", label: "Ada Lovelace" });
    await expect(previewImport(bd, contactsReq("Title\nCIO\n"))).rejects.toThrow(/First name/);
  });
});

// ---------------------------------------------------------------------------
// Pipeline (KCRM-76)
// ---------------------------------------------------------------------------

const PIPELINE = [
  "Deal Name,Account,Stage,Amount,Owner,Type,Close Date,Stage History,Gross Margin,Service lines",
  "Records digitisation,Georgia Department of Revenue,Proposal Sent,$250k,priya@konnectorllc.com,RFP,2026-12-15,2026-03-01 Qualify; 2026-05-10 Proposal,22%,Implementation; Advisory",
  "Fleet telematics,Georgia Department of Revenue,Closed Lost,90000,ghost@elsewhere.com,Private,,,,",
  "Mystery deal,Georgia Department of Revenue,Banana,1000,,Private,,,,",
  "Bad date deal,Georgia Department of Revenue,Qualify,1000,,Private,31/31/2026,,,",
].join("\n");

describe("pipeline import", () => {
  it("maps stages, flags unknown owners and ignores margin columns in the dry run", async () => {
    const exec = await asUser("exec");
    const p = await previewImport(exec, pipelineReq(PIPELINE));
    expect(p.rows.map((r) => r.status)).toEqual(["create", "create", "error", "error"]);
    expect(p.rows[2].reasons[0]).toMatch(/Unknown stage "Banana"/);
    expect(p.rows[3].reasons[0]).toMatch(/isn't a date/);
    expect(p.unknown_owners).toEqual(["ghost@elsewhere.com"]);
    expect(p.rows[1].notes.join(" ")).toMatch(/ghost@elsewhere.com not found: assigned to Adaeze Okafor/);
    expect(p.ignored_columns).toEqual(["Gross Margin"]);
    const sv = Object.fromEntries(p.stage_values.map((s) => [s.raw, s.mapped]));
    expect(sv).toMatchObject({
      "Proposal Sent": "submitted",
      "Closed Lost": "lost",
      Banana: null,
      Qualify: "qualify",
      Proposal: "proposal",
    });
    expect(p.fallback_owner).toEqual({ id: exec.user.id, name: "Adaeze Okafor" });
  });

  it("commits deals with past-dated stage history, Imported lost reasons and no cost data", async () => {
    const exec = await asUser("exec");
    const { batch } = await commitImport(
      exec,
      pipelineReq(PIPELINE, { options: { stage_map: { banana: "capture" }, fallback_owner_id: ids.users.bd1 } }),
    );
    expect(batch.created_ids.opportunities).toHaveLength(3);
    const opps = exec.store.raw("opportunities").filter((o) => batch.created_ids.opportunities.includes(o.id));
    const records = opps.find((o) => o.name === "Records digitisation")!;
    expect(records).toMatchObject({
      stage: "submitted",
      value: 250_000,
      currency: "USD",
      owner_id: ids.users.bd2,
      kind: "public_bid",
      expected_close: "2026-12-15",
      service_lines: ["implementation", "advisory"],
      probability: 60,
      pwin: null,
    });
    const fleet = opps.find((o) => o.name === "Fleet telematics")!;
    expect(fleet).toMatchObject({ stage: "lost", lost_reason: "Imported", owner_id: ids.users.bd1 });
    expect(opps.find((o) => o.name === "Mystery deal")!.stage).toBe("capture");
    expect(JSON.stringify(opps)).not.toContain("22%");
    expect(opps.every((o) => Object.keys(o).every((k) => !/margin|cost/.test(k)))).toBe(true);

    // History → dated stage_change entries; no history → one "Imported at stage" entry.
    const hist = exec.store.raw("activities").filter((a) => a.related_id === records.id);
    expect(hist.map((a) => [a.type, a.subject, a.occurred_at])).toEqual([
      ["stage_change", "Stage: Qualify (imported history)", "2026-03-01T12:00:00.000Z"],
      ["stage_change", "Stage moved Qualify → Proposal", "2026-05-10T12:00:00.000Z"],
    ]);
    const fleetActs = exec.store.raw("activities").filter((a) => a.related_id === fleet.id);
    expect(fleetActs.map((a) => a.subject)).toEqual(["Imported at stage Lost"]);
    expect(fleetActs[0].body).toBe("Reason: Imported");
    // No bid decisions or quotes were created.
    expect(exec.store.raw("bid_decisions").some((b) => batch.created_ids.opportunities.includes(b.opportunity_id))).toBe(false);
    expect(exec.store.raw("quotes").some((q) => batch.created_ids.opportunities.includes(q.opportunity_id))).toBe(false);
  });

  it("skips future history entries and keeps the stage gate out of imported history", async () => {
    const exec = await asUser("exec");
    const p = await previewImport(
      exec,
      pipelineReq(
        "Name,Account,Stage,Kind,Stage history\nGated bid,Georgia Department of Revenue,Won,Public bid,2027-01-01 Proposal; 2026-01-01 Bid decision\n",
      ),
    );
    // A public bid at Won with no approved scorecard is importable (no stage-gate check).
    expect(p.rows[0].status).toBe("create");
    expect(p.rows[0].notes.join(" ")).toMatch(/2027-01-01 is in the future/);
  });

  it("bd: owners other than themselves become the importer; cannot pick a fallback owner", async () => {
    const bd = await asUser("bd1");
    const p = await previewImport(bd, pipelineReq(PIPELINE));
    expect(p.rows[0].notes.join(" ")).toMatch(/Assigned to you/);
    const { batch } = await commitImport(bd, pipelineReq(PIPELINE));
    const owners = new Set(
      bd.store
        .raw("opportunities")
        .filter((o) => batch.created_ids.opportunities.includes(o.id))
        .map((o) => o.owner_id),
    );
    expect([...owners]).toEqual([bd.user.id]);
    await expect(previewImport(bd, pipelineReq(PIPELINE, { options: { fallback_owner_id: ids.users.bd2 } }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("refuses restricted columns even when the mapping points at them", async () => {
    const exec = await asUser("exec");
    const csv = "Name,Account,Margin\nDeal one,Georgia Department of Revenue,12345\n";
    const p = await previewImport(exec, pipelineReq(csv, { mapping: { name: "Name", account_name: "Account", value: "Margin" } }));
    expect(p.mapping.value).toBeNull();
    const { batch } = await commitImport(exec, pipelineReq(csv, { mapping: { name: "Name", account_name: "Account", value: "Margin" } }));
    expect((await exec.store.get("opportunities", batch.created_ids.opportunities[0]))!.value).toBe(0);
  });

  it("recruiters may import staffing deals only", async () => {
    const r = await asUser("recruiter");
    const exec = await switchUser(r, "exec");
    // Give the recruiter an account they can see through an existing staffing deal.
    const staffing = exec.store.raw("opportunities").find((o) => o.kind === "staffing_placement")!;
    const account = (await exec.store.get("accounts", staffing.account_id))!;
    const p = await previewImport(
      r,
      pipelineReq(`Name,Account,Kind\nNurses Q3,${account.name},Staffing\nServers,${account.name},Reseller\n`),
    );
    expect(p.rows.map((x) => x.status)).toEqual(["create", "error"]);
    expect(p.rows[1].reasons).toContain("Recruiters can only import staffing deals");
    await expect(previewImport(r, contactsReq(CONTACTS))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// Accounts on the framework
// ---------------------------------------------------------------------------

describe("account import", () => {
  it("dedupes by normalized name and fills defaults", async () => {
    const bd = await asUser("bd1");
    const r = await importAccountsCsv(
      bd,
      "name,type,website\nGeorgia Technology Authority,government_state,\nAlbany Utilities,Government local,albany.example.com\nalbany utilities inc,,\n",
    );
    expect(r.created).toBe(1);
    expect(r.errors.map((e) => e.row)).toEqual([2, 4]);
    const albany = bd.store.raw("accounts").find((a) => a.name === "Albany Utilities")!;
    expect(albany).toMatchObject({
      type: "government_local",
      sector: "Unclassified",
      country: "US",
      website: "https://albany.example.com",
    });
  });
});

// ---------------------------------------------------------------------------
// Undo + permissions
// ---------------------------------------------------------------------------

describe("undo", () => {
  it("archives exactly what the batch created and audits it", async () => {
    const bd = await asUser("bd1");
    const before = bd.store.raw("contacts").filter((x) => !x.archived_at).length;
    const { batch } = await commitImport(bd, contactsReq(CONTACTS, { options: { create_missing_accounts: true } }));
    const undone = await undoImport(bd, batch.id);
    expect(undone).toMatchObject({ status: "undone", undone_by: bd.user.id });
    expect(bd.store.raw("contacts").filter((x) => !x.archived_at).length).toBe(before);
    expect((await bd.store.get("accounts", batch.created_ids.accounts[0]))!.archived_at).not.toBeNull();
    const audit = bd.store.raw("audit_log").filter((a) => a.entity_id === batch.id);
    expect(audit.map((a) => a.action)).toEqual(["import.committed", "import.undone"]);
    await expect(undoImport(bd, batch.id)).rejects.toThrow(/already undone/);
  });

  it("refuses when a created record was edited since", async () => {
    const bd = await asUser("bd1");
    const { batch } = await commitImport(bd, contactsReq(CONTACTS));
    await updateContact(bd, batch.created_ids.contacts[0], { title: "CIO" });
    await expect(undoImport(bd, batch.id)).rejects.toThrow(/changed since the import/);
    expect(bd.store.raw("contacts").filter((x) => batch.created_ids.contacts.includes(x.id) && x.archived_at)).toHaveLength(0);
  });

  it("refuses when something new hangs off an imported account", async () => {
    const bd = await asUser("bd1");
    const { batch } = await commitImport(bd, contactsReq(CONTACTS, { options: { create_missing_accounts: true } }));
    await commitImport(bd, contactsReq("First name,Last name,Account\nLate,Comer,NewCo Analytics\n"));
    await expect(undoImport(bd, batch.id)).rejects.toThrow(/added since/);
  });

  it("importer or a leader, within 7 days", async () => {
    const bd = await asUser("bd1");
    const { batch } = await commitImport(bd, contactsReq(CONTACTS));
    const bd2 = await switchUser(bd, "bd2");
    await expect(undoImport(bd2, batch.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listImportBatches(bd2)).toHaveLength(0);
    const exec = await switchUser(bd, "exec");
    expect((await listImportBatches(exec)).map((b) => [b.id, b.can_undo])).toEqual([[batch.id, true]]);
    const late = { ...exec, now: new Date(Date.parse(batch.created_at) + 8 * 86_400_000) };
    await expect(undoImport(late, batch.id)).rejects.toThrow(/within 7 days/);
    expect((await undoImport(exec, batch.id)).status).toBe("undone");
  });

  it("permission rules", () => {
    const at = (days: number) => new Date(Date.parse("2026-10-01T00:00:00Z") + days * 86_400_000);
    const b = { user_id: "u1", created_at: "2026-10-01T00:00:00Z", status: "committed" as const };
    expect(canUndoImport({ id: "u1", role: "bd" }, b, at(6))).toBe(true);
    expect(canUndoImport({ id: "u1", role: "bd" }, b, at(8))).toBe(false);
    expect(canUndoImport({ id: "u2", role: "bd" }, b, at(1))).toBe(false);
    expect(canUndoImport({ id: "u2", role: "executive" }, b, at(1))).toBe(true);
    expect(canUndoImport({ id: "u1", role: "bd" }, { ...b, status: "undone" }, at(1))).toBe(false);
    expect(canImport({ id: "x", role: "bd" }, "contacts")).toBe(true);
    expect(canImport({ id: "x", role: "admin" }, "accounts")).toBe(true);
    expect(canImport({ id: "x", role: "delivery_lead" }, "contacts")).toBe(false);
    expect(canImport({ id: "x", role: "delivery_lead" }, "opportunities")).toBe(false);
    expect(canImport({ id: "x", role: "recruiter" }, "contacts")).toBe(false);
    expect(canImport({ id: "x", role: "recruiter" }, "opportunities")).toBe(true);
  });

  it("delivery leads can't import at all", async () => {
    const d = await asUser("delivery");
    await expect(previewImport(d, contactsReq(CONTACTS))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(commitImport(d, pipelineReq(PIPELINE))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
