import { VettingView } from "@/components/compliance/VettingView";
import { vettingData } from "@/lib/services/compliance";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Partner vetting" };

export default async function VettingPage() {
  const c = await ctx("/vetting");
  return <VettingView rows={await vettingData(c)} />;
}
