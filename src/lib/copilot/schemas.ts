import { z } from "zod";
import { BID_CRITERIA } from "@/lib/domain/types";

/** Structured outputs per Copilot task (validated by the SDK's Zod output format and again on return). */
export const AccountSummary = z.object({
  headline: z.string().describe("One sentence on where this relationship stands"),
  situation: z.array(z.string()).describe("3-5 bullets: what is happening with this account"),
  opportunities: z.array(z.object({ name: z.string(), status: z.string(), note: z.string() })),
  risks: z.array(z.string()),
  next_actions: z.array(z.string()).describe("Concrete next steps for the account owner"),
});

export const FollowupEmail = z.object({
  subject: z.string(),
  body: z.string().describe("Plain-text email body, ready to edit, signed by the user"),
  rationale: z.string().describe("One sentence on why this follow-up, based on the timeline"),
});

const Score = z.number().int().min(1).max(5);
export const BidSuggestion = z.object({
  scores: z.object(Object.fromEntries(BID_CRITERIA.map((c) => [c, Score])) as Record<(typeof BID_CRITERIA)[number], typeof Score>),
  reasons: z.object(Object.fromEntries(BID_CRITERIA.map((c) => [c, z.string()])) as Record<(typeof BID_CRITERIA)[number], z.ZodString>),
  verdict: z.enum(["bid", "conditional", "no_bid"]),
  rationale: z.string(),
  open_questions: z.array(z.string()),
});

export const NotesToTasks = z.object({
  summary: z.string(),
  tasks: z.array(
    z.object({
      title: z.string(),
      due_in_days: z.number().int().min(0).max(90),
      priority: z.enum(["low", "medium", "high"]),
      owner_hint: z.string().describe("Who should own it, if the notes say; else empty"),
    }),
  ),
});

export const RfpChecklist = z.object({
  solicitation: z.object({ title: z.string(), number: z.string(), agency: z.string(), summary: z.string() }),
  key_dates: z.array(z.object({ label: z.string(), date: z.string().describe("ISO date if stated, else as written") })),
  requirements: z.array(
    z.object({
      ref: z.string().describe("Section or page reference"),
      requirement: z.string(),
      category: z.enum(["submission", "technical", "management", "staffing", "pricing", "compliance", "legal"]),
      mandatory: z.boolean(),
    }),
  ),
  evaluation_criteria: z.array(z.string()),
  risks: z.array(z.string()),
});

export const OUTPUT_SCHEMAS = {
  account_summary: AccountSummary,
  followup_email: FollowupEmail,
  bid_suggestion: BidSuggestion,
  notes_to_tasks: NotesToTasks,
  rfp_checklist: RfpChecklist,
} as const;

export type CopilotOutputs = { [K in keyof typeof OUTPUT_SCHEMAS]: z.infer<(typeof OUTPUT_SCHEMAS)[K]> };
