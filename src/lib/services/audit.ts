import type { Ctx } from "./context-types";

/** Append-only audit entry for money, stage, ownership and permission changes. */
export async function audit(c: Ctx, action: string, entity: string, entityId: string, before: object | null, after: object | null) {
  await c.store.insert("audit_log", {
    org_id: c.user.org_id,
    actor_id: c.user.id,
    action,
    entity,
    entity_id: entityId,
    before: before as Record<string, unknown> | null,
    after: after as Record<string, unknown> | null,
    created_by: c.user.id,
  });
}

/** Only keep keys that changed, for compact before/after records. */
export function diff<T extends object>(before: T, patch: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const old = (before as Record<string, unknown>)[k];
    if (JSON.stringify(old) !== JSON.stringify(v)) {
      b[k] = old;
      a[k] = v;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
