"use client";
import Edit from "@mui/icons-material/EditOutlined";
import PersonAdd from "@mui/icons-material/PersonAddAlt1Outlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";
import { Countdown, EmptyState, GlassCard, Money, RecordHeader, StatusChip, UserAvatar, type TimelineItem } from "@/components/kit";
import { TimelinePanel } from "@/components/records/TimelinePanel";
import type { BdEvent, Task } from "@/lib/domain/types";
import { humanize } from "@/lib/format";
import { CaptureLeadDialog, type ContactOption } from "./CaptureLeadDialog";
import { EventFormDialog } from "./EventFormDialog";
import { dateRange } from "./EventsView";

export interface LeadRow {
  id: string;
  interest: string | null;
  contact: { id: string; name: string; title: string | null };
  account: { id: string; name: string };
  task: (Pick<Task, "id" | "status" | "due_at"> & { assignee_name: string }) | null;
}

export function EventDetail({
  event,
  leads,
  attendees,
  timeline,
  people,
  users,
  contacts,
  accounts,
  dueHint,
  today,
  currentUserId,
}: {
  event: BdEvent;
  leads: LeadRow[];
  attendees: Array<{ id: string; name: string; color: string; title: string }>;
  timeline: TimelineItem[];
  people: string[];
  users: Array<{ id: string; name: string }>;
  contacts: ContactOption[];
  accounts: Array<{ id: string; name: string }>;
  dueHint: string;
  today: string;
  currentUserId: string;
}) {
  const [capturing, setCapturing] = useState(false);
  const [editing, setEditing] = useState(false);
  const open = leads.filter((l) => l.task?.status === "open").length;
  const past = event.ends_on < today;
  return (
    <Stack spacing={4}>
      <RecordHeader
        name={event.name}
        subtitle={`${dateRange(event.starts_on, event.ends_on)} · ${event.location}`}
        chips={
          <>
            <StatusChip tone="violet" label={humanize(event.kind)} />
            {past ? <StatusChip tone="neutral" label="Past event" /> : <Countdown date={event.starts_on} label="Starts" />}
          </>
        }
        metrics={[
          { label: "Budget", value: <Money value={event.budget} currency={event.currency} /> },
          { label: "Leads captured", value: leads.length },
          { label: "Open follow-ups", value: open },
          { label: "Attendees", value: attendees.length },
        ]}
        actions={
          <>
            <Button variant="outlined" startIcon={<Edit />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="contained" startIcon={<PersonAdd />} onClick={() => setCapturing(true)}>
              Capture lead
            </Button>
          </>
        }
      />
      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" } }}>
        <Stack spacing={4} sx={{ minWidth: 0 }}>
          <GlassCard title="Leads" subtitle="People we met here and the follow-up for each" flush>
            {leads.length ? (
              <List aria-label="Captured leads" sx={{ pb: 2 }}>
                {leads.map((l) => (
                  <ListItem key={l.id} sx={{ px: { xs: 4, md: 6 }, alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
                    <ListItemAvatar sx={{ minWidth: 0 }}>
                      <UserAvatar name={l.contact.name} size={36} />
                    </ListItemAvatar>
                    <ListItemText
                      sx={{ minWidth: 180, flex: 1 }}
                      primary={
                        <Link href={`/contacts/${l.contact.id}`} style={{ fontWeight: 600, color: "inherit" }}>
                          {l.contact.name}
                        </Link>
                      }
                      secondary={
                        <>
                          {l.contact.title ? `${l.contact.title} · ` : ""}
                          <Link href={`/accounts/${l.account.id}`}>{l.account.name}</Link>
                          {l.interest && (
                            <Typography component="span" variant="body2" sx={{ display: "block", mt: 0.5 }} color="text.primary">
                              {l.interest}
                            </Typography>
                          )}
                        </>
                      }
                    />
                    <Stack spacing={0.5} alignItems={{ xs: "flex-start", sm: "flex-end" }} sx={{ pt: 0.5 }}>
                      {l.task ? (
                        l.task.status === "done" ? (
                          <StatusChip value="done" label="Followed up" />
                        ) : (
                          <Countdown date={l.task.due_at} label="Follow-up due" />
                        )
                      ) : (
                        <StatusChip tone="neutral" label="No follow-up" />
                      )}
                      {l.task && (
                        <Typography variant="caption" component="span">
                          {l.task.assignee_name}
                        </Typography>
                      )}
                    </Stack>
                  </ListItem>
                ))}
              </List>
            ) : (
              <EmptyState
                icon={<PersonAdd />}
                message="No leads captured yet."
                action={
                  <Button variant="contained" onClick={() => setCapturing(true)}>
                    Capture the first lead
                  </Button>
                }
              />
            )}
          </GlassCard>
          <TimelinePanel
            items={timeline}
            relatedType="event"
            relatedId={event.id}
            accountId={null}
            people={people}
            currentUserId={currentUserId}
          />
        </Stack>
        <Stack spacing={4}>
          <GlassCard title="Attendees">
            {attendees.length ? (
              <Stack spacing={2}>
                {attendees.map((a) => (
                  <Stack key={a.id} direction="row" spacing={2} alignItems="center">
                    <UserAvatar name={a.name} color={a.color} />
                    <Box>
                      <Typography variant="body2" fontWeight={600}>
                        {a.name}
                      </Typography>
                      <Typography variant="caption">{a.title}</Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">No one assigned yet.</Typography>
            )}
          </GlassCard>
          <GlassCard title="Notes">
            <Typography color={event.notes ? "text.primary" : "text.secondary"} sx={{ whiteSpace: "pre-wrap" }}>
              {event.notes ?? "No notes yet. Add the booth number, agenda highlights or who to look for."}
            </Typography>
          </GlassCard>
        </Stack>
      </Box>
      {capturing && (
        <CaptureLeadDialog
          eventId={event.id}
          eventName={event.name}
          dueHint={dueHint}
          contacts={contacts}
          accounts={accounts}
          onClose={() => setCapturing(false)}
        />
      )}
      {editing && <EventFormDialog event={event} users={users} defaultAttendee={currentUserId} onClose={() => setEditing(false)} />}
    </Stack>
  );
}
