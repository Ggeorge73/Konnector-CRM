import { AuditView } from "@/components/work/AuditView";
import { usersById } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const c = await ctx("/audit");
  const [rows, users] = await Promise.all([
    c.store.list("audit_log", { orderBy: { column: "created_at", ascending: false }, limit: 500 }),
    usersById(c),
  ]);
  return <AuditView rows={rows.map((r) => ({ ...r, actor: r.actor_id ? (users.get(r.actor_id)?.full_name ?? "Unknown") : "System" }))} />;
}
