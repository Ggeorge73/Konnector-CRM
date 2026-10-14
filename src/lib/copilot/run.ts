/**
 * Konnector Copilot runner. Server-side only: the Anthropic key never reaches the browser.
 * Nothing Copilot produces is sent or saved without a human click — callers only get drafts.
 */
import { z } from "zod";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { canSeeBidDecision } from "@/lib/auth/permissions";
import type { CopilotTask, RelatedType } from "@/lib/domain/types";
import { buckets, getRateLimiter, memoryRateLimiter, type RateLimiter, type RateLimitRule } from "@/lib/rate-limit";
import { getOpportunity } from "@/lib/services/capture";
import type { Ctx } from "@/lib/services/context-types";
import { actorId } from "@/lib/services/system";
import { accountContext, assertCanUseOn, bidContext, followupContext } from "./context";
import { demoOutput } from "./demo";
import { OUTPUT_SCHEMAS, type CopilotOutputs } from "./schemas";

export const COPILOT_MODEL = "claude-opus-5-5";

/** One model call: system prompt + user content → structured output. Injectable for tests. */
export interface CopilotModel {
  generate<S extends z.ZodType>(args: {
    system: string;
    content: Array<
      { type: "text"; text: string } | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
    >;
    schema: S;
    effort: "low" | "medium" | "high";
  }): Promise<{
    output: z.infer<S> | null;
    stopReason: string | null;
    refusalCategory: string | null;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }>;
}

export type CopilotInput =
  | { task: "account_summary"; accountId: string }
  | { task: "followup_email"; relatedType: RelatedType; relatedId: string; instructions?: string }
  | { task: "bid_suggestion"; opportunityId: string }
  | { task: "notes_to_tasks"; notes: string; relatedType: RelatedType; relatedId: string }
  | { task: "rfp_checklist"; opportunityId: string; fileId: string };

export type CopilotResult<T extends CopilotTask = CopilotTask> =
  | {
      ok: true;
      task: T;
      output: CopilotOutputs[T];
      demo: boolean;
      recipients?: Array<{ id: string; name: string; email: string }>;
      accountId?: string;
    }
  | { ok: false; task: T; reason: "refused" | "error"; message: string };

const BASE_SYSTEM = `You are Konnector Copilot, an assistant inside Konnector CRM, the internal business-development system of Konnector LLC — a Georgia-based technology implementation firm that wins government and private projects (implementation, systems integration, staffing, reselling, advisory). Your readers are Konnector's own staff.

Work only from the CRM context provided in the request. If something isn't in the context, say it's unknown rather than guessing; never invent names, figures, dates or commitments. Be specific and brief — staff will skim this between calls. Everything you write is a draft a person reviews before anything is sent or saved.`;

const TASK_SYSTEM: Record<CopilotTask, string> = {
  account_summary:
    "Summarise the account for its owner: where the relationship stands, what's in flight, risks, and the next few actions that would most help win or grow work.",
  followup_email:
    "Draft a short, warm, professional follow-up email from the requesting user to the client, grounded in the most recent interactions on the timeline. Reference specific prior touchpoints. Plain text, no placeholders except the sender's sign-off name which is given. Never mention internal pricing strategy, margins, scores or internal notes.",
  bid_suggestion:
    "Suggest Bid/No-Bid scores (1–5) for each criterion with a one-sentence reason each, a verdict consistent with the weighted thresholds, and the open questions the capture team should answer before deciding. Be candid: a no-bid is a good outcome when the evidence supports it.",
  notes_to_tasks:
    "Turn the meeting notes into concrete BD follow-up tasks (calls, emails, documents to send, internal prep). One action per task, imperative titles under 80 characters. Skip anything that is project delivery work — that lives in Konnect Hub.",
  rfp_checklist:
    "Read the solicitation document and produce a compliance checklist for the proposal team: identifying details, key dates, every distinct requirement with its section/page reference and whether it is mandatory ('shall'/'must'), the evaluation criteria, and risks to a compliant, competitive response.",
};

const EFFORT: Record<CopilotTask, "low" | "medium" | "high"> = {
  account_summary: "medium",
  followup_email: "low",
  bid_suggestion: "high",
  notes_to_tasks: "low",
  rfp_checklist: "high",
};

// ---------- rate limit (per user, per hour; shared RateLimiter — Postgres in Supabase mode) ----------
export const COPILOT_HOURLY_LIMIT = 40;
export const COPILOT_RATE_RULE: RateLimitRule = { limit: COPILOT_HOURLY_LIMIT, windowMs: 60 * 60_000 };
/** Tests only: clears the Copilot buckets of the in-memory limiter. */
export function resetCopilotRateLimit() {
  memoryRateLimiter().reset("copilot:");
}

async function record(
  c: Ctx,
  task: CopilotTask,
  related: { type: RelatedType | null; id: string | null },
  status: "ok" | "refused" | "error" | "demo",
  r: { model: string; inputTokens: number; outputTokens: number; ms: number; error?: string | null },
) {
  await c.store.insert("copilot_runs", {
    org_id: c.user.org_id,
    user_id: c.user.id,
    task,
    related_type: related.type,
    related_id: related.id,
    model: r.model,
    status,
    input_tokens: r.inputTokens,
    output_tokens: r.outputTokens,
    latency_ms: r.ms,
    error: r.error ?? null,
    created_by: actorId(c),
  });
}

export async function runCopilot<T extends CopilotTask>(
  c: Ctx,
  input: CopilotInput & { task: T },
  model: CopilotModel | null,
  deps?: { limiter?: RateLimiter },
): Promise<CopilotResult<T>> {
  const task = input.task as T;
  const related = relatedOf(input);
  await assertCanUseOn(c, related.type, related.id);
  const inp = input as CopilotInput;
  if (inp.task === "bid_suggestion") {
    const o = await getOpportunity(c, inp.opportunityId);
    if (!canSeeBidDecision(c.user, o)) throw new ForbiddenError("Bid scoring is restricted to the deal owner and executives.");
  }
  const limiter = deps?.limiter ?? (await getRateLimiter());
  if (!(await limiter.take(buckets.copilot(c.user.id), COPILOT_RATE_RULE, c.now)).allowed)
    throw new ValidationError(`Copilot limit reached (${COPILOT_HOURLY_LIMIT} requests an hour). Try again shortly.`);

  // Build the context (role-scoped) — shared by live and demo modes.
  const built = await buildContent(c, input);
  const started = Date.now();
  const schema = OUTPUT_SCHEMAS[task] as unknown as z.ZodType<CopilotOutputs[T]>;

  if (!model) {
    const output = schema.parse(await demoOutput(c, input, built.text));
    await record(c, task, related, "demo", { model: "demo", inputTokens: 0, outputTokens: 0, ms: Date.now() - started });
    return { ok: true, task, output, demo: true, recipients: built.recipients, accountId: built.accountId };
  }

  try {
    const res = await model.generate({
      system: `${BASE_SYSTEM}\n\n${TASK_SYSTEM[task]}`,
      content: built.content,
      schema,
      effort: EFFORT[task],
    });
    if (res.stopReason === "refusal") {
      await record(c, task, related, "refused", {
        model: res.model,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        ms: Date.now() - started,
        error: res.refusalCategory,
      });
      return { ok: false, task, reason: "refused", message: "Copilot declined this request. Try rephrasing, or do this one by hand." };
    }
    const parsed = schema.safeParse(res.output);
    if (!parsed.success) {
      await record(c, task, related, "error", {
        model: res.model,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        ms: Date.now() - started,
        error: `invalid output (${res.stopReason})`,
      });
      return {
        ok: false,
        task,
        reason: "error",
        message:
          res.stopReason === "max_tokens"
            ? "The answer was too long to finish. Try a narrower request."
            : "Copilot returned an unexpected answer. Please try again.",
      };
    }
    await record(c, task, related, "ok", {
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      ms: Date.now() - started,
    });
    return { ok: true, task, output: parsed.data, demo: false, recipients: built.recipients, accountId: built.accountId };
  } catch (e) {
    await record(c, task, related, "error", {
      model: COPILOT_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      ms: Date.now() - started,
      error: (e as Error).message.slice(0, 300),
    });
    return { ok: false, task, reason: "error", message: "Copilot is unavailable right now. Please try again in a minute." };
  }
}

function relatedOf(input: CopilotInput): { type: RelatedType | null; id: string | null } {
  switch (input.task) {
    case "account_summary":
      return { type: "account", id: input.accountId };
    case "bid_suggestion":
    case "rfp_checklist":
      return { type: "opportunity", id: input.opportunityId };
    default:
      return { type: input.relatedType, id: input.relatedId };
  }
}

type Built = {
  content: Parameters<CopilotModel["generate"]>[0]["content"];
  text: string;
  recipients?: Array<{ id: string; name: string; email: string }>;
  accountId?: string;
};

async function buildContent(c: Ctx, input: CopilotInput): Promise<Built> {
  const wrap = (text: string, ask: string): Built => ({
    text,
    content: [{ type: "text", text: `<crm_context>\n${text}\n</crm_context>\n\n${ask}` }],
  });
  switch (input.task) {
    case "account_summary":
      return wrap(await accountContext(c, input.accountId), "Summarise this account.");
    case "followup_email": {
      const f = await followupContext(c, input.relatedType, input.relatedId);
      const extra = input.instructions?.trim() ? `\nExtra instructions from the user: ${input.instructions.trim().slice(0, 500)}` : "";
      return {
        ...wrap(f.text, `Draft the follow-up email. Sign it "${c.user.full_name}, ${c.user.title}, Konnector LLC".${extra}`),
        recipients: f.recipients,
        accountId: f.accountId,
      };
    }
    case "bid_suggestion":
      return wrap(await bidContext(c, input.opportunityId), "Suggest the Bid/No-Bid scores, reasons, verdict and open questions.");
    case "notes_to_tasks": {
      const notes = input.notes.trim();
      if (notes.length < 20) throw new ValidationError("Paste the meeting notes first (at least a couple of sentences).");
      if (notes.length > 20_000) throw new ValidationError("Notes are too long — paste up to 20,000 characters.");
      return wrap(`Meeting notes:\n${notes}`, "Extract the follow-up tasks.");
    }
    case "rfp_checklist": {
      const o = await getOpportunity(c, input.opportunityId);
      const f = await c.store.get("files", input.fileId);
      if (!f || f.related_type !== "opportunity" || f.related_id !== o.id)
        throw new ValidationError("Pick a PDF attached to this opportunity.");
      if (f.mime !== "application/pdf") throw new ValidationError("RFP summaries need a PDF.");
      const { readFile } = await import("@/lib/services/files");
      const { bytes } = await readFile(c, f.id);
      return {
        text: `RFP file: ${f.name} for ${o.name}`,
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
          {
            type: "text",
            text: `This is the solicitation for "${o.name}"${o.solicitation_no ? ` (${o.solicitation_no})` : ""}. Produce the compliance checklist.`,
          },
        ],
      };
    }
  }
}
