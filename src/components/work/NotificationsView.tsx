"use client";
import DoneAll from "@mui/icons-material/DoneAll";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { markReadAction } from "@/app/actions/core";
import { useAction } from "@/components/common/useAction";
import { EmptyState, GlassCard, RelTime, StatusChip } from "@/components/kit";
import type { Notification } from "@/lib/domain/types";

export function NotificationsView({ items }: { items: Notification[] }) {
  const router = useRouter();
  const mark = useAction(markReadAction);
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <Stack spacing={4}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h2" component="h1">
            Notifications
          </Typography>
          <Typography color="text.secondary">{unread} unread</Typography>
        </Box>
        <Button startIcon={<DoneAll />} disabled={!unread || mark.pending} onClick={() => mark.exec("all")}>
          Mark all read
        </Button>
      </Stack>
      <GlassCard flush>
        {items.length ? (
          <List>
            {items.map((n) => (
              <ListItemButton
                key={n.id}
                onClick={async () => {
                  if (!n.read_at) await mark.exec([n.id]);
                  if (n.href) router.push(n.href);
                }}
                sx={{ opacity: n.read_at ? 0.65 : 1 }}
              >
                <ListItemText
                  primary={n.title}
                  secondary={
                    <>
                      {n.body ? `${n.body} · ` : ""}
                      <RelTime value={n.created_at} />
                    </>
                  }
                  primaryTypographyProps={{ fontWeight: n.read_at ? 400 : 700 }}
                />
                <StatusChip value={n.kind} tone={n.read_at ? "neutral" : "primary"} />
              </ListItemButton>
            ))}
          </List>
        ) : (
          <EmptyState message="You're all caught up." />
        )}
      </GlassCard>
    </Stack>
  );
}
