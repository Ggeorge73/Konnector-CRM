"use server";
import { liveModel } from "@/lib/copilot/anthropic";
import { runCopilot, type CopilotInput } from "@/lib/copilot/run";
import type { RelatedType } from "@/lib/domain/types";
import { run } from "@/lib/services/action";
import { createTask } from "@/lib/services/core";

export async function copilotAction(input: CopilotInput) {
  return run((c) => runCopilot(c, input, liveModel()));
}

/** Creates the reviewed follow-ups the user ticked — Copilot itself never writes to the CRM. */
export async function createCopilotTasksAction(
  tasks: Array<{ title: string; due_in_days: number; priority: "low" | "medium" | "high" }>,
  related: { type: RelatedType; id: string; accountId: string | null },
) {
  return run(
    async (c) => {
      const out = [];
      for (const t of tasks.slice(0, 20)) {
        out.push(
          await createTask(c, {
            title: t.title,
            priority: t.priority,
            due_at: new Date(c.now.getTime() + t.due_in_days * 86_400_000).toISOString(),
            related_type: related.type,
            related_id: related.id,
            account_id: related.accountId,
          }),
        );
      }
      return { created: out.length };
    },
    ["/my-work"],
  );
}
