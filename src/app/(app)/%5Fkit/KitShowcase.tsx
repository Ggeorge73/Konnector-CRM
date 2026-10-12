"use client";
import Add from "@mui/icons-material/Add";
import AttachMoney from "@mui/icons-material/AttachMoney";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import {
  Countdown,
  DataTable,
  EmptyState,
  GlassCard,
  HealthRing,
  KanbanBoard,
  Money,
  RecordHeader,
  Restricted,
  ScoreCard,
  StatTile,
  StatusChip,
  Timeline,
  UserAvatar,
  type KanbanCardData,
} from "@/components/kit";
import { PulseGlobe } from "@/components/kit/PulseGlobe";
import { defaultScores } from "@/lib/domain/bid";
import { DEFAULT_BID_WEIGHTS } from "@/lib/data/seed";

// Fixed base so server and client render identical timestamps.
const BASE = Date.UTC(2026, 9, 1, 15);
const iso = (d: number) => new Date(BASE + d * 86_400_000).toISOString();

export function KitShowcase() {
  const [scores, setScores] = useState(defaultScores());
  const [cards, setCards] = useState<Array<KanbanCardData & { name: string }>>([
    { id: "1", column: "capture", value: 1_200_000, name: "Traffic Data Platform" },
    { id: "2", column: "capture", value: 520_000, name: "Permitting Portal" },
    { id: "3", column: "proposal", value: 2_450_000, name: "Service Desk Modernisation" },
    { id: "4", column: "won", value: 980_000, name: "EHR Integration Hub", highlight: true },
  ]);
  return (
    <Stack spacing={6}>
      <Box>
        <Typography variant="h2" component="h1">
          Component kit
        </Typography>
        <Typography color="text.secondary">
          Every signature component in its main states. Toggle the theme in the top bar to check both modes.
        </Typography>
      </Box>

      <GlassCard title="Typography & colour" subtitle="Plus Jakarta Sans for UI, JetBrains Mono for IDs and money">
        <Stack spacing={1}>
          <Typography variant="h1">Heading 40</Typography>
          <Typography variant="h2">Heading 32</Typography>
          <Typography variant="h3">Heading 24</Typography>
          <Typography variant="h4">Heading 20</Typography>
          <Typography>Body 14 — The CRM&apos;s job is winning the work.</Typography>
          <Typography variant="mono">
            GTA-RFP-2026-0417 · <Money value={2450000} />
          </Typography>
        </Stack>
        <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" sx={{ mt: 4 }}>
          {["neutral", "primary", "accent", "gold", "success", "warning", "danger", "violet"].map((t) => (
            <StatusChip key={t} tone={t as never} label={t} />
          ))}
        </Stack>
      </GlassCard>

      <GlassCard title="Buttons, inputs, chips">
        <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center">
          <Button variant="contained" startIcon={<Add />}>
            Primary
          </Button>
          <Button variant="outlined">Secondary</Button>
          <Button>Text</Button>
          <Button variant="contained" disabled>
            Disabled
          </Button>
          <Button variant="contained" color="error">
            Destructive
          </Button>
          <TextField size="small" label="Account name" />
          <TextField size="small" label="With error" error helperText="Name is required" />
          <Countdown date={iso(2)} label="Proposal" />
          <Countdown date={iso(8)} label="Questions" />
          <Countdown date={iso(30)} />
          <Countdown date={iso(-4)} />
          <Restricted />
          <UserAvatar name="Adaeze Okafor" color="#F5B841" />
        </Stack>
      </GlassCard>

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" } }}>
        <StatTile
          label="Pipeline value"
          value={18_400_000}
          format={(v) => `$${(v / 1e6).toFixed(1)}M`}
          delta={{ value: 12, label: "vs last month" }}
          spark={[3, 5, 4, 6, 7, 6, 9]}
          icon={<AttachMoney />}
        />
        <StatTile
          label="Win rate"
          value={42}
          format={(v) => `${v}%`}
          delta={{ value: -3, label: "vs last quarter" }}
          spark={[50, 48, 44, 45, 42]}
        />
        <StatTile label="Bids due in 14 days" value={3} />
        <StatTile label="Registrations expiring" value={2} delta={{ value: 1, label: "new", goodWhen: "down" }} />
      </Box>

      <RecordHeader
        name="Georgia Technology Authority"
        subtitle="Public sector IT · Atlanta, GA"
        chips={
          <>
            <StatusChip value="government_state" />
            <StatusChip value="active_client" />
            <StatusChip tone="gold" label="Tier A" />
          </>
        }
        metrics={[
          { label: "Open pipeline", value: <Money value={2450000} /> },
          { label: "Won (12 mo)", value: <Money value={380000} /> },
          { label: "Owner", value: "Marcus Bell" },
          { label: "Survey", value: "8/10" },
        ]}
        actions={
          <>
            <Button variant="outlined">Log activity</Button>
            <Button variant="contained">New opportunity</Button>
          </>
        }
      />

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
        <GlassCard title="HealthRing" subtitle="Read-only, fed by Konnect Hub">
          <Stack spacing={5}>
            <HealthRing
              schedule="green"
              budget="amber"
              acceptance="green"
              percentComplete={62}
              updatedAt={iso(-1)}
              hubUrl="#"
              title="311 Platform Phase 2"
            />
            <HealthRing schedule="red" budget="red" acceptance="amber" size={80} />
          </Stack>
        </GlassCard>
        <GlassCard title="ScoreCard" subtitle="Bid/No-Bid weighted scoring">
          <ScoreCard scores={scores} weights={DEFAULT_BID_WEIGHTS} onChange={(c, v) => setScores((s) => ({ ...s, [c]: v }))} />
        </GlassCard>
      </Box>

      <GlassCard title="Timeline">
        <Timeline
          currentUserId="me"
          onReact={() => {}}
          items={[
            {
              id: "a",
              type: "note",
              subject: "Pricing strategy",
              body: "@Adaeze Okafor hold blended rate under $150.",
              occurred_at: iso(-0.1),
              actorName: "Marcus Bell",
              reactions: { "👍": ["me"] },
            },
            {
              id: "b",
              type: "stage_change",
              subject: "Capture → Bid / No-Bid",
              body: null,
              occurred_at: iso(-2),
              actorName: "Marcus Bell",
            },
            {
              id: "c",
              type: "handoff",
              subject: "Handed off to Konnect Hub",
              body: "Project created.",
              occurred_at: iso(-20),
              actorName: "Lara Mitchell",
            },
            { id: "d", type: "system", subject: "Health updated from Konnect Hub", body: null, occurred_at: iso(-21), actorName: null },
          ]}
        />
      </GlassCard>

      <GlassCard title="KanbanBoard" subtitle="Drag cards between columns; WIP warning on Capture (limit 1)">
        <KanbanBoard
          columns={[
            { key: "capture", label: "Capture", wipLimit: 1 },
            { key: "proposal", label: "Proposal" },
            { key: "won", label: "Won", tone: "gold" },
          ]}
          cards={cards}
          onMove={(card, to) => setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, column: to, highlight: to === "won" } : c)))}
          renderCard={(c) => (
            <Box>
              <Typography fontWeight={700}>{c.name}</Typography>
              <Money value={c.value} variant="body2" />
            </Box>
          )}
        />
      </GlassCard>

      <Box>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          DataTable
        </Typography>
        <DataTable
          exportName="kit-sample"
          rows={[
            { id: 1, name: "Georgia Department of Revenue", type: "State", value: 3_900_000 },
            { id: 2, name: "City of Atlanta", type: "Local", value: 1_750_000 },
            { id: 3, name: "Peachtree Health Partners", type: "Private", value: 980_000 },
          ]}
          columns={[
            { field: "name", headerName: "Account", flex: 1, minWidth: 200 },
            { field: "type", headerName: "Type", width: 120 },
            {
              field: "value",
              headerName: "Pipeline",
              width: 160,
              type: "number",
              cellClassName: "mono",
              valueFormatter: (v: number) => `$${v.toLocaleString()}`,
            },
          ]}
          checkboxSelection
        />
      </Box>

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
        <GlassCard title="EmptyState">
          <EmptyState message="No opportunities match these filters." action={<Button variant="contained">New opportunity</Button>} />
        </GlassCard>
        <GlassCard title="PulseGlobe" flush>
          <PulseGlobe
            height={320}
            points={[
              { id: "1", name: "Lagos", lat: 6.52, lng: 3.38, live: true },
              { id: "2", name: "Washington", lat: 38.9, lng: -77.04 },
              { id: "3", name: "Munich", lat: 48.14, lng: 11.58 },
            ]}
          />
        </GlassCard>
      </Box>
    </Stack>
  );
}
