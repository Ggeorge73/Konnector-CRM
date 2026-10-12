import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { COPILOT_HOURLY_LIMIT, resetCopilotRateLimit, runCopilot, type CopilotModel } from "@/lib/copilot/run";
import { OUTPUT_SCHEMAS } from "@/lib/copilot/schemas";
import { copilotUsage } from "@/lib/copilot/usage";
import { seedIds } from "@/lib/data/seed";
import { asUser, switchUser } from "./helpers";

const ids = seedIds();

/** A fake Claude: records what it was sent and returns a canned answer. */
function fakeModel(reply: (schema: unknown) => { output: unknown; stopReason?: string; refusalCategory?: string | null } | Error) {
  const calls: Array<{ system: string; text: string; effort: string }> = [];
  const model: CopilotModel = {
    async generate({ system, content, schema, effort }) {
      calls.push({ system, effort, text: content.map((c) => (c.type === "text" ? c.text : "[document]")).join("\n") });
      const r = reply(schema);
      if (r instanceof Error) throw r;
      return {
        output: r.output as never,
        stopReason: r.stopReason ?? "end_turn",
        refusalCategory: r.refusalCategory ?? null,
        inputTokens: 1200,
        outputTokens: 300,
        model: "test-model",
      };
    },
  };
  return { model, calls };
}

const summary = {
  headline: "Strong relationship",
  situation: ["Active proposal"],
  opportunities: [],
  risks: ["Incumbent"],
  next_actions: ["Call the CIO"],
};

beforeEach(() => resetCopilotRateLimit());

describe("Copilot", () => {
  it("answers from scoped CRM data in demo mode and logs usage without content", async () => {
    const bd = await asUser("bd1");
    const r = await runCopilot(bd, { task: "account_summary", accountId: ids.account("gta") }, null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.demo).toBe(true);
      expect(OUTPUT_SCHEMAS.account_summary.safeParse(r.output).success).toBe(true);
    }
    const runs = await bd.store.list("copilot_runs");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ user_id: bd.user.id, task: "account_summary", status: "demo", related_type: "account" });
    expect(Object.keys(runs[0])).not.toContain("output");
  });

  it("sends Claude the role-scoped context and never cost-side data", async () => {
    const bd = await asUser("bd1");
    const { model, calls } = fakeModel(() => ({
      output: {
        scores: {
          strategic_fit: 4,
          customer_relationship: 3,
          competitive_position: 3,
          capability: 4,
          staffing_availability: 3,
          margin: 3,
          risk: 3,
        },
        reasons: Object.fromEntries(
          ["strategic_fit", "customer_relationship", "competitive_position", "capability", "staffing_availability", "margin", "risk"].map(
            (k) => [k, "ok"],
          ),
        ),
        verdict: "conditional",
        rationale: "Worth pursuing with conditions.",
        open_questions: ["Who is the incumbent?"],
      },
    }));
    const r = await runCopilot(bd, { task: "bid_suggestion", opportunityId: ids.opp("dor-mvs") }, model);
    expect(r.ok).toBe(true);
    expect(calls[0].effort).toBe("high");
    expect(calls[0].text).toContain("Motor Vehicle System Integration");
    // BD can't see the bench, so no consultant data at all; and never cost rates or quote costs.
    expect(calls[0].text).toContain("not visible to this user");
    const consultants = await bd.store.list("consultants");
    const costs = consultants.map((x) => x.rate_cost).filter((x): x is number => !!x);
    const quoteCosts = (await bd.store.list("quote_lines")).map((l) => l.unit_cost);
    for (const v of [...costs, ...quoteCosts]) {
      expect(calls[0].text).not.toContain(`$${v.toLocaleString("en-US")}`);
      if (v >= 1000) expect(calls[0].text).not.toMatch(new RegExp(`\\b${v}\\b`));
    }
    for (const word of ["rate_cost", "unit_cost", "margin_pct", "vetting"]) expect(calls[0].text).not.toContain(word);
  });

  it("restricts bid suggestions to people who can score the deal", async () => {
    const owner = await asUser("bd1");
    const recruiter = await switchUser(owner, "recruiter");
    await expect(runCopilot(recruiter, { task: "bid_suggestion", opportunityId: ids.opp("dor-mvs") }, null)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const priya = await switchUser(owner, "bd2"); // shared with, not the owner
    await expect(runCopilot(priya, { task: "bid_suggestion", opportunityId: ids.opp("dor-mvs") }, null)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("won't run on records the user can't see", async () => {
    const recruiter = await asUser("recruiter");
    await expect(
      runCopilot(recruiter, { task: "followup_email", relatedType: "opportunity", relatedId: ids.opp("dor-mvs") }, null),
    ).rejects.toThrow();
    expect(await recruiter.store.list("copilot_runs")).toHaveLength(0);
  });

  it("handles refusals, bad output and outages without throwing", async () => {
    const bd = await asUser("bd1");
    const refused = await runCopilot(
      bd,
      { task: "account_summary", accountId: ids.account("gta") },
      fakeModel(() => ({ output: null, stopReason: "refusal", refusalCategory: "cyber" })).model,
    );
    expect(refused).toMatchObject({ ok: false, reason: "refused" });
    const bad = await runCopilot(
      bd,
      { task: "account_summary", accountId: ids.account("gta") },
      fakeModel(() => ({ output: { headline: 1 }, stopReason: "max_tokens" })).model,
    );
    expect(bad).toMatchObject({ ok: false, reason: "error", message: expect.stringMatching(/too long/) });
    const down = await runCopilot(
      bd,
      { task: "account_summary", accountId: ids.account("gta") },
      fakeModel(() => new Error("overloaded")).model,
    );
    expect(down).toMatchObject({ ok: false, reason: "error" });
    const ok = await runCopilot(
      bd,
      { task: "account_summary", accountId: ids.account("gta") },
      fakeModel(() => ({ output: summary })).model,
    );
    expect(ok).toMatchObject({ ok: true, demo: false });
    const statuses = (await bd.store.list("copilot_runs")).map((r) => r.status).sort();
    expect(statuses).toEqual(["error", "error", "ok", "refused"]);
  });

  it("drafts follow-up emails with recipients from the record", async () => {
    const bd = await asUser("bd1");
    const { model, calls } = fakeModel(() => ({
      output: { subject: "Following up", body: "Hi — thanks for the time last week.", rationale: "Last touch was the demo." },
    }));
    const r = await runCopilot(
      bd,
      { task: "followup_email", relatedType: "opportunity", relatedId: ids.opp("gta-ess"), instructions: "Mention the demo" },
      model,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.recipients?.length).toBeGreaterThan(0);
    expect(calls[0].text).toContain("Mention the demo");
    expect(calls[0].text).toContain(bd.user.full_name);
  });

  it("validates meeting notes and rate-limits each user", async () => {
    const bd = await asUser("bd1");
    await expect(
      runCopilot(bd, { task: "notes_to_tasks", notes: "too short", relatedType: "account", relatedId: ids.account("gta") }, null),
    ).rejects.toBeInstanceOf(ValidationError);
    resetCopilotRateLimit();
    for (let i = 0; i < COPILOT_HOURLY_LIMIT; i++) await runCopilot(bd, { task: "account_summary", accountId: ids.account("gta") }, null);
    await expect(runCopilot(bd, { task: "account_summary", accountId: ids.account("gta") }, null)).rejects.toThrow(/limit/);
    const exec = await switchUser(bd, "exec");
    await expect(runCopilot(exec, { task: "account_summary", accountId: ids.account("gta") }, null)).resolves.toMatchObject({ ok: true });
  });

  it("shows people their own usage and leaders everyone's", async () => {
    const bd = await asUser("bd1");
    await runCopilot(bd, { task: "account_summary", accountId: ids.account("gta") }, null);
    const priya = await switchUser(bd, "bd2");
    await runCopilot(
      priya,
      {
        task: "notes_to_tasks",
        notes: "Met the CIO. Send the capability deck by Friday and book a demo.",
        relatedType: "opportunity",
        relatedId: ids.opp("dor-mvs"),
      },
      null,
    );
    expect((await copilotUsage(priya)).rows.map((r) => r.user_id)).toEqual([priya.user.id]);
    const exec = await switchUser(bd, "exec");
    const all = await copilotUsage(exec);
    expect(all.scope).toBe("everyone");
    expect(all.totals.requests).toBe(2);
  });
});
