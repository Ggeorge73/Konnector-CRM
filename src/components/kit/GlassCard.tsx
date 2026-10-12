"use client";
import Box, { type BoxProps } from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { elevation, radius } from "@/theme/tokens";

export interface GlassCardProps extends Omit<BoxProps, "title"> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  /** Remove body padding (tables, charts that bleed to the edge). */
  flush?: boolean;
}

/** The base surface: translucent glass with an optional header. */
export function GlassCard({ title, subtitle, action, flush, children, sx, ...rest }: GlassCardProps) {
  const t = useTheme().palette.kc;
  return (
    <Box
      component="section"
      sx={{
        position: "relative",
        bgcolor: t.surfaceGlass,
        backdropFilter: t.surfaceBlur,
        WebkitBackdropFilter: t.surfaceBlur,
        border: `1px solid ${t.surfaceBorder}`,
        borderRadius: `${radius.card}px`,
        boxShadow: elevation,
        p: flush ? 0 : { xs: 4, md: 6 },
        minWidth: 0,
        ...sx,
      }}
      {...rest}
    >
      {(title || action) && (
        <Stack
          direction="row"
          alignItems="flex-start"
          justifyContent="space-between"
          gap={2}
          sx={{ mb: 4, ...(flush ? { px: { xs: 4, md: 6 }, pt: { xs: 4, md: 6 } } : {}) }}
        >
          <Box sx={{ minWidth: 0 }}>
            {title && (
              <Typography variant="h5" component="h2">
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
      )}
      {children}
    </Box>
  );
}
