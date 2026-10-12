import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { COPILOT_MODEL, type CopilotModel } from "./run";

/** Live mode when a server-side credential exists (or COPILOT_MODE=live); demo otherwise. */
export function copilotMode(): "live" | "demo" {
  const mode = process.env.COPILOT_MODE ?? "auto";
  if (mode === "live" || mode === "demo") return mode;
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "live" : "demo";
}

let client: Anthropic | null = null;

/** Claude via the official SDK: structured output, server-side refusal fallback, adaptive thinking (default on Opus 5.5). */
export const anthropicModel: CopilotModel = {
  async generate({ system, content, schema, effort }) {
    client ??= new Anthropic();
    const res = await client.beta.messages.parse({
      model: COPILOT_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content }],
      output_config: { effort, format: betaZodOutputFormat(schema) },
    });
    return {
      output: res.stop_reason === "refusal" ? null : (res.parsed_output ?? null),
      stopReason: res.stop_reason,
      refusalCategory: res.stop_reason === "refusal" ? (res.stop_details?.category ?? null) : null,
      inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
      outputTokens: res.usage.output_tokens,
      model: res.model,
    };
  },
};

export function liveModel(): CopilotModel | null {
  return copilotMode() === "live" ? anthropicModel : null;
}
