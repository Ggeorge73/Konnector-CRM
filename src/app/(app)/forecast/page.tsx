import { ForecastView } from "@/components/forecast/ForecastView";
import { forecastData } from "@/lib/services/forecast";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Forecast" };

export default async function ForecastPage() {
  const c = await ctx("/forecast");
  return <ForecastView data={await forecastData(c)} />;
}
