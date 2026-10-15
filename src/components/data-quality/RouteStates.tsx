"use client";
import ErrorOutline from "@mui/icons-material/ErrorOutline";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import { EmptyState, GlassCard } from "@/components/kit";

/** Loading skeleton for the Duplicates and Data quality routes (tiles + list). */
export function PageSkeleton({ tiles = 0 }: { tiles?: number }) {
  return (
    <Stack spacing={4} aria-busy="true" aria-label="Loading">
      <Box>
        <Skeleton variant="text" width={240} height={48} />
        <Skeleton variant="text" width="60%" />
      </Box>
      {tiles > 0 && (
        <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr 1fr", md: `repeat(${Math.min(tiles, 6)}, 1fr)` } }}>
          {Array.from({ length: tiles }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={104} />
          ))}
        </Box>
      )}
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} variant="rounded" height={120} />
      ))}
    </Stack>
  );
}

/** Error boundary body: one sentence and a retry. */
export function RouteError({ message, reset }: { message: string; reset: () => void }) {
  return (
    <GlassCard>
      <EmptyState icon={<ErrorOutline />} message={message} action={<Button onClick={reset}>Try again</Button>} />
    </GlassCard>
  );
}
