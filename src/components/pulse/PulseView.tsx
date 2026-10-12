"use client";
import AccountBalance from "@mui/icons-material/AccountBalanceWalletOutlined";
import Gavel from "@mui/icons-material/GavelOutlined";
import ShowChart from "@mui/icons-material/ShowChart";
import Verified from "@mui/icons-material/VerifiedOutlined";
import WarningAmber from "@mui/icons-material/WarningAmber";
import EmojiEvents from "@mui/icons-material/EmojiEventsOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Countdown, EmptyState, GlassCard, HealthRing, StatTile, StatusChip } from "@/components/kit";
import { PulseGlobe } from "@/components/kit/PulseGlobe";
import type { PulseData } from "@/lib/services/pulse";
import { money } from "@/lib/format";
import { seriesColors } from "@/theme/tokens";

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  const t = useTheme().palette.kc;
  if (!active || !payload?.length) return null;
  return (
    <Box
      sx={{
        bgcolor: t.surfaceGlassStrong,
        border: `1px solid ${t.surfaceBorder}`,
        borderRadius: "12px",
        p: 2,
        backdropFilter: t.surfaceBlur,
      }}
    >
      <Typography variant="caption" component="p">
        {label}
      </Typography>
      {payload.map((p) => (
        <Typography key={p.name} variant="body2" sx={{ color: p.color }}>
          {p.name}: <strong>{money(p.value, "USD", { compact: true })}</strong>
        </Typography>
      ))}
    </Box>
  );
}

export function PulseView({ data, denied, firstName }: { data: PulseData; denied?: boolean; firstName: string }) {
  const theme = useTheme();
  const t = theme.palette.kc;
  const colors = seriesColors(theme.palette.mode);
  const k = data.kpis;
  const compact = (v: number) => money(v, "USD", { compact: true });
  const axis = { stroke: t.textSecondary, fontSize: 12, tickLine: false, axisLine: false };

  return (
    <Stack spacing={5}>
      {denied && <Alert severity="warning">That page isn&apos;t available for your role.</Alert>}
      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "5fr 7fr" } }}>
        <GlassCard sx={{ overflow: "hidden" }}>
          <Typography variant="subtitle2" component="p">
            Welcome back,
          </Typography>
          <Typography variant="h2" component="h1">
            {firstName}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {k.openCount} open pursuits worth {compact(k.pipeline)}. {k.bidsDue14} bid{k.bidsDue14 === 1 ? "" : "s"} due in the next two
            weeks.
          </Typography>
          <PulseGlobe points={data.globe} height={360} />
          <Stack direction="row" spacing={3} justifyContent="center" sx={{ mt: -2 }}>
            {[
              [t.gold, "Atlanta HQ"],
              [t.accent, "Live project"],
              [t.primary, "Account"],
            ].map(([c, l]) => (
              <Stack key={l} direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: c }} aria-hidden />
                <Typography variant="caption">{l}</Typography>
              </Stack>
            ))}
          </Stack>
        </GlassCard>
        <Box
          sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", xl: "repeat(3, 1fr)" }, alignContent: "start" }}
        >
          <StatTile
            countUp
            label="Pipeline value"
            value={k.pipeline}
            format={compact}
            icon={<AccountBalance fontSize="small" />}
            spark={data.trend.map((x) => x.created)}
          />
          <StatTile countUp label="Weighted pipeline" value={k.weighted} format={compact} icon={<ShowChart fontSize="small" />} />
          <StatTile countUp label="Win rate" value={k.winRate} format={(v) => `${v}%`} icon={<EmojiEvents fontSize="small" />} />
          <StatTile countUp label="Bids due in 14 days" value={k.bidsDue14} icon={<Gavel fontSize="small" />} />
          <StatTile countUp label="Registrations expiring (45d)" value={k.regsExpiring} icon={<Verified fontSize="small" />} />
          <StatTile countUp label="Projects at risk" value={k.projectsAtRisk} icon={<WarningAmber fontSize="small" />} />
        </Box>
      </Box>

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "7fr 5fr" } }}>
        <GlassCard title="Pipeline trend" subtitle="New pipeline vs won value, last six months (USD)">
          <Box sx={{ height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={data.trend} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  {["created", "won"].map((key, i) => (
                    <linearGradient key={key} id={`g-${key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={i ? colors[2] : colors[0]} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={i ? colors[2] : colors[0]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical horizontal={false} stroke={t.surfaceBorder} />
                <XAxis dataKey="month" {...axis} />
                <YAxis {...axis} tickFormatter={compact} width={64} />
                <Tooltip content={<ChartTooltip />} />
                <Area name="New pipeline" type="monotone" dataKey="created" stroke={colors[0]} strokeWidth={2} fill="url(#g-created)" />
                <Area name="Won" type="monotone" dataKey="won" stroke={colors[2]} strokeWidth={2} fill="url(#g-won)" />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </GlassCard>
        <GlassCard title="Open pipeline by stage" subtitle="USD">
          <Box sx={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={data.byStage} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical horizontal={false} stroke={t.surfaceBorder} />
                <XAxis dataKey="stage" {...axis} interval={0} fontSize={11} />
                <YAxis {...axis} tickFormatter={compact} width={64} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: t.surfaceHover }} />
                <Bar name="Value" dataKey="value" fill={colors[1]} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </GlassCard>
      </Box>

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", xl: "repeat(4, 1fr)" } }}>
        <GlassCard title="Bids due soon" flush>
          {data.deadlines.length ? (
            <List dense>
              {data.deadlines.map((d) => (
                <ListItemButton key={d.id} component={Link} href={`/opportunities/${d.id}`}>
                  <ListItemText primary={d.name} secondary={`${d.account} · ${compact(d.value)}`} />
                  <Countdown date={d.proposal_due} />
                </ListItemButton>
              ))}
            </List>
          ) : (
            <EmptyState message="No proposals due in the next 14 days." />
          )}
        </GlassCard>
        <GlassCard title="Registrations expiring" flush>
          {data.expiring.length ? (
            <List dense>
              {data.expiring.map((r) => (
                <ListItemButton key={r.id} component={Link} href="/registrations">
                  <ListItemText primary={r.name} />
                  <Countdown date={r.expires_on} />
                </ListItemButton>
              ))}
            </List>
          ) : (
            <EmptyState message="All registrations are current." />
          )}
        </GlassCard>
        <GlassCard title="Awaiting client" subtitle="Published to Konnect Hub" flush>
          {data.awaiting.length ? (
            <List dense>
              {data.awaiting.map((i) => (
                <ListItemButton key={i.id} component={Link} href={`/client-items/${i.id}`}>
                  <ListItemText primary={i.title} secondary={i.account} />
                  <StatusChip value={i.status} />
                </ListItemButton>
              ))}
            </List>
          ) : (
            <EmptyState message="Nothing waiting on a client decision." />
          )}
        </GlassCard>
        <GlassCard title="Live project health" subtitle="From Konnect Hub">
          {data.atRisk.length ? (
            <Stack spacing={4}>
              {data.atRisk.map((h) => (
                <HealthRing
                  key={h.id}
                  size={72}
                  title={h.project_name}
                  schedule={h.health_schedule}
                  budget={h.health_budget}
                  acceptance={h.health_acceptance}
                />
              ))}
            </Stack>
          ) : (
            <EmptyState message="Every live project is green." />
          )}
        </GlassCard>
      </Box>
    </Stack>
  );
}
