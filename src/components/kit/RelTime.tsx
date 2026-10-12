"use client";
import { dateTimeLabel, relative } from "@/lib/format";

/** "3 days ago" with the exact time on hover. Server and client may differ by seconds, so hydration drift is expected. */
export function RelTime({ value }: { value: string | null | undefined }) {
  if (!value) return <>—</>;
  return (
    <time dateTime={value} title={dateTimeLabel(value)} suppressHydrationWarning>
      {relative(value)}
    </time>
  );
}
