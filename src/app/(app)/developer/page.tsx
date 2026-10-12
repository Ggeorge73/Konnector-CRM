import { DeveloperView } from "@/components/developer/DeveloperView";
import { listMyApiKeys } from "@/lib/services/api-keys";
import { ctx } from "@/lib/services/context";
import { listDeliveries, listSubscriptions } from "@/lib/services/webhooks";

export const metadata = { title: "API & webhooks" };

export default async function DeveloperPage() {
  const c = await ctx("/developer");
  const admin = c.user.role === "admin";
  const [keys, subscriptions, deliveries] = await Promise.all([
    listMyApiKeys(c),
    admin ? listSubscriptions(c) : Promise.resolve(null),
    admin ? listDeliveries(c, { limit: 100 }) : Promise.resolve(null),
  ]);
  return (
    <DeveloperView keys={keys} webhooks={subscriptions && deliveries ? { subscriptions, deliveries } : null} now={c.now.toISOString()} />
  );
}
