import { AccountsView } from "@/components/accounts/AccountsView";
import { isLeader } from "@/lib/auth/permissions";
import { usersById, visibleAccounts, visibleOpportunities } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { savedViews } from "@/lib/services/views";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const c = await ctx("/accounts");
  const [accounts, opps, users, views] = await Promise.all([
    visibleAccounts(c),
    visibleOpportunities(c),
    usersById(c),
    savedViews(c, "accounts"),
  ]);
  const open = new Map<string, { value: number; count: number }>();
  for (const o of opps) {
    if (["won", "lost", "no_bid"].includes(o.stage)) continue;
    const cur = open.get(o.account_id) ?? { value: 0, count: 0 };
    open.set(o.account_id, { value: cur.value + o.value, count: cur.count + 1 });
  }
  const rows = accounts.map((a) => ({
    ...a,
    owner_name: users.get(a.owner_id)?.full_name ?? "—",
    open_value: open.get(a.id)?.value ?? 0,
    open_count: open.get(a.id)?.count ?? 0,
  }));
  return (
    <AccountsView
      rows={rows}
      views={views.map((v) => ({ id: v.id, name: v.name, query: v.query, mine: v.owner_id === c.user.id }))}
      owners={[...users.values()]
        .filter((u) => u.role === "bd" || u.role === "executive" || u.role === "admin")
        .map((u) => ({ id: u.id, name: u.full_name }))}
      canBulk={isLeader(c.user)}
      canCreate={isLeader(c.user) || c.user.role === "bd"}
    />
  );
}
