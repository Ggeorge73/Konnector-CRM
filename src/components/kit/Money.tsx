"use client";
import Typography, { type TypographyProps } from "@mui/material/Typography";
import { money } from "@/lib/format";

export function Money({
  value,
  currency = "USD",
  compact,
  ...rest
}: { value: number | null | undefined; currency?: string; compact?: boolean } & TypographyProps) {
  return (
    <Typography component="span" variant="mono" {...rest}>
      {money(value, currency, { compact })}
    </Typography>
  );
}

/** Shown in place of a value the viewer's role can't read. */
export function Restricted() {
  return (
    <Typography component="span" variant="caption" title="Restricted to executives" aria-label="Restricted">
      🔒 Restricted
    </Typography>
  );
}
