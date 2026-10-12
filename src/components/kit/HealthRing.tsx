"use client";
import OpenInNew from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import type { Rag } from "@/lib/domain/types";
import { relative } from "@/lib/format";

export interface HealthRingProps {
  schedule: Rag;
  budget: Rag;
  acceptance: Rag;
  percentComplete?: number;
  updatedAt?: string;
  hubUrl?: string | null;
  size?: number;
  title?: string;
}

const LABEL: Record<Rag, string> = { green: "On track", amber: "At risk", red: "Off track" };

/** Read-only three-segment ring fed by Konnect Hub. */
export function HealthRing({ schedule, budget, acceptance, percentComplete, updatedAt, hubUrl, size = 112, title }: HealthRingProps) {
  const t = useTheme().palette.kc;
  const color = (r: Rag) => (r === "green" ? t.success : r === "amber" ? t.warning : t.danger);
  const segs: Array<[string, Rag]> = [
    ["Schedule", schedule],
    ["Budget", budget],
    ["Acceptance", acceptance],
  ];
  const stroke = size * 0.11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = c * 0.02;
  const seg = c / 3 - gap;

  return (
    <Stack direction="row" spacing={4} alignItems="center">
      <Box sx={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg
          width={size}
          height={size}
          role="img"
          aria-label={`Health: schedule ${LABEL[schedule]}, budget ${LABEL[budget]}, acceptance ${LABEL[acceptance]}`}
        >
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {segs.map(([name, rag], i) => (
              <circle
                key={name}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={color(rag)}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${seg} ${c - seg}`}
                strokeDashoffset={-i * (seg + gap)}
              />
            ))}
          </g>
        </svg>
        {percentComplete !== undefined && (
          <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
            <Box>
              <Typography variant="h4" component="p">
                {percentComplete}%
              </Typography>
              <Typography variant="caption">complete</Typography>
            </Box>
          </Box>
        )}
      </Box>
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        {title && <Typography variant="h6">{title}</Typography>}
        {segs.map(([name, rag]) => (
          <Stack key={name} direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color(rag) }} aria-hidden />
            <Typography variant="body2">
              <strong>{name}</strong> · {LABEL[rag]}
            </Typography>
          </Stack>
        ))}
        {updatedAt && <Typography variant="caption">Updated {relative(updatedAt)} by Konnect Hub</Typography>}
        {hubUrl && (
          <Link
            href={hubUrl}
            target="_blank"
            rel="noopener"
            variant="body2"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: t.accent }}
          >
            Open in Konnect Hub <OpenInNew sx={{ fontSize: 14 }} />
          </Link>
        )}
      </Stack>
    </Stack>
  );
}
