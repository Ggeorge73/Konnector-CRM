import { PulseView } from "@/components/pulse/PulseView";
import { pulseData } from "@/lib/services/pulse";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Pulse" };

export default async function PulsePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const c = await ctx("/");
  const { denied } = await searchParams;
  return <PulseView data={await pulseData(c)} denied={!!denied} firstName={c.user.full_name.split(" ")[0]} />;
}
