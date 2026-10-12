"use client";
import AccessTime from "@mui/icons-material/AccessTime";
import { daysUntil } from "@/lib/format";
import { StatusChip } from "./StatusChip";

/** Deadline chip: red ≤3 days, amber ≤10, otherwise neutral. */
export function Countdown({ date, label }: { date: string | null; label?: string }) {
  const days = daysUntil(date);
  if (days === null) return null;
  const tone = days < 0 ? "neutral" : days <= 3 ? "danger" : days <= 10 ? "warning" : "accent";
  const text = days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? "today" : `in ${days}d`;
  return <StatusChip icon={<AccessTime sx={{ fontSize: 14 }} />} tone={tone} label={label ? `${label} ${text}` : text} />;
}
