import { DataQualityView } from "@/components/data-quality/DataQualityView";
import { ctx } from "@/lib/services/context";
import { dataQuality } from "@/lib/services/data-quality";

export const metadata = { title: "Data quality" };

export default async function DataQualityPage() {
  const c = await ctx("/data-quality");
  return <DataQualityView report={await dataQuality(c)} />;
}
