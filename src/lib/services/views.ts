import { z } from "zod";
import { isLeader } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/errors";
import type { SavedView } from "@/lib/domain/types";
import type { Ctx } from "./context-types";
import { actorId } from "./system";

export async function savedViews(c: Ctx, entity: SavedView["entity"]) {
  const all = await c.store.list("saved_views", { where: { entity }, orderBy: { column: "name" } });
  return all.filter((v) => v.shared || v.owner_id === c.user.id);
}

export async function saveView(c: Ctx, entity: SavedView["entity"], name: string, query: Record<string, string>, shared: boolean) {
  const v = z.object({ name: z.string().trim().min(2, "Give the view a name").max(60) }).parse({ name });
  return c.store.insert("saved_views", {
    org_id: c.user.org_id,
    owner_id: c.user.id,
    entity,
    name: v.name,
    query,
    shared,
    created_by: actorId(c),
  });
}

export async function deleteSavedView(c: Ctx, id: string) {
  const v = await c.store.get("saved_views", id);
  if (!v) return;
  if (v.owner_id !== c.user.id && !isLeader(c.user)) throw new ForbiddenError("Only the owner can delete this view.");
  await c.store.update("saved_views", id, { archived_at: c.now.toISOString() });
}
