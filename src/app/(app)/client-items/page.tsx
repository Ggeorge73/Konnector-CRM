import { ClientItemsView } from "@/components/client-items/ClientItemsView";
import { isLeader } from "@/lib/auth/permissions";
import { visibleClientItems } from "@/lib/services/client-items";
import { usersById, visibleAccounts } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Client items" };

export default async function ClientItemsPage() {
  const c = await ctx("/client-items");
  const [items, accounts, users, health] = await Promise.all([
    visibleClientItems(c),
    visibleAccounts(c),
    usersById(c),
    c.store.list("project_health"),
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const hubAccounts = accounts.filter(
    (a) => a.konnect_hub_client_id && (isLeader(c.user) || a.owner_id === c.user.id || c.user.role === "delivery_lead"),
  );
  return (
    <ClientItemsView
      rows={items.map((i) => ({
        ...i,
        account_name: acc.get(i.account_id)?.name ?? "",
        owner_name: users.get(i.owner_id)?.full_name ?? "—",
      }))}
      accounts={hubAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        projects: health
          .filter((h) => h.account_id === a.id)
          .map((h) => ({ id: h.konnect_hub_project_id, name: h.project_name, end_date: h.end_date })),
      }))}
    />
  );
}
