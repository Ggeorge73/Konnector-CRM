"use client";
import { RouteError } from "@/components/data-quality/RouteStates";

export default function DataQualityError({ reset }: { error: Error; reset: () => void }) {
  return <RouteError message="We couldn't load the data quality checks. Please try again." reset={reset} />;
}
