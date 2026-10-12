"use client";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import EventAvailable from "@mui/icons-material/EventAvailableOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import Link from "next/link";
import { Countdown, EmptyState, GlassCard } from "@/components/kit";
import { dateLabel } from "@/lib/format";
import type { CalendarEntry, DeadlineKind } from "@/lib/services/compliance";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KIND_LABEL: Record<DeadlineKind, string> = { questions_due: "Questions due", proposal_due: "Proposal due" };
const SHORT_LABEL: Record<DeadlineKind, string> = { questions_due: "Q&A", proposal_due: "Proposal" };

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function useKindColor() {
  const t = useTheme().palette.kc;
  return (k: DeadlineKind) => (k === "proposal_due" ? t.primary : t.accent);
}

function KindTag({ kind }: { kind: DeadlineKind }) {
  const color = useKindColor()(kind);
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        px: 1,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color,
        bgcolor: alpha(color, 0.14),
        border: `1px solid ${alpha(color, 0.32)}`,
        whiteSpace: "nowrap",
      }}
    >
      {KIND_LABEL[kind]}
    </Box>
  );
}

export function CalendarView({
  entries,
  month,
  prev,
  next,
  thisMonth,
  today,
}: {
  entries: CalendarEntry[];
  month: string; // YYYY-MM
  prev: string;
  next: string;
  thisMonth: string;
  today: string; // YYYY-MM-DD in the viewer's zone
}) {
  const theme = useTheme();
  const t = theme.palette.kc;
  const colorFor = useKindColor();
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lead = new Date(`${first}T12:00:00Z`).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const cells = [...Array(weeks * 7)].map((_, i) => addDays(first, i - lead));
  const byDate = new Map<string, CalendarEntry[]>();
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const monthEntries = entries.filter((e) => e.date.startsWith(month));
  const horizon = addDays(today, 30);
  const upcoming = entries.filter((e) => e.date >= today && e.date <= horizon);
  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${first}T12:00:00Z`),
  );

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Bid calendar
        </Typography>
        <Typography color="text.secondary">Question and proposal deadlines for every open public bid you can see.</Typography>
      </Box>

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "3fr 1fr" }, alignItems: "start" }}>
        <GlassCard
          title={title}
          subtitle={`${monthEntries.length} deadline${monthEntries.length === 1 ? "" : "s"} this month`}
          action={
            <Stack direction="row" spacing={1} alignItems="center">
              <IconButton component={Link} href={`/calendar?month=${prev}`} aria-label="Previous month" size="small">
                <ChevronLeft />
              </IconButton>
              <Button component={Link} href={`/calendar?month=${thisMonth}`} size="small" disabled={month === thisMonth}>
                Today
              </Button>
              <IconButton component={Link} href={`/calendar?month=${next}`} aria-label="Next month" size="small">
                <ChevronRight />
              </IconButton>
            </Stack>
          }
        >
          <Stack direction="row" spacing={3} sx={{ mb: 3 }} aria-label="Legend">
            {(["questions_due", "proposal_due"] as const).map((k) => (
              <Stack key={k} direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 10, height: 10, borderRadius: "3px", bgcolor: colorFor(k) }} aria-hidden />
                <Typography variant="caption">{KIND_LABEL[k]}</Typography>
              </Stack>
            ))}
          </Stack>

          {/* Month grid (tablet and up) */}
          <Box
            sx={{
              display: { xs: "none", md: "grid" },
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              border: `1px solid ${t.surfaceBorder}`,
              borderRadius: "12px",
              overflow: "hidden",
            }}
          >
            {WEEKDAYS.map((d) => (
              <Typography
                key={d}
                variant="subtitle2"
                component="div"
                sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${t.surfaceBorder}`, textAlign: "left" }}
              >
                {d}
              </Typography>
            ))}
            {cells.map((d, i) => {
              const inMonth = d.startsWith(month);
              const isToday = d === today;
              const items = byDate.get(d) ?? [];
              return (
                <Box
                  key={d}
                  aria-current={isToday ? "date" : undefined}
                  data-date={d}
                  sx={{
                    minHeight: 112,
                    p: 1.5,
                    borderRight: (i + 1) % 7 ? `1px solid ${t.surfaceBorder}` : "none",
                    borderBottom: i < cells.length - 7 ? `1px solid ${t.surfaceBorder}` : "none",
                    bgcolor: isToday ? alpha(t.primary, 0.12) : inMonth ? "transparent" : t.surfaceHover,
                    boxShadow: isToday ? `inset 0 0 0 2px ${t.accent}` : "none",
                    minWidth: 0,
                  }}
                >
                  <Typography
                    variant="caption"
                    component="div"
                    sx={{
                      fontWeight: isToday ? 800 : 600,
                      color: isToday ? t.accent : inMonth ? "text.primary" : "text.secondary",
                      opacity: inMonth ? 1 : 0.6,
                      mb: 1,
                    }}
                  >
                    {Number(d.slice(8))}
                    {isToday && " · Today"}
                  </Typography>
                  <Stack spacing={0.75}>
                    {items.map((e) => {
                      const c = colorFor(e.kind);
                      return (
                        <Box
                          key={e.id}
                          component={Link}
                          href={`/opportunities/${e.opportunity_id}`}
                          title={`${KIND_LABEL[e.kind]} ${dateLabel(e.date)}: ${e.name} (${e.account})`}
                          aria-label={`${KIND_LABEL[e.kind]} ${dateLabel(e.date)}: ${e.name}`}
                          sx={{
                            display: "block",
                            px: 1,
                            py: 0.5,
                            borderRadius: "8px",
                            fontSize: 12,
                            lineHeight: 1.3,
                            color: "text.primary",
                            textDecoration: "none",
                            bgcolor: alpha(c, 0.16),
                            borderLeft: `3px solid ${c}`,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            "&:hover": { bgcolor: alpha(c, 0.28) },
                          }}
                        >
                          <Box component="span" sx={{ fontWeight: 700, color: c }}>
                            {SHORT_LABEL[e.kind]}
                          </Box>{" "}
                          {e.name}
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
              );
            })}
          </Box>

          {/* Agenda for the month (phones) */}
          <Box sx={{ display: { xs: "block", md: "none" } }}>
            {monthEntries.length ? (
              <List dense disablePadding aria-label={`${title} agenda`}>
                {monthEntries.map((e) => (
                  <ListItemButton
                    key={e.id}
                    component={Link}
                    href={`/opportunities/${e.opportunity_id}`}
                    sx={{
                      borderLeft: `3px solid ${colorFor(e.kind)}`,
                      mb: 1,
                      borderRadius: "8px",
                      bgcolor: e.date === today ? alpha(t.primary, 0.12) : undefined,
                    }}
                  >
                    <ListItemText
                      primary={e.name}
                      secondary={
                        <>
                          {dateLabel(e.date)}
                          {e.date === today ? " · Today" : ""} · {e.account}
                        </>
                      }
                    />
                    <KindTag kind={e.kind} />
                  </ListItemButton>
                ))}
              </List>
            ) : (
              <EmptyState icon={<EventAvailable />} message="No bid deadlines this month." />
            )}
          </Box>
        </GlassCard>

        <GlassCard title="Upcoming 30 days" subtitle={`${dateLabel(today)} – ${dateLabel(horizon)}`} flush>
          {upcoming.length ? (
            <List dense aria-label="Upcoming deadlines">
              {upcoming.map((e) => (
                <ListItemButton
                  key={e.id}
                  component={Link}
                  href={`/opportunities/${e.opportunity_id}`}
                  sx={{ alignItems: "flex-start", gap: 2 }}
                >
                  <ListItemText
                    primary={e.name}
                    secondary={
                      <Box component="span" sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", mt: 0.5 }}>
                        <KindTag kind={e.kind} />
                        <span>{dateLabel(e.date)}</span>
                        {e.solicitation_no && (
                          <Box component="span" sx={{ fontFamily: "var(--font-mono), monospace", fontSize: 12 }}>
                            {e.solicitation_no}
                          </Box>
                        )}
                      </Box>
                    }
                  />
                  <Box sx={{ pt: 0.5, flexShrink: 0 }}>
                    <Countdown date={e.date} />
                  </Box>
                </ListItemButton>
              ))}
            </List>
          ) : (
            <EmptyState icon={<EventAvailable />} message="Nothing due in the next 30 days." />
          )}
        </GlassCard>
      </Box>
    </Stack>
  );
}
