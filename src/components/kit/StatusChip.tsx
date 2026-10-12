"use client";
import Chip, { type ChipProps } from "@mui/material/Chip";
import { alpha, useTheme } from "@mui/material/styles";
import { humanize } from "@/lib/format";

export type Tone = "neutral" | "primary" | "accent" | "gold" | "success" | "warning" | "danger" | "violet";

const TONE_MAP: Record<string, Tone> = {
  won: "gold",
  accepted: "success",
  approved: "success",
  acknowledged: "success",
  active_client: "success",
  clear: "success",
  low: "success",
  green: "success",
  bid: "success",
  done: "success",
  available: "success",
  lost: "danger",
  declined: "danger",
  failed: "danger",
  hit: "danger",
  high: "danger",
  red: "danger",
  no_bid: "danger",
  rejected: "danger",
  expired: "danger",
  pending_approval: "warning",
  changes_requested: "warning",
  pending: "warning",
  medium: "warning",
  amber: "warning",
  conditional: "warning",
  partial: "warning",
  viewed: "accent",
  published: "primary",
  sent: "primary",
  proposal: "primary",
  submitted: "accent",
  prospect: "accent",
  partner: "violet",
  draft: "neutral",
  withdrawn: "neutral",
  superseded: "neutral",
  dormant: "neutral",
  past_client: "neutral",
  allocated: "neutral",
};

export function toneFor(value: string): Tone {
  return TONE_MAP[value] ?? "neutral";
}

/** Colour + text — never colour alone. */
export function StatusChip({ value, label, tone, ...rest }: { value?: string; label?: string; tone?: Tone } & Omit<ChipProps, "color">) {
  const t = useTheme().palette.kc;
  const resolved = tone ?? (value ? toneFor(value) : "neutral");
  const c = {
    neutral: t.textSecondary,
    primary: t.primary,
    accent: t.accent,
    gold: t.gold,
    success: t.success,
    warning: t.warning,
    danger: t.danger,
    violet: t.violet,
  }[resolved];
  return (
    <Chip
      size="small"
      label={label ?? humanize(value)}
      {...rest}
      sx={{ color: c, bgcolor: alpha(c, 0.14), border: `1px solid ${alpha(c, 0.32)}`, ...rest.sx }}
    />
  );
}
