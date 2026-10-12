/**
 * Demo responses when no Anthropic credential is configured (COPILOT_MODE=demo or auto without a key).
 * Deterministic and derived from the same role-scoped CRM data, clearly labelled "Demo" in the UI,
 * so the flows can be exercised end to end without calling Claude.
 */
import { BID_CRITERIA, type BidCriterion } from "@/lib/domain/types";
import { daysUntil, humanize } from "@/lib/format";
import { getOpportunity } from "@/lib/services/capture";
import type { Ctx } from "@/lib/services/context-types";
import { getAccount, timelineFor, visibleOpportunities } from "@/lib/services/core";
import type { CopilotInput } from "./run";

const ACTION_WORDS =
  /\b(send|share|schedule|book|follow up|follow-up|confirm|prepare|draft|call|email|introduce|set up|review|update|get|ask|check)\b/i;

export async function demoOutput(c: Ctx, input: CopilotInput, contextText: string): Promise<unknown> {
  switch (input.task) {
    case "account_summary": {
      const a = await getAccount(c, input.accountId);
      const opps = (await visibleOpportunities(c)).filter((o) => o.account_id === a.id);
      const open = opps.filter((o) => !["won", "lost", "no_bid"].includes(o.stage));
      const acts = await timelineFor(c, "account", a.id);
      return {
        headline: `${a.name} is a tier ${a.tier} ${humanize(a.status).toLowerCase()} with ${open.length} open pursuit${open.length === 1 ? "" : "s"}.`,
        situation: [
          `${humanize(a.type)} in ${a.sector.toLowerCase()}, based in ${[a.city, a.state_region].filter(Boolean).join(", ")}.`,
          acts[0] ? `Latest activity: "${acts[0].subject}" (${acts[0].occurred_at.slice(0, 10)}).` : "No recent activity logged.",
          a.survey_score !== null ? `Last client survey scored ${a.survey_score}/10.` : "No client survey on record yet.",
        ],
        opportunities: open.map((o) => ({ name: o.name, status: humanize(o.stage), note: o.next_step ?? "No next step recorded" })),
        risks: open
          .filter((o) => (daysUntil(o.proposal_due, c.now) ?? 99) <= 14)
          .map((o) => `${o.name}: proposal due within two weeks.`)
          .concat(acts.length < 3 ? ["Thin activity history — relationship may be single-threaded."] : []),
        next_actions: open.slice(0, 3).map((o) => o.next_step ?? `Agree a next step on ${o.name}`),
      };
    }
    case "followup_email": {
      const firstLine = contextText.split("\n").find((l) => l.startsWith("- ")) ?? "";
      const topic = firstLine.replace(/^- \S+ \[\w+\] /, "").split(":")[0] || "our recent conversation";
      return {
        subject: `Following up: ${topic}`.slice(0, 90),
        body: `Hello,\n\nThank you for your time recently on ${topic.toLowerCase()}. As promised, I wanted to follow up with a short summary and next steps.\n\n- We'll share the materials we discussed this week.\n- Could we find 30 minutes next week to walk through any questions?\n\nBest regards,\n${c.user.full_name}\n${c.user.title}, Konnector LLC`,
        rationale: `Based on the most recent timeline entry ("${topic}").`,
      };
    }
    case "bid_suggestion": {
      const o = await getOpportunity(c, input.opportunityId);
      const d = daysUntil(o.proposal_due, c.now) ?? 30;
      const scores = Object.fromEntries(BID_CRITERIA.map((k) => [k, 3])) as Record<BidCriterion, number>;
      scores.customer_relationship = /active_client|referral/.test(o.source) ? 4 : 3;
      scores.staffing_availability = d < 14 ? 2 : 3;
      scores.competitive_position = o.incumbent && !/none|unknown/i.test(o.incumbent) ? 2 : 3;
      const total = BID_CRITERIA.reduce((s, k) => s + scores[k], 0) / BID_CRITERIA.length;
      return {
        scores,
        reasons: Object.fromEntries(
          BID_CRITERIA.map((k) => [k, `Demo heuristic — review ${humanize(k).toLowerCase()} with the capture team.`]),
        ),
        verdict: total >= 3.5 ? "bid" : total >= 2.75 ? "conditional" : "no_bid",
        rationale:
          "Demo suggestion from simple rules (relationship, incumbent, time to proposal). Configure ANTHROPIC_API_KEY for a reasoned suggestion.",
        open_questions: [
          "Who is the incumbent and how is their performance rated?",
          "Can we name key personnel today?",
          "Is there a teaming partner for gaps?",
        ],
      };
    }
    case "notes_to_tasks": {
      const sentences = input.notes
        .split(/(?<=[.!?\n])\s+/)
        .map((s) => s.trim())
        .filter((s) => ACTION_WORDS.test(s));
      return {
        summary: input.notes
          .trim()
          .split(/\n|(?<=\.)\s/)[0]
          .slice(0, 200),
        tasks: sentences.slice(0, 8).map((s) => ({
          title: s.replace(/^[-•*]\s*/, "").slice(0, 80),
          due_in_days: /urgent|asap|tomorrow/i.test(s) ? 1 : 3,
          priority: /urgent|asap/i.test(s) ? "high" : "medium",
          owner_hint: "",
        })),
      };
    }
    case "rfp_checklist": {
      const o = await getOpportunity(c, input.opportunityId);
      return {
        solicitation: {
          title: o.name,
          number: o.solicitation_no ?? "—",
          agency: o.agency_buyer ?? "—",
          summary: "Demo checklist — configure ANTHROPIC_API_KEY to have Claude read the PDF.",
        },
        key_dates: [
          o.questions_due && { label: "Questions due", date: o.questions_due },
          o.proposal_due && { label: "Proposal due", date: o.proposal_due },
        ].filter(Boolean),
        requirements: [
          {
            ref: "Instructions",
            requirement: "Submit through the stated procurement vehicle before the deadline",
            category: "submission",
            mandatory: true,
          },
          {
            ref: "Instructions",
            requirement: "Include signed forms and certifications (e.g. SAM registration)",
            category: "compliance",
            mandatory: true,
          },
          { ref: "Statement of work", requirement: "Technical approach addressing every SOW task", category: "technical", mandatory: true },
          { ref: "Statement of work", requirement: "Key personnel resumes and staffing plan", category: "staffing", mandatory: true },
          { ref: "Pricing", requirement: "Price volume in the required format", category: "pricing", mandatory: true },
        ],
        evaluation_criteria: ["Technical approach", "Past performance", "Key personnel", "Price"],
        risks: ["Confirm page limits and font rules before writing.", "Check registration expiry dates against the due date."],
      };
    }
  }
}
