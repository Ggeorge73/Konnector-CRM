/**
 * Forecast over the opportunities the viewer can see (role scoping via visibleOpportunities).
 * The maths is pure and lives in lib/domain/forecast.ts.
 */
import { computeForecast, type ForecastData } from "@/lib/domain/forecast";
import type { Ctx } from "./context-types";
import { visibleOpportunities } from "./core";
import { orgSettings } from "./pulse";

export * from "@/lib/domain/forecast";

export async function forecastData(c: Ctx): Promise<ForecastData> {
  const [opps, settings] = await Promise.all([visibleOpportunities(c), orgSettings(c)]);
  return computeForecast(opps, settings, c.now);
}
