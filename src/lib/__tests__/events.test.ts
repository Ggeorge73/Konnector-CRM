import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { seedIds, sid } from "@/lib/data/seed";
import { captureLead, followUpDueAt, getEvent, listEvents, saveEvent } from "@/lib/services/events";
import { asUser, NOW, switchUser } from "./helpers";

const ids = seedIds();
const fair = sid("event:gdot-fair");
const summit = sid("event:gta-summit");

describe("follow-up due date", () => {
  it("is 2 business days after the event end (skipping weekends)", () => {
    // Event ends Saturday 2026-10-31 → Mon 11-02, Tue 11-03
    expect(followUpDueAt({ ends_on: "2026-10-31" }, NOW)).toBe("2026-11-03T21:00:00.000Z");
    // Ends Thursday → Fri, Mon
    expect(followUpDueAt({ ends_on: "2026-10-15" }, NOW)).toBe("2026-10-19T21:00:00.000Z");
    // Ends today → still counts from the end date
    expect(followUpDueAt({ ends_on: "2026-10-12" }, NOW)).toBe("2026-10-14T21:00:00.000Z");
  });

  it("is 2 days from now when the event is already over", () => {
    expect(followUpDueAt({ ends_on: "2026-08-28" }, NOW)).toBe("2026-10-14T21:00:00.000Z");
  });
});

describe("events", () => {
  it("is limited to bd and leaders", async () => {
    const dl = await asUser("delivery");
    await expect(listEvents(dl)).rejects.toBeInstanceOf(ForbiddenError);
    const r = await switchUser(dl, "recruiter");
    await expect(getEvent(r, fair)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists events with visible lead counts", async () => {
    const exec = await asUser("exec");
    const events = await listEvents(exec);
    expect(events).toHaveLength(3);
    expect(events.find((e) => e.id === summit)!.lead_count).toBe(2);
  });

  it("bd creates an event and budget changes are audited", async () => {
    const bd = await asUser("bd1");
    const e = await saveEvent(bd, {
      name: "Savannah Smart Cities Forum",
      kind: "conference",
      starts_on: "2026-11-10",
      ends_on: "2026-11-11",
      location: "Savannah, GA",
      budget: 2500,
      attendee_ids: [bd.user.id],
    });
    await saveEvent(bd, { ...e, notes: "", budget: 3000 }, e.id);
    const log = await bd.store.list("audit_log", { where: { entity_id: e.id } });
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["event.created", "event.budget_changed"]));
    await expect(saveEvent(bd, { ...e, notes: "", ends_on: "2026-11-01" })).rejects.toThrow();
  });
});

describe("captureLead", () => {
  it("creates account + contact + lead + follow-up task + timeline activity, without notifications", async () => {
    const bd = await asUser("bd1");
    const before = (await bd.store.list("notifications")).length;
    const lead = await captureLead(bd, fair, {
      mode: "new",
      contact: {
        new_account: { name: "Henry County Schools", type: "government_local" },
        first_name: "Dana",
        last_name: "Price",
        title: "CIO",
        email: "dana.price@henry.example.org",
      },
      interest: "Student information system integration",
    });
    const contact = (await bd.store.get("contacts", lead.contact_id))!;
    expect(contact.first_name).toBe("Dana");
    const account = (await bd.store.get("accounts", contact.account_id))!;
    expect(account.name).toBe("Henry County Schools");
    expect(account.owner_id).toBe(bd.user.id);

    const task = (await bd.store.get("tasks", lead.follow_up_task_id!))!;
    expect(task.assignee_id).toBe(bd.user.id);
    expect(task.related_type).toBe("contact");
    expect(task.related_id).toBe(contact.id);
    expect(task.due_at).toBe("2026-11-03T21:00:00.000Z");
    expect(task.status).toBe("open");

    const acts = await bd.store.list("activities", { where: { related_type: "contact", related_id: contact.id } });
    expect(acts.some((a) => a.subject === "Met at GDOT Small Business Procurement Fair")).toBe(true);
    expect((await bd.store.list("notifications")).length).toBe(before);

    const detail = await getEvent(bd, fair);
    expect(detail.leads.map((l) => l.contact.id)).toContain(contact.id);
    expect(detail.leads.find((l) => l.contact.id === contact.id)!.task!.id).toBe(task.id);
  });

  it("captures an existing contact at a past event with a due date 2 days out, and rejects duplicates", async () => {
    const exec = await asUser("exec");
    const [ct] = await exec.store.list("contacts", { where: { account_id: ids.account("gta") } });
    const lead = await captureLead(exec, summit, { mode: "existing", contact_id: ct.id, interest: "" });
    const task = (await exec.store.get("tasks", lead.follow_up_task_id!))!;
    expect(task.due_at).toBe("2026-10-14T21:00:00.000Z");
    await expect(captureLead(exec, summit, { mode: "existing", contact_id: ct.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("bd cannot capture a contact on an account they can't see; leads are scoped", async () => {
    const bd = await asUser("bd1");
    const [ct] = await bd.store.list("contacts", { where: { account_id: ids.account("peachtree") } });
    await expect(captureLead(bd, fair, { mode: "existing", contact_id: ct.id })).rejects.toBeInstanceOf(ForbiddenError);
    const dl = await switchUser(bd, "delivery");
    await expect(captureLead(dl, fair, { mode: "existing", contact_id: ct.id })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
