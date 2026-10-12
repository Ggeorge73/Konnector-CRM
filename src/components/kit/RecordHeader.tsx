"use client";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { initials } from "@/lib/format";
import { GlassCard } from "./GlassCard";

export interface RecordHeaderProps {
  name: string;
  icon?: React.ReactNode;
  chips?: React.ReactNode;
  subtitle?: React.ReactNode;
  metrics?: Array<{ label: string; value: React.ReactNode }>;
  actions?: React.ReactNode;
}

export function RecordHeader({ name, icon, chips, subtitle, metrics, actions }: RecordHeaderProps) {
  const t = useTheme().palette.kc;
  return (
    <GlassCard>
      <Stack direction={{ xs: "column", md: "row" }} spacing={4} alignItems={{ md: "center" }} justifyContent="space-between">
        <Stack direction="row" spacing={4} alignItems="center" sx={{ minWidth: 0 }}>
          <Avatar
            variant="rounded"
            sx={{
              width: 56,
              height: 56,
              borderRadius: "16px",
              bgcolor: alpha(t.primary, 0.2),
              color: t.accent,
              fontWeight: 700,
              fontSize: 20,
            }}
          >
            {icon ?? initials(name)}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h3" component="h1" sx={{ wordBreak: "break-word" }}>
              {name}
            </Typography>
            {subtitle && (
              <Typography variant="body1" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                {subtitle}
              </Typography>
            )}
            {chips && (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
                {chips}
              </Stack>
            )}
          </Box>
        </Stack>
        {actions && (
          <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" sx={{ flexShrink: 0 }}>
            {actions}
          </Stack>
        )}
      </Stack>
      {metrics && metrics.length > 0 && (
        <Box
          sx={{
            mt: 5,
            display: "grid",
            gap: 4,
            gridTemplateColumns: { xs: "repeat(2, 1fr)", md: `repeat(${Math.min(metrics.length, 6)}, 1fr)` },
          }}
        >
          {metrics.map((m) => (
            <Box key={m.label}>
              <Typography variant="subtitle2" component="p">
                {m.label}
              </Typography>
              <Typography variant="subtitle1" component="div">
                {m.value}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </GlassCard>
  );
}
