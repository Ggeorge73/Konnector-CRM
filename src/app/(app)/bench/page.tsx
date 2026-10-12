import { BenchView } from "@/components/bench/BenchView";
import { canEditBench, canSeeConsultantCost } from "@/lib/auth/permissions";
import { visibleConsultants } from "@/lib/services/bench";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Bench" };

export default async function BenchPage() {
  const c = await ctx("/bench");
  const rows = await visibleConsultants(c);
  const today = c.now.toISOString().slice(0, 10);
  const in30 = new Date(c.now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const active = rows.filter((r) => r.status !== "inactive");
  const freeOn = (r: (typeof rows)[number]) => (r.availability_from && r.availability_from > today ? r.availability_from : today);
  const stats = {
    availableNow: active.filter((r) => r.status !== "allocated" && freeOn(r) === today).length,
    available30: active.filter((r) => freeOn(r) <= in30).length,
    avgBill: active.length ? Math.round(active.reduce((s, r) => s + r.rate_bill, 0) / active.length) : 0,
  };
  return <BenchView rows={rows} stats={stats} today={today} canEdit={canEditBench(c.user)} canSeeCost={canSeeConsultantCost(c.user)} />;
}
