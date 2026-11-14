import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/data/memory-store";
import { buildSeed, SEED_USERS } from "@/lib/data/seed";
import { signBody, verifyBody } from "@/lib/integration/signing";
import { systemCtx } from "@/lib/services/system";
import { enquiryKey, MAX_ENQUIRY_BYTES, nextBusinessDay, receiveWebsiteEnquiry, splitName } from "@/lib/services/website-leads";
import { NOW } from "./helpers";

const SECRET = "website-test-secret";
const lead = {
  name: "Ada Lovelace King",
  email: "ada@brightwater.example.com",
  organization: "Brightwater County Schools",
  sector: "Public sector",
  message: "We need a student information system migrated before the new school year. @Olugbenga George please call.",
  deadline: "August 2027",
  receivedAt: "2026-10-09T18:30:00.000Z", // a Friday
  page: "/contact",
};
const payload = (over: Record<string, unknown> = {}, top: Record<string, unknown> = {}) =>
  JSON.stringify({ event: "website.enquiry", stage: "signal", source: "inbound", lead: { ...lead, ...over }, ...top });

async function setup() {
  const store = new MemoryStore(buildSeed(NOW));
  const c = await systemCtx(store, NOW);
  const post = (body: string, sig: string | null = signBody(body, SECRET), opts: { secret?: string; defaultOwnerEmail?: string } = {}) =>
    receiveWebsiteEnquiry(c, body, sig, { secret: SECRET, ...opts });
  const counts = async () => ({
    accounts: (await store.list("accounts")).length,
    contacts: (await store.list("contacts")).length,
    opportunities: (await store.list("opportunities")).length,
    activities: (await store.list("activities")).length,
    audit: (await store.list("audit_log")).length,
    events: (await store.list("integration_events")).length,
  });
  return { store, post, counts };
}

describe("website enquiry signature", () => {
  it("matches the website's scheme and rejects tampering, wrong secrets and other formats", () => {
    const body = payload();
    const sig = signBody(body, SECRET);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyBody(body, sig, SECRET)).toEqual({ ok: true });
    expect(verifyBody(body + " ", sig, SECRET)).toMatchObject({ ok: false, reason: "bad signature" });
    expect(verifyBody(body, sig, "other")).toMatchObject({ ok: false, reason: "bad signature" });
    expect(verifyBody(body, null, SECRET)).toMatchObject({ ok: false, reason: "missing signature" });
    expect(verifyBody(body, "t=1,v1=abc", SECRET)).toMatchObject({ ok: false, reason: "malformed signature" });
    expect(verifyBody(body, "sha256=abc", SECRET)).toMatchObject({ ok: false, reason: "malformed signature" });
  });

  it("refuses unsigned, badly signed and unconfigured requests without writing anything", async () => {
    const { post, counts } = await setup();
    const before = await counts();
    const body = payload();
    expect(await post(body, null)).toMatchObject({ status: 401, body: { error: "missing signature" } });
    expect(await post(body, signBody(body, "wrong"))).toMatchObject({ status: 401, body: { error: "bad signature" } });
    expect(await post(payload({ organization: "Someone Else" }), signBody(body, SECRET))).toMatchObject({ status: 401 });
    expect(await post(body, signBody(body, ""), { secret: "" })).toMatchObject({ status: 503 });
    expect(await counts()).toEqual(before);
  });
});

describe("website enquiry validation", () => {
  it("rejects bad JSON, wrong events and invalid leads with field details, and writes nothing", async () => {
    const { post, counts } = await setup();
    const before = await counts();
    expect(await post("{not json")).toMatchObject({ status: 400 });
    expect(await post(payload({}, { event: "something.else" }))).toMatchObject({ status: 422 });
    expect(await post(payload({}, { stage: "proposal" }))).toMatchObject({ status: 422 });
    expect(await post(payload({}, { source: "referral" }))).toMatchObject({ status: 422 });
    expect(await post(payload({ sector: "Aliens" }))).toMatchObject({ status: 422 });
    expect(await post(payload({ receivedAt: "yesterday" }))).toMatchObject({ status: 422 });
    expect(await post(payload({ organization: "" }))).toMatchObject({ status: 422 });
    const r = await post(payload({ email: "not-an-email" }));
    expect(r.status).toBe(422);
    expect(r.body.details).toEqual([{ path: "lead.email", message: "email is not valid" }]);
    expect(await post(payload({ message: "x".repeat(MAX_ENQUIRY_BYTES) }))).toMatchObject({ status: 413 });
    expect(await counts()).toEqual(before);
  });

  it("ignores unknown fields so the website can add to the payload", async () => {
    const { post } = await setup();
    expect(await post(payload({ utm_source: "newsletter" }, { extra: true }))).toMatchObject({ status: 200 });
  });
});

describe("website enquiry → Signal opportunity", () => {
  it("creates one account, one contact and one Signal / inbound opportunity with documented defaults", async () => {
    const { store, post, counts } = await setup();
    const before = await counts();
    const r = await post(payload());
    expect(r).toMatchObject({ status: 200, body: { ok: true, account_created: true, contact_created: true } });
    const after = await counts();
    expect(after.accounts - before.accounts).toBe(1);
    expect(after.contacts - before.contacts).toBe(1);
    expect(after.opportunities - before.opportunities).toBe(1);

    const account = (await store.get("accounts", r.body.account_id as string))!;
    expect(account).toMatchObject({
      name: "Brightwater County Schools",
      type: "government_local",
      sector: "Unclassified",
      country: "US",
      tier: "C",
      status: "prospect",
      owner_id: SEED_USERS.admin,
    });
    const contact = (await store.get("contacts", r.body.contact_id as string))!;
    expect(contact).toMatchObject({
      account_id: account.id,
      first_name: "Ada",
      last_name: "Lovelace King",
      email: lead.email,
      owner_id: SEED_USERS.admin,
    });
    const opp = (await store.get("opportunities", r.body.opportunity_id as string))!;
    expect(opp).toMatchObject({
      name: "Website enquiry: Brightwater County Schools",
      account_id: account.id,
      stage: "signal",
      source: "inbound",
      kind: "public_bid",
      value: 0,
      currency: "USD",
      service_lines: ["advisory"],
      owner_id: SEED_USERS.admin,
      next_step: "Reply to website enquiry",
      next_step_due: "2026-10-12", // Friday → Monday
    });

    // Timeline: the enquiry text as a note on the deal, with no mention fired by "@Name" in public input.
    const notes = await store.list("activities", { where: { related_type: "opportunity", related_id: opp.id, type: "note" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ account_id: account.id, occurred_at: lead.receivedAt, actor_id: null, mentions: [] });
    expect(notes[0].body).toContain(lead.message);
    expect(notes[0].body).toContain("Needs to land: August 2027");
    expect(await store.list("mentions")).toHaveLength(0);
    const system = (await store.list("activities", { where: { account_id: account.id, type: "system" } })).map((a) => a.subject);
    expect(system).toEqual(
      expect.arrayContaining(["Account created", "Opportunity created", "Contact added from website enquiry: Ada Lovelace King"]),
    );

    // Audit: system actor (null), one row each for the account, the deal and the enquiry itself.
    const audits = (await store.list("audit_log")).filter((a) => [account.id, opp.id].includes(a.entity_id));
    expect(audits.map((a) => a.action).sort()).toEqual(["account.created", "opportunity.created", "website_enquiry.received"]);
    expect(audits.every((a) => a.actor_id === null)).toBe(true);

    // Owner is told; the event is logged as processed.
    const alerts = await store.list("notifications", { where: { user_id: SEED_USERS.admin, href: `/opportunities/${opp.id}` } });
    expect(alerts).toHaveLength(1);
    const [event] = await store.list("integration_events", { where: { idempotency_key: enquiryKey(lead) } });
    expect(event).toMatchObject({ direction: "inbound", event: "website.enquiry", status: "processed", attempts: 1 });
  });

  it("is idempotent on receivedAt + email: a repeat creates nothing new", async () => {
    const { post, counts } = await setup();
    const first = await post(payload());
    const after = await counts();
    const again = await post(payload());
    expect(again).toMatchObject({ status: 200, body: { ok: true, idempotent_replay: true, opportunity_id: first.body.opportunity_id } });
    // Same enquiry even if the body bytes differ (other fields, email case, timestamp spelling).
    const variant = payload({
      email: "ADA@brightwater.example.com",
      receivedAt: "2026-10-09T18:30:00Z",
      message: "Sent twice by a retry.",
    });
    expect(await post(variant)).toMatchObject({ status: 200, body: { idempotent_replay: true } });
    expect(await counts()).toEqual(after);
  });

  it("reuses the account and contact for a later enquiry, and adds a second opportunity", async () => {
    const { store, post, counts } = await setup();
    const first = await post(payload());
    const mid = await counts();
    const second = await post(payload({ organization: "brightwater county schools, LLC", receivedAt: "2026-10-10T09:00:00.000Z" }));
    expect(second.body).toMatchObject({
      account_id: first.body.account_id,
      contact_id: first.body.contact_id,
      account_created: false,
      contact_created: false,
    });
    expect(second.body.opportunity_id).not.toBe(first.body.opportunity_id);
    const end = await counts();
    expect([end.accounts - mid.accounts, end.contacts - mid.contacts, end.opportunities - mid.opportunities]).toEqual([0, 0, 1]);

    // A colleague at the same organization becomes a second contact on the same account.
    const third = await post(payload({ name: "Cher", email: "cher@brightwater.example.com", receivedAt: "2026-10-11T09:00:00.000Z" }));
    expect(third.body).toMatchObject({ account_id: first.body.account_id, account_created: false, contact_created: true });
    expect(await store.get("contacts", third.body.contact_id as string)).toMatchObject({ first_name: "Cher", last_name: "(not given)" });
  });

  it("files an enquiry from an existing account under that account's owner, keeping its classification", async () => {
    const { store, post } = await setup();
    const existing = (await store.list("accounts")).find((a) => a.owner_id === SEED_USERS.bd1 && !a.archived_at)!;
    const r = await post(payload({ organization: existing.name.toUpperCase(), sector: "Private sector" }));
    expect(r.body).toMatchObject({ account_id: existing.id, account_created: false });
    expect(await store.get("accounts", existing.id)).toMatchObject({ type: existing.type, tier: existing.tier, sector: existing.sector });
    expect(await store.get("opportunities", r.body.opportunity_id as string)).toMatchObject({
      owner_id: SEED_USERS.bd1,
      kind: "private_deal",
    });
    expect(await store.get("contacts", r.body.contact_id as string)).toMatchObject({ owner_id: SEED_USERS.bd1 });
  });

  it("maps private and undecided sectors to a private account and deal, and honours LEAD_DEFAULT_OWNER_EMAIL", async () => {
    const { store, post } = await setup();
    const r = await post(payload({ organization: "Northwind Freight", sector: "Not sure yet", deadline: "" }), undefined, {
      defaultOwnerEmail: "Priya@konnectorllc.com",
    });
    expect(await store.get("accounts", r.body.account_id as string)).toMatchObject({ type: "private", owner_id: SEED_USERS.bd2 });
    expect(await store.get("opportunities", r.body.opportunity_id as string)).toMatchObject({
      kind: "private_deal",
      owner_id: SEED_USERS.bd2,
    });
    // An email that isn't an active admin, executive or bd falls back to the admin.
    const r2 = await post(payload({ organization: "Southwind Freight", receivedAt: "2026-10-10T10:00:00Z" }), undefined, {
      defaultOwnerEmail: "tiara@konnectorllc.com",
    });
    expect(await store.get("accounts", r2.body.account_id as string)).toMatchObject({ owner_id: SEED_USERS.admin });
  });

  it("retries a failed attempt without duplicating what the first attempt created", async () => {
    const { store, post, counts } = await setup();
    const before = await counts();
    const insert = store.insert.bind(store);
    let fail = true;
    store.insert = (async (table: Parameters<typeof insert>[0], row: never) => {
      if (fail && table === "opportunities") throw new Error("database unavailable");
      return insert(table, row);
    }) as typeof store.insert;
    expect(await post(payload())).toMatchObject({ status: 500, body: { error: "could not record the enquiry" } });
    const [event] = await store.list("integration_events", { where: { idempotency_key: enquiryKey(lead) } });
    expect(event).toMatchObject({ status: "failed", last_error: "database unavailable" });
    fail = false;
    expect(await post(payload())).toMatchObject({ status: 200, body: { account_created: false, contact_created: false } });
    const after = await counts();
    expect([after.accounts - before.accounts, after.contacts - before.contacts, after.opportunities - before.opportunities]).toEqual([
      1, 1, 1,
    ]);
    expect(after.events - before.events).toBe(1);
  });
});

describe("helpers", () => {
  it("splits names and finds the next business day", () => {
    expect(splitName("  Ada   Lovelace King ")).toEqual({ first_name: "Ada", last_name: "Lovelace King" });
    expect(splitName("Cher")).toEqual({ first_name: "Cher", last_name: "(not given)" });
    expect(nextBusinessDay("2026-10-08T12:00:00Z")).toBe("2026-10-09"); // Thu → Fri
    expect(nextBusinessDay("2026-10-09T12:00:00Z")).toBe("2026-10-12"); // Fri → Mon
    expect(nextBusinessDay("2026-10-10T12:00:00Z")).toBe("2026-10-12"); // Sat → Mon
  });
});
