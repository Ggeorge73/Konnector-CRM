import { CopilotUsageView } from "@/components/copilot/CopilotUsageView";
import { copilotMode } from "@/lib/copilot/anthropic";
import { copilotUsage } from "@/lib/copilot/usage";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Copilot" };

export default async function CopilotPage() {
  const c = await ctx("/copilot");
  return <CopilotUsageView usage={await copilotUsage(c)} live={copilotMode() === "live"} />;
}
