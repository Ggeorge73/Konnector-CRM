/** Copilot usage log: people see their own requests; admins and executives see everyone's. */
import { isLeader } from "@/lib/auth/permissions";
import type { CopilotRun } from "@/lib/domain/types";
import type { Ctx } from "@/lib/services/context-types";
import { usersById } from "@/lib/services/core";

export type CopilotUsageRow = CopilotRun & { user: string };

export async function copilotUsage(c: Ctx, days = 30) {
  const since = new Date(c.now.getTime() - days * 86_400_000).toISOString();
  const [rows, users] = await Promise.all([
    c.store.list("copilot_runs", {
      where: isLeader(c.user) ? {} : { user_id: c.user.id },
      orderBy: { column: "created_at", ascending: false },
      limit: 1000,
    }),
    usersById(c),
  ]);
  const recent = rows.filter((r) => r.created_at >= since);
  const totals = {
    requests: recent.length,
    inputTokens: recent.reduce((s, r) => s + r.input_tokens, 0),
    outputTokens: recent.reduce((s, r) => s + r.output_tokens, 0),
    failed: recent.filter((r) => r.status === "error" || r.status === "refused").length,
  };
  return {
    scope: isLeader(c.user) ? ("everyone" as const) : ("mine" as const),
    days,
    totals,
    rows: recent.map((r) => ({ ...r, user: users.get(r.user_id)?.full_name ?? "Unknown" })) as CopilotUsageRow[],
  };
}
