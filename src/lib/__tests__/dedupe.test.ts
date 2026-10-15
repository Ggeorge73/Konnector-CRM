import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { seedIds, sid } from "@/lib/data/seed";
import {
  NAME_SIMILARITY_THRESHOLD,
  findAccountDuplicates,
  normalizeCompanyName,
  normalizeEmail,
  normalizePersonName,
  phoneDigits,
  scoreAccountPair,
  scoreContactPair,
  trigramSimilarity,
  websiteDomain,
} from "@/lib/domain/dedupe";
import type { Account, Contact, NewRow, TableName } from "@/lib/domain/types";
import {
  accountDuplicates,
  contactDuplicates,
  dismissDuplicate,
  duplicateCounts,
  listDismissals,
  mergeAccounts,
  mergeContacts,
  undoDismissal,
} from "@/lib/services/dedupe";
import { asUser, NOW, switchUser } from "./helpers";

const ids = seedIds();
const HARBOR = ids.account("harbor");
const HARBOR_DUP = ids.account("harbor-dup");
const SAM = sid("contact:sam.porter");
const SAMUEL = sid("contact:samuel.porter");

const acct = (id: string, name: string, website: string | null = null) => ({ id, name, website });
const person = (id: string, first: string, last: string, extra: Partial<Contact> = {}) => ({
  id,
  account_id: "acc-1",
  first_name: first,
  last_name: last,
  email: null,
  phone: null,
  ...extra,
});

describe("normalisation", () => {
  it("ignores legal suffixes, 'the', punctuation, case and diacritics in company names", () => {
    expect(normalizeCompanyName("The Harborline Logistics, Inc.")).toBe("harborline logistics");
    expect(normalizeCompanyName("HARBORLINE LOGISTICS LLC")).toBe("harborline logistics");
    expect(normalizeCompanyName("Acme L.L.C.")).toBe("acme");
    expect(normalizeCompanyName("Okeke & Hart Consulting Ltd")).toBe("okeke and hart consulting");
    expect(normalizeCompanyName("Café Société Corp.")).toBe("cafe societe");
    // A name that is only noise keeps its words rather than becoming empty.
    expect(normalizeCompanyName("The Company")).toBe("the company");
  });

  it("extracts a website domain", () => {
    expect(websiteDomain("https://www.Harborline.example.com/about")).toBe("harborline.example.com");
    expect(websiteDomain("harborline.example.com")).toBe("harborline.example.com");
    expect(websiteDomain("http://www2.example.org")).toBe("example.org");
    expect(websiteDomain("not a url")).toBeNull();
    expect(websiteDomain(null)).toBeNull();
  });

  it("compares emails case-insensitively; Gmail dots and +tags only for Gmail", () => {
    expect(normalizeEmail(" Sam.Porter@Harbor.example.com ")).toBe("sam.porter@harbor.example.com");
    expect(normalizeEmail("s.a.m+crm@googlemail.com")).toBe("sam@gmail.com");
    expect(normalizeEmail("sam+crm@harbor.example.com")).toBe("sam+crm@harbor.example.com");
    expect(normalizeEmail("nope")).toBeNull();
  });

  it("compares phones by digits, dropping a leading US 1", () => {
    expect(phoneDigits("+1 (404) 555-1592")).toBe("4045551592");
    expect(phoneDigits("404.555.1592")).toBe("4045551592");
    expect(phoneDigits("ext 12")).toBeNull();
  });

  it("normalises person names", () => {
    expect(normalizePersonName(" José ", "O'Neil")).toBe("jose o neil");
  });
});

describe("scoring", () => {
  it("scores the same normalised name at 90 with a reason", () => {
    const p = scoreAccountPair(acct("b", "Harborline Logistics"), acct("a", "The Harborline Logistics, Inc."))!;
    expect(p).toMatchObject({ a: "a", b: "b", score: 90 });
    expect(p.reasons.map((r) => r.code)).toEqual(["same_name"]);
  });

  it("combines name and website domain signals", () => {
    const p = scoreAccountPair(acct("a", "Acme Corp", "https://acme.com"), acct("b", "ACME, Inc.", "www.acme.com"))!;
    expect(p.reasons.map((r) => r.code)).toEqual(["same_name", "same_domain"]);
    expect(p.score).toBe(98);
    const domainOnly = scoreAccountPair(acct("a", "Acme", "acme.com"), acct("b", "Roadrunner Supply", "https://acme.com/rr"))!;
    expect(domainOnly).toMatchObject({ score: 80 });
  });

  it(`flags close names at or above the ${NAME_SIMILARITY_THRESHOLD} trigram threshold only`, () => {
    const close = scoreAccountPair(acct("a", "Peachtree Health Partners"), acct("b", "Peachtree Health Partner"))!;
    expect(close.reasons[0].code).toBe("similar_name");
    expect(close.score).toBeGreaterThan(50);
    expect(trigramSimilarity("georgia department revenue", "georgia department transportation")).toBeLessThan(NAME_SIMILARITY_THRESHOLD);
    expect(scoreAccountPair(acct("a", "Georgia Department of Revenue"), acct("b", "Georgia Department of Transportation"))).toBeNull();
  });

  it("scores contacts by email, name within the same account, and phone", () => {
    const email = scoreContactPair(
      person("a", "Sam", "Porter", { email: "SAM@x.com" }),
      person("b", "Samuel", "Porter", { email: "sam@x.com" }),
    )!;
    expect(email).toMatchObject({ score: 90 });
    const both = scoreContactPair(
      person("a", "Sam", "Porter", { email: "sam@x.com", phone: "+1 404 555 1592" }),
      person("b", "Sam", "Porter", { email: "sam@x.com", phone: "(404) 555-1592" }),
    )!;
    expect(both.reasons.map((r) => r.code)).toEqual(["same_email", "same_name_same_account", "same_phone"]);
    expect(both.score).toBe(99);
    // Same name at a different account is not a match on its own.
    expect(scoreContactPair(person("a", "Sam", "Porter"), person("b", "Sam", "Porter", { account_id: "acc-2" }))).toBeNull();
  });

  it("finds pairs without comparing unrelated rows and honours dismissals", () => {
    const rows = [
      acct("1", "Acme Inc"),
      acct("2", "ACME"),
      acct("3", "Zenith Ltd"),
      acct("4", "Acme Holdings", "acme.com"),
      acct("5", "x", "https://acme.com"),
    ];
    const pairs = findAccountDuplicates(rows);
    expect(pairs.map((p) => `${p.a}:${p.b}`).sort()).toEqual(["1:2", "4:5"]);
    expect(findAccountDuplicates(rows, new Set(["1:2"])).map((p) => `${p.a}:${p.b}`)).toEqual(["4:5"]);
  });

  it("finds no false positives in the seed apart from the planted Harborline pair", async () => {
    const exec = await asUser("exec");
    const pairs = await accountDuplicates(exec);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.id, pairs[0].b.id].sort()).toEqual([HARBOR, HARBOR_DUP].sort());
    expect(pairs[0].reasons.map((r) => r.code)).toEqual(["same_name"]);
    const contacts = await contactDuplicates(exec);
    expect(contacts).toHaveLength(1);
    expect([contacts[0].a.id, contacts[0].b.id].sort()).toEqual([SAM, SAMUEL].sort());
    expect(contacts[0].reasons.map((r) => r.code)).toEqual(["same_email", "same_phone"]);
    expect(contacts[0].score).toBe(96);
  });

  it("excludes archived records", async () => {
    const exec = await asUser("exec");
    await exec.store.update("accounts", HARBOR_DUP, { archived_at: NOW.toISOString() });
    expect(await accountDuplicates(exec)).toHaveLength(0);
    // Contacts on an archived account drop out too.
    expect(await contactDuplicates(exec)).toHaveLength(0);
  });
});

describe("dismissals", () => {
  it("stores an unordered pair once, hides it, and can be restored", async () => {
    const exec = await asUser("exec");
    const d1 = await dismissDuplicate(exec, { entity: "accounts", a: HARBOR_DUP, b: HARBOR });
    const d2 = await dismissDuplicate(exec, { entity: "accounts", a: HARBOR, b: HARBOR_DUP });
    expect(d2.id).toBe(d1.id);
    expect(d1.record_a < d1.record_b).toBe(true);
    expect(d1.dismissed_by).toBe(exec.user.id);
    expect(await accountDuplicates(exec)).toHaveLength(0);
    expect(await duplicateCounts(exec)).toEqual({ accounts: 0, contacts: 1 });
    expect((await exec.store.list("audit_log")).map((a) => a.action)).toContain("duplicate.dismissed");
    await undoDismissal(exec, d1.id);
    expect(await listDismissals(exec, "accounts")).toHaveLength(0);
    expect(await accountDuplicates(exec)).toHaveLength(1);
  });

  it("validates input", async () => {
    const exec = await asUser("exec");
    await expect(dismissDuplicate(exec, { entity: "accounts", a: HARBOR, b: HARBOR })).rejects.toBeInstanceOf(ValidationError);
    await expect(dismissDuplicate(exec, { entity: "accounts", a: "nope", b: HARBOR })).rejects.toThrow();
  });

  it("is leader-only, like the duplicate_dismissals RLS policies", async () => {
    for (const role of ["bd1", "delivery", "recruiter"] as const) {
      const c = await asUser(role);
      await expect(accountDuplicates(c)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(contactDuplicates(c)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(dismissDuplicate(c, { entity: "accounts", a: HARBOR, b: HARBOR_DUP })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listDismissals(c, "accounts")).rejects.toBeInstanceOf(ForbiddenError);
    }
    const admin = await asUser("admin");
    expect(await accountDuplicates(admin)).toHaveLength(1);
  });
});

/** Inserts one row of every kind that can point at `loser`, so the merge must move all of them. */
async function plantLinks(c: Awaited<ReturnType<typeof asUser>>, loser: string, survivor: string) {
  const ins = <T extends TableName>(t: T, row: Record<string, unknown>) => c.store.insert(t, row as NewRow<T>);
  const org = ids.org;
  const opp = (await c.store.list("opportunities", { where: { account_id: loser } }))[0];
  const tagA = (await c.store.list("tags"))[0];
  const tagB = (await c.store.list("tags"))[1];
  const quote = await ins("quotes", {
    org_id: org,
    opportunity_id: opp.id,
    account_id: loser,
    number: "Q-T-1",
    title: "Telematics",
    currency: "USD",
    status: "draft",
    valid_until: null,
    terms: null,
    internal_notes: null,
    approved_by: null,
    approved_at: null,
    owner_id: c.user.id,
  });
  await ins("quote_lines", {
    quote_id: quote.id,
    position: 1,
    item: "Gateway",
    description: null,
    qty: 1,
    unit_cost: 10,
    unit_price: 20,
    oem_partner_account_id: loser,
  });
  await ins("partner_vetting", { org_id: org, account_id: loser, sanctions_screen: "pending", pep_screen: "pending" });
  await ins("project_health", { konnect_hub_project_id: "khp_t", account_id: loser, opportunity_id: null, project_name: "Pilot" });
  await ins("client_items", { org_id: org, type: "survey", account_id: loser, title: "Survey", status: "draft" });
  await ins("synced_messages", { connection_id: "x", user_id: c.user.id, subject: "Hi", account_id: loser, contact_id: null });
  await ins("activities", {
    org_id: org,
    type: "note",
    subject: "on account id",
    related_type: "opportunity",
    related_id: opp.id,
    account_id: loser,
  });
  await ins("tasks", { org_id: org, title: "Call", assignee_id: c.user.id, related_type: "account", related_id: loser, account_id: loser });
  await ins("files", {
    org_id: org,
    storage_path: "x",
    name: "rfp.pdf",
    size: 1,
    mime: "application/pdf",
    related_type: "account",
    related_id: loser,
  });
  await ins("copilot_runs", { org_id: org, user_id: c.user.id, task: "account_summary", related_type: "account", related_id: loser });
  await ins("record_tags", { tag_id: tagA.id, related_type: "account", related_id: survivor });
  await ins("record_tags", { tag_id: tagA.id, related_type: "account", related_id: loser }); // duplicate of survivor's
  await ins("record_tags", { tag_id: tagB.id, related_type: "account", related_id: loser });
  await ins("recent_views", { user_id: c.user.id, related_type: "account", related_id: survivor, label: "Harborline" });
  await ins("recent_views", { user_id: c.user.id, related_type: "account", related_id: loser, label: "dup" }); // same user
  await ins("recent_views", { user_id: ids.users.bd2, related_type: "account", related_id: loser, label: "dup" });
  await ins("notifications", { user_id: c.user.id, kind: "alert", title: "Look", href: `/accounts/${loser}?tab=files` });
}

/** Every reference to `id` across the tables a merge re-points. */
function referencesTo(c: Awaited<ReturnType<typeof asUser>>, id: string) {
  const s = c.store;
  const rel = (r: { related_id: string | null }) => r.related_id === id;
  return {
    contacts: s.raw("contacts").filter((r) => r.account_id === id).length,
    opportunities: s.raw("opportunities").filter((r) => r.account_id === id).length,
    quotes: s.raw("quotes").filter((r) => r.account_id === id).length,
    quote_lines: s.raw("quote_lines").filter((r) => r.oem_partner_account_id === id).length,
    partner_vetting: s.raw("partner_vetting").filter((r) => r.account_id === id).length,
    project_health: s.raw("project_health").filter((r) => r.account_id === id).length,
    client_items: s.raw("client_items").filter((r) => r.account_id === id).length,
    synced_messages: s.raw("synced_messages").filter((r) => r.account_id === id || r.contact_id === id).length,
    activities: s.raw("activities").filter((r) => r.account_id === id || rel(r)).length,
    tasks: s.raw("tasks").filter((r) => r.account_id === id || rel(r)).length,
    files: s.raw("files").filter(rel).length,
    copilot_runs: s.raw("copilot_runs").filter(rel).length,
    record_tags: s.raw("record_tags").filter(rel).length,
    recent_views: s.raw("recent_views").filter(rel).length,
    notifications: s.raw("notifications").filter((r) => r.href?.includes(id)).length,
    event_leads: s.raw("event_leads").filter((r) => r.contact_id === id).length,
  };
}

describe("merge accounts", () => {
  it("re-points every related table to the survivor, archives the loser, writes timeline + audit", async () => {
    const exec = await asUser("exec");
    await plantLinks(exec, HARBOR_DUP, HARBOR);
    const before = referencesTo(exec, HARBOR_DUP);
    for (const [t, n] of Object.entries(before)) if (t !== "event_leads") expect(n, t).toBeGreaterThan(0);
    const loserSnapshot = (await exec.store.get("accounts", HARBOR_DUP))!;
    const survivorBefore = (await exec.store.get("accounts", HARBOR))!;

    const r = await mergeAccounts(exec, { survivor_id: HARBOR, loser_id: HARBOR_DUP, pick: { website: "loser", sector: "loser" } });

    expect(r.survivor.id).toBe(HARBOR);
    expect(r.survivor.name).toBe("Harborline Logistics"); // kept from survivor
    expect(r.survivor.website).toBe("https://www.harborline.example.com"); // picked from loser
    expect(r.survivor.sector).toBe("Logistics & supply chain");
    expect(Object.values(referencesTo(exec, HARBOR_DUP)).every((n) => n === 0)).toBe(true);
    expect(r.repointed).toMatchObject({
      contacts: 2,
      opportunities: 1,
      quotes: 1,
      quote_lines: 1,
      partner_vetting: 1,
      project_health: 1,
      client_items: 1,
      synced_messages: 1,
      files: 1,
      copilot_runs: 1,
      record_tags: 1,
      recent_views: 1,
      notifications: 1,
    });
    // Duplicate join rows were folded, not duplicated.
    const tags = exec.store.raw("record_tags").filter((t) => t.related_id === HARBOR);
    expect(new Set(tags.map((t) => t.tag_id)).size).toBe(tags.length);
    expect(exec.store.raw("recent_views").filter((v) => v.related_id === HARBOR && v.user_id === exec.user.id)).toHaveLength(1);
    expect(exec.store.raw("notifications").some((n) => n.href === `/accounts/${HARBOR}?tab=files`)).toBe(true);

    // Loser archived, never deleted.
    const loser = exec.store.raw("accounts").find((a) => a.id === HARBOR_DUP)!;
    expect(loser.archived_at).not.toBeNull();
    expect(loser.name).toBe("Harborline Logistics, Inc.");

    const timeline = exec.store.raw("activities").filter((a) => a.related_type === "account" && a.related_id === HARBOR);
    expect(timeline.map((a) => a.subject)).toContain('Merged "Harborline Logistics, Inc." into this record');
    // The duplicate's own timeline moved over too.
    expect(timeline.map((a) => a.subject)).toContain("Expo follow-up with Dana Whitaker");

    const audit = exec.store.raw("audit_log").find((a) => a.action === "account.merged")!;
    expect(audit).toMatchObject({ entity: "accounts", entity_id: HARBOR, actor_id: exec.user.id });
    expect(audit.before).toEqual({ survivor: survivorBefore });
    expect(audit.after).toMatchObject({
      loser_id: HARBOR_DUP,
      loser_snapshot: loserSnapshot,
      survivor: { id: HARBOR, website: "https://www.harborline.example.com" },
    });
    expect(await accountDuplicates(exec)).toHaveLength(0);
  });

  it("moves city with its coordinates", async () => {
    const admin = await asUser("admin");
    await admin.store.update("accounts", HARBOR_DUP, { city: "Garden City", lat: 32.1, lng: -81.2 });
    const r = await mergeAccounts(admin, { survivor_id: HARBOR, loser_id: HARBOR_DUP, pick: { city: "loser" } });
    expect(r.survivor).toMatchObject({ city: "Garden City", lat: 32.1, lng: -81.2 });
  });

  it("refuses accounts linked to different Konnect Hub clients and changes nothing", async () => {
    const exec = await asUser("exec");
    await exec.store.update("accounts", HARBOR, { konnect_hub_client_id: "khc_harbor" });
    await exec.store.update("accounts", HARBOR_DUP, { konnect_hub_client_id: "khc_harbor_2" });
    const snapshot = JSON.stringify([exec.store.raw("accounts"), exec.store.raw("contacts"), exec.store.raw("audit_log")]);
    const err = await mergeAccounts(exec, { survivor_id: HARBOR, loser_id: HARBOR_DUP }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/different Konnect Hub clients \(khc_harbor and khc_harbor_2\)/);
    // The store refuses on its own as well (mirrors the SQL function).
    await expect(
      exec.store.merge("accounts", { survivorId: HARBOR, loserId: HARBOR_DUP, patch: {}, actor: exec.user, now: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(JSON.stringify([exec.store.raw("accounts"), exec.store.raw("contacts"), exec.store.raw("audit_log")])).toBe(snapshot);
  });

  it("carries a Hub link over when only the loser has one", async () => {
    const exec = await asUser("exec");
    await exec.store.update("accounts", HARBOR_DUP, { konnect_hub_client_id: "khc_harbor" });
    const r = await mergeAccounts(exec, { survivor_id: HARBOR, loser_id: HARBOR_DUP });
    expect(r.survivor.konnect_hub_client_id).toBe("khc_harbor");
    expect(exec.store.raw("accounts").find((a) => a.id === HARBOR_DUP)!.konnect_hub_client_id).toBeNull();
  });

  it("is leader-only in the service and in the store", async () => {
    for (const role of ["bd1", "bd2", "delivery", "recruiter"] as const) {
      const c = await asUser(role);
      await expect(mergeAccounts(c, { survivor_id: HARBOR, loser_id: HARBOR_DUP })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(mergeContacts(c, { survivor_id: SAM, loser_id: SAMUEL })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        c.store.merge("accounts", { survivorId: HARBOR, loserId: HARBOR_DUP, patch: {}, actor: c.user, now: NOW }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(c.store.raw("accounts").find((a) => a.id === HARBOR_DUP)!.archived_at).toBeNull();
    }
  });

  it("rejects merging a record with itself, archived records and unknown fields", async () => {
    const exec = await asUser("exec");
    await expect(mergeAccounts(exec, { survivor_id: HARBOR, loser_id: HARBOR })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      mergeAccounts(exec, { survivor_id: HARBOR, loser_id: HARBOR_DUP, pick: { konnect_hub_client_id: "loser" } as never }),
    ).rejects.toThrow();
    await exec.store.update("accounts", HARBOR_DUP, { archived_at: NOW.toISOString() });
    await expect(mergeAccounts(exec, { survivor_id: HARBOR, loser_id: HARBOR_DUP })).rejects.toBeInstanceOf(ValidationError);
  });

  it("ignores patch keys outside the whitelist at the store level", async () => {
    const exec = await asUser("exec");
    const r = await exec.store.merge("accounts", {
      survivorId: HARBOR,
      loserId: HARBOR_DUP,
      patch: { name: "Harborline", org_id: "evil", id: "evil" } as Partial<Account>,
      actor: exec.user,
      now: NOW,
    });
    expect(r.survivor).toMatchObject({ id: HARBOR, name: "Harborline", org_id: ids.org });
  });
});

describe("merge contacts", () => {
  it("re-points timeline, tasks, files, tags, event leads and synced mail; archives and audits", async () => {
    const exec = await asUser("exec");
    const ins = <T extends TableName>(t: T, row: Record<string, unknown>) => exec.store.insert(t, row as NewRow<T>);
    const event = (await exec.store.list("events"))[0];
    const other = (await exec.store.list("events"))[1];
    await ins("event_leads", { event_id: event.id, contact_id: SAM, interest: "Yard visibility", follow_up_task_id: null });
    await ins("event_leads", { event_id: event.id, contact_id: SAMUEL, interest: "Telematics pilot", follow_up_task_id: null });
    await ins("event_leads", { event_id: other.id, contact_id: SAMUEL, interest: null, follow_up_task_id: null });
    await ins("activities", {
      org_id: ids.org,
      type: "call",
      subject: "Called Samuel",
      related_type: "contact",
      related_id: SAMUEL,
      account_id: HARBOR_DUP,
    });
    await ins("tasks", {
      org_id: ids.org,
      title: "Email Samuel",
      assignee_id: exec.user.id,
      related_type: "contact",
      related_id: SAMUEL,
      account_id: null,
    });
    await ins("files", {
      org_id: ids.org,
      storage_path: "x",
      name: "card.png",
      size: 1,
      mime: "image/png",
      related_type: "contact",
      related_id: SAMUEL,
    });
    await ins("record_tags", { tag_id: (await exec.store.list("tags"))[0].id, related_type: "contact", related_id: SAMUEL });
    await ins("synced_messages", { connection_id: "x", user_id: exec.user.id, subject: "Hi", account_id: null, contact_id: SAMUEL });
    await ins("copilot_runs", {
      org_id: ids.org,
      user_id: exec.user.id,
      task: "followup_email",
      related_type: "contact",
      related_id: SAMUEL,
    });
    await ins("notifications", { user_id: exec.user.id, kind: "alert", title: "x", href: `/contacts/${SAMUEL}` });

    const r = await mergeContacts(exec, { survivor_id: SAM, loser_id: SAMUEL, pick: { title: "loser", account_id: "survivor" } });
    expect(r.survivor).toMatchObject({ id: SAM, first_name: "Sam", title: "Director of IT", account_id: HARBOR });
    expect(Object.values(referencesTo(exec, SAMUEL)).every((n) => n === 0)).toBe(true);
    const leads = exec.store.raw("event_leads").filter((l) => l.contact_id === SAM);
    expect(leads.find((l) => l.event_id === event.id)!.interest).toBe("Yard visibility\nTelematics pilot");
    expect(leads.some((l) => l.event_id === other.id)).toBe(true);
    expect(exec.store.raw("contacts").find((x) => x.id === SAMUEL)!.archived_at).not.toBeNull();
    expect(exec.store.raw("activities").some((a) => a.related_id === SAM && a.subject === 'Merged "Samuel Porter" into this record')).toBe(
      true,
    );
    const audit = exec.store.raw("audit_log").find((a) => a.action === "contact.merged")!;
    expect(audit.after).toMatchObject({ loser_id: SAMUEL, loser_snapshot: { id: SAMUEL, email: "Sam.Porter@harbor.example.com" } });
    expect(await contactDuplicates(exec)).toHaveLength(0);
  });

  it("can move the survivor to the loser's account", async () => {
    const exec = await asUser("exec");
    const r = await mergeContacts(exec, { survivor_id: SAM, loser_id: SAMUEL, pick: { account_id: "loser" } });
    expect(r.survivor.account_id).toBe(HARBOR_DUP);
  });

  it("after an account merge the contact pair sits on one account and still merges", async () => {
    const exec = await asUser("exec");
    await mergeAccounts(exec, { survivor_id: HARBOR, loser_id: HARBOR_DUP });
    const [pair] = await contactDuplicates(exec);
    expect(pair.reasons.map((r) => r.code)).toEqual(["same_email", "same_phone"]);
    const bd = await switchUser(exec, "bd1");
    await expect(mergeContacts(bd, { survivor_id: SAM, loser_id: SAMUEL })).rejects.toBeInstanceOf(ForbiddenError);
    await mergeContacts(exec, { survivor_id: SAM, loser_id: SAMUEL });
    expect(
      exec.store
        .raw("contacts")
        .filter((x) => x.account_id === HARBOR && !x.archived_at)
        .map((x) => x.first_name)
        .sort(),
    ).toEqual(["Dana", "Sam"]);
  });
});
