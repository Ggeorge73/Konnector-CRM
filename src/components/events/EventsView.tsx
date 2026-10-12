"use client";
import Add from "@mui/icons-material/Add";
import Campaign from "@mui/icons-material/CampaignOutlined";
import Payments from "@mui/icons-material/PaymentsOutlined";
import Place from "@mui/icons-material/PlaceOutlined";
import AvatarGroup from "@mui/material/AvatarGroup";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import Link from "next/link";
import { useState } from "react";
import { Countdown, EmptyState, GlassCard, Money, StatusChip, UserAvatar } from "@/components/kit";
import { dateLabel, humanize } from "@/lib/format";
import type { EventSummary } from "@/lib/services/events";
import { EventFormDialog } from "./EventFormDialog";

export type EventCard = EventSummary & { attendees: Array<{ id: string; name: string; color: string }> };

export function dateRange(a: string, b: string) {
  return a === b ? dateLabel(a) : `${dateLabel(a)} – ${dateLabel(b)}`;
}

function Card({ e, past }: { e: EventCard; past: boolean }) {
  const t = useTheme().palette.kc;
  return (
    <GlassCard
      component="li"
      sx={{ p: { xs: 4, md: 5 }, display: "flex", flexDirection: "column", gap: 3, "&:hover": { borderColor: alpha(t.accent, 0.4) } }}
    >
      <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="flex-start">
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h3">
            <Link href={`/events/${e.id}`} style={{ color: "inherit" }}>
              {e.name}
            </Link>
          </Typography>
          <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
            {dateRange(e.starts_on, e.ends_on)}
          </Typography>
        </Box>
        {past ? <StatusChip tone="neutral" label="Past" /> : <Countdown date={e.starts_on} />}
      </Stack>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
        <StatusChip tone="violet" label={humanize(e.kind)} />
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary" }}>
          <Place sx={{ fontSize: 16 }} aria-hidden />
          <Typography variant="body2">{e.location}</Typography>
        </Stack>
      </Stack>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-end" spacing={2} sx={{ mt: "auto" }}>
        <Box>
          <Typography variant="caption" component="p">
            Budget
          </Typography>
          <Money value={e.budget} currency={e.currency} />
        </Box>
        <Box sx={{ textAlign: "center" }}>
          <Typography variant="caption" component="p">
            Leads
          </Typography>
          <Typography variant="mono" component="span" aria-label={`${e.lead_count} leads`}>
            {e.lead_count}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" component="p" sx={{ textAlign: "right" }}>
            Attendees
          </Typography>
          {e.attendees.length ? (
            <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 28, height: 28, fontSize: 11, borderColor: t.surfaceBorder } }}>
              {e.attendees.map((a) => (
                <UserAvatar key={a.id} name={a.name} color={a.color} />
              ))}
            </AvatarGroup>
          ) : (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          )}
        </Box>
      </Stack>
    </GlassCard>
  );
}

function Section({ title, items, past }: { title: string; items: EventCard[]; past: boolean }) {
  return (
    <Box component="section" aria-label={title}>
      <Typography variant="h4" component="h2" sx={{ mb: 3 }}>
        {title}{" "}
        <Typography component="span" color="text.secondary" variant="body1">
          ({items.length})
        </Typography>
      </Typography>
      {items.length ? (
        <Box
          component="ul"
          sx={{
            listStyle: "none",
            p: 0,
            m: 0,
            display: "grid",
            gap: 4,
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" },
          }}
        >
          {items.map((e) => (
            <Card key={e.id} e={e} past={past} />
          ))}
        </Box>
      ) : (
        <GlassCard>
          <EmptyState
            icon={<Campaign />}
            message={past ? "No past events yet." : "Nothing scheduled. Plan the next summit or procurement fair."}
          />
        </GlassCard>
      )}
    </Box>
  );
}

export function EventsView({
  events,
  today,
  users,
  currentUserId,
}: {
  events: EventCard[];
  today: string;
  users: Array<{ id: string; name: string }>;
  currentUserId: string;
}) {
  const [creating, setCreating] = useState(false);
  const upcoming = events.filter((e) => e.ends_on >= today).sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const past = events.filter((e) => e.ends_on < today).sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const spend = upcoming.reduce((s, e) => s + e.budget, 0);
  return (
    <Stack spacing={6}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h2" component="h1">
            BD events
          </Typography>
          <Typography color="text.secondary">
            Summits, expos and procurement fairs. Capture who you meet; follow-ups land in My Work.
          </Typography>
        </Box>
        <Stack direction="row" spacing={3} alignItems="center">
          <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "text.secondary" }}>
            <Payments fontSize="small" aria-hidden />
            <Typography variant="body2">
              Upcoming budget <Money value={spend} compact />
            </Typography>
          </Stack>
          <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)} sx={{ whiteSpace: "nowrap" }}>
            New event
          </Button>
        </Stack>
      </Stack>
      <Section title="Upcoming" items={upcoming} past={false} />
      <Section title="Past" items={past} past />
      {creating && <EventFormDialog users={users} defaultAttendee={currentUserId} onClose={() => setCreating(false)} />}
    </Stack>
  );
}
