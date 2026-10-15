"use client";
import { RouteError } from "@/components/data-quality/RouteStates";

export default function DuplicatesError({ reset }: { error: Error; reset: () => void }) {
  return <RouteError message="We couldn't load duplicates. Please try again." reset={reset} />;
}
