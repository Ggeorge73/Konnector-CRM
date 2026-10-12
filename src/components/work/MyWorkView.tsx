"use client";
import Add from "@mui/icons-material/Add";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Countdown, EmptyState, GlassCard, RelTime, StatusChip } from "@/components/kit";
import { NewTaskDialog, TaskList, type TaskRow } from "@/components/records/TasksPanel";
import type { ClientItemStatus, RelatedType } from "@/lib/domain/types";
import { daysUntil, humanize } from "@/lib/format";

const HREF: Partial<Record<RelatedType, string>> = {
  account: "/accounts/",
  contact: "/contacts/",
  opportunity: "/opportunities/",
  quote: "/quotes/",
  client_item: "/client-items/",
  consultant: "/bench/",
  event: "/events/",
};
const href = (t: RelatedType, id: string) => (HREF[t] ? `${HREF[t]}${id}` : t === "registration" ? "/registrations" : "/vetting");

export function MyWorkView(props: {
  firstName: string;
  tasks: TaskRow[];
  mentions: Array<{
    id: string;
    subject: string;
    body: string | null;
    occurred_at: string;
    actor: string;
    related_type: RelatedType;
    related_id: string;
    label: string;
  }>;
  recent: Array<{ id: string; related_type: RelatedType; related_id: string; label: string; at: string }>;
  awaiting: Array<{ id: string; title: string; status: ClientItemStatus; respond_by: string | null }>;
  users: Array<{ id: string; name: string }>;
}) {
  const params = useSearchParams();
  const [adding, setAdding] = useState(params.get("new") === "1");
  const open = props.tasks.filter((t) => t.status === "open");
  const overdue = open.filter((t) => (daysUntil(t.due_at) ?? 1) < 0);
  const today = open.filter((t) => daysUntil(t.due_at) === 0);
  const upcoming = open.filter((t) => (daysUntil(t.due_at) ?? 1) > 0 || t.due_at === null);
  const done = props.tasks.filter((t) => t.status === "done").slice(0, 5);

  return (
    <Stack spacing={4}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h2" component="h1">
            My Work
          </Typography>
          <Typography color="text.secondary">
            {props.firstName}, you have {overdue.length} overdue and {today.length} due today.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={() => setAdding(true)} sx={{ alignSelf: "flex-start" }}>
          New follow-up
        </Button>
      </Stack>
      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" } }}>
        <Stack spacing={4}>
          {overdue.length > 0 && (
            <GlassCard title={`Overdue (${overdue.length})`}>
              <TaskList tasks={overdue} showContext />
            </GlassCard>
          )}
          <GlassCard title={`Due today (${today.length})`}>
            <TaskList tasks={today} showContext />
          </GlassCard>
          <GlassCard title={`Upcoming (${upcoming.length})`}>
            <TaskList tasks={upcoming} showContext />
          </GlassCard>
          {done.length > 0 && (
            <GlassCard title="Recently completed">
              <TaskList tasks={done} showContext />
            </GlassCard>
          )}
        </Stack>
        <Stack spacing={4}>
          <GlassCard title="Awaiting client" subtitle="Your items in the Konnect Hub portal" flush>
            {props.awaiting.length ? (
              <List dense>
                {props.awaiting.map((i) => (
                  <ListItemButton key={i.id} component={Link} href={`/client-items/${i.id}`}>
                    <ListItemText primary={i.title} secondary={<StatusChip value={i.status} component="span" />} />
                    <Countdown date={i.respond_by} />
                  </ListItemButton>
                ))}
              </List>
            ) : (
              <EmptyState message="Nothing waiting on a client." />
            )}
          </GlassCard>
          <GlassCard title="Mentions" flush>
            {props.mentions.length ? (
              <List dense>
                {props.mentions.map((m) => (
                  <ListItemButton key={m.id} component={Link} href={href(m.related_type, m.related_id)}>
                    <ListItemText
                      primary={`${m.actor}: ${m.subject}`}
                      secondary={
                        <>
                          {m.label ? `${m.label} · ` : ""}
                          <RelTime value={m.occurred_at} />
                        </>
                      }
                    />
                  </ListItemButton>
                ))}
              </List>
            ) : (
              <EmptyState message="No one has mentioned you yet." />
            )}
          </GlassCard>
          <GlassCard title="Recently viewed" flush>
            {props.recent.length ? (
              <List dense>
                {props.recent.map((r) => (
                  <ListItemButton key={r.id} component={Link} href={href(r.related_type, r.related_id)}>
                    <ListItemText
                      primary={r.label}
                      secondary={
                        <>
                          {humanize(r.related_type)} · <RelTime value={r.at} />
                        </>
                      }
                    />
                  </ListItemButton>
                ))}
              </List>
            ) : (
              <EmptyState message="Records you open will show up here." />
            )}
          </GlassCard>
        </Stack>
      </Box>
      <NewTaskDialog open={adding} onClose={() => setAdding(false)} users={props.users} />
    </Stack>
  );
}
