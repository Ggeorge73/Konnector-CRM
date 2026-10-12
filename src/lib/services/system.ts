import type { Store } from "@/lib/data/store";
import type { User } from "@/lib/domain/types";
import type { Ctx } from "./context-types";

/** Synthetic actor for webhooks and cron jobs. Never stored as a foreign key (mapped to null). */
export const SYSTEM_USER_ID = "00000000-0000-4000-a000-000000000000";

export async function systemCtx(store: Store, now = new Date()): Promise<Ctx> {
  const [org] = await store.list("organizations");
  const user: User = {
    id: SYSTEM_USER_ID,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    created_by: null,
    archived_at: null,
    org_id: org?.id ?? SYSTEM_USER_ID,
    email: "integration@konnectorllc.com",
    full_name: "Konnect Hub",
    title: "Integration",
    role: "admin",
    avatar_color: "#21D4FD",
    time_zone: "America/New_York",
  };
  return { user, store, now };
}

export const actorId = (c: Ctx) => (c.user.id === SYSTEM_USER_ID ? null : c.user.id);
