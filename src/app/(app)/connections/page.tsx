import { ConnectionsView } from "@/components/mail/ConnectionsView";
import { MAIL_PROVIDERS, providerMode } from "@/lib/mail";
import { ctx } from "@/lib/services/context";
import { myConnections, recentSynced } from "@/lib/services/mail";

export const metadata = { title: "Email & calendar" };

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const c = await ctx("/connections");
  const sp = await searchParams;
  const [connections, recent] = await Promise.all([myConnections(c), recentSynced(c, 25)]);
  return (
    <ConnectionsView
      connections={connections}
      recent={recent}
      modes={Object.fromEntries(MAIL_PROVIDERS.map((p) => [p, providerMode(p)])) as Record<"google" | "microsoft", "live" | "mock" | "off">}
      flash={
        sp.connected ? { kind: "success", provider: sp.connected } : sp.error ? { kind: "error", message: sp.error.slice(0, 200) } : null
      }
    />
  );
}
