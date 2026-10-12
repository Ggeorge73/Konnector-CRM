"use server";
import { run } from "@/lib/services/action";
import { retryHandoff, startHandoff, type HandoffInputT } from "@/lib/services/handoff";

export async function startHandoffAction(opportunityId: string, input: HandoffInputT) {
  return run((c) => startHandoff(c, opportunityId, input), [`/opportunities/${opportunityId}`, "/opportunities", "/"]);
}
export async function retryHandoffAction(handoffId: string, opportunityId: string) {
  return run((c) => retryHandoff(c, handoffId), [`/opportunities/${opportunityId}`]);
}

export async function retryEventAction(eventId: string) {
  return run(
    async (c) => {
      const { retryOne } = await import("@/lib/integration/outbox");
      const { syncHandoffs } = await import("@/lib/services/handoff");
      const { canRunHandoff } = await import("@/lib/auth/permissions");
      const { ForbiddenError } = await import("@/lib/auth/errors");
      if (!canRunHandoff(c.user)) throw new ForbiddenError();
      const e = await retryOne(c, eventId);
      await syncHandoffs(c);
      return e;
    },
    ["/integrations"],
  );
}
