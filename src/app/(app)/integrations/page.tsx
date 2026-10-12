import { IntegrationsView } from "@/components/integrations/IntegrationsView";
import { env } from "@/config/app";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const c = await ctx("/integrations");
  const events = await c.store.list("integration_events", { orderBy: { column: "created_at", ascending: false }, limit: 200 });
  return (
    <IntegrationsView
      events={events}
      mode={env.mockKonnectHub && !env.konnectHubBaseUrl ? "mock" : env.konnectHubBaseUrl ? "live" : "disabled"}
      target={env.konnectHubBaseUrl || "in-process mock"}
    />
  );
}
