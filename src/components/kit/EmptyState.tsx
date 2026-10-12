"use client";
import InboxOutlined from "@mui/icons-material/InboxOutlined";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";

/** Illustration-free empty state: glowing icon, one sentence, one action. */
export function EmptyState({ icon, message, action }: { icon?: React.ReactNode; message: string; action?: React.ReactNode }) {
  const t = useTheme().palette.kc;
  return (
    <Stack alignItems="center" justifyContent="center" spacing={3} sx={{ py: 10, textAlign: "center" }} role="status">
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          color: t.accent,
          bgcolor: alpha(t.primary, 0.14),
          boxShadow: `0 0 32px ${alpha(t.accent, 0.35)}`,
        }}
        aria-hidden
      >
        {icon ?? <InboxOutlined />}
      </Box>
      <Typography color="text.secondary">{message}</Typography>
      {action}
    </Stack>
  );
}
