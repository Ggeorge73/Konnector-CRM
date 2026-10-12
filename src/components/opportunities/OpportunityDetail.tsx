"use client";
import Add from "@mui/icons-material/Add";
import Edit from "@mui/icons-material/EditOutlined";
import SwapHoriz from "@mui/icons-material/SwapHoriz";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useMemo, useState } from "react";
import { moveStageAction } from "@/app/actions/capture";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { Countdown, EmptyState, GlassCard, HealthRing, Money, RecordHeader, StatusChip, type TimelineItem } from "@/components/kit";
import { HandoffPanel, type HandoffContext } from "@/components/handoff/HandoffPanel";
import { QuoteEditor } from "@/components/quotes/QuoteEditor";
import { FilesPanel } from "@/components/records/FilesPanel";
import { TasksPanel, type TaskRow } from "@/components/records/TasksPanel";
import { TimelinePanel } from "@/components/records/TimelinePanel";
import { gateFor } from "@/lib/domain/stages";
import type {
  AccountType,
  BidCriterion,
  BidDecision,
  FileRow,
  Handoff,
  Opportunity,
  ProjectHealth,
  Stage,
  StageDef,
} from "@/lib/domain/types";
import { dateLabel, humanize, money, pct } from "@/lib/format";
import type { QuoteView } from "@/lib/services/capture";
import { BidPanel } from "./BidPanel";
import { OpportunityFormDialog } from "./OpportunityFormDialog";

export interface OpportunityDetailProps {
  opportunity: Opportunity;
  account: { id: string; name: string; type: AccountType };
  ownerName: string;
  sharedNames: string[];
  stages: StageDef[];
  bids: { visible: boolean; decisions: BidDecision[] };
  weights: Record<BidCriterion, number>;
  marginFloor: number;
  quotes: QuoteView[];
  partners: Array<{ id: string; name: string }>;
  timeline: TimelineItem[];
  tasks: TaskRow[];
  files: FileRow[];
  people: string[];
  users: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  handoff: Handoff | null;
  health: ProjectHealth | null;
  currentUserId: string;
  canEdit: boolean;
  canApprove: boolean;
  canAssign: boolean;
  canHandoff: boolean;
  initialTab?: string;
  openHandoff?: boolean;
  handoffCtx: HandoffContext;
}

export function OpportunityDetail(p: OpportunityDetailProps) {
  const o = p.opportunity;
  const tabs = useMemo(
    () => [
      { key: "overview", label: "Overview" },
      ...(o.kind === "public_bid" || p.bids.decisions.length ? [{ key: "bid", label: "Bid / No-Bid" }] : []),
      { key: "quotes", label: `Quotes (${p.quotes.length})` },
      ...(o.stage === "won" || p.handoff ? [{ key: "handoff", label: "Handoff" }] : []),
      { key: "timeline", label: `Timeline (${p.timeline.length})` },
      { key: "tasks", label: `Follow-ups (${p.tasks.filter((t) => t.status === "open").length})` },
      { key: "files", label: `Files (${p.files.length})` },
    ],
    [o.kind, o.stage, p.bids.decisions.length, p.quotes.length, p.handoff, p.timeline.length, p.tasks, p.files.length],
  );
  const [tab, setTab] = useState(p.openHandoff ? "handoff" : tabs.some((t) => t.key === p.initialTab) ? p.initialTab! : "overview");
  const [editing, setEditing] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [stageEl, setStageEl] = useState<HTMLElement | null>(null);
  const [gate, setGate] = useState<{ to: Stage } | null>(null);
  const [reason, setReason] = useState("");
  const [due, setDue] = useState<string | null>(o.proposal_due);
  const move = useAction(moveStageAction, { success: "Stage updated" });
  const label = (s: Stage) => p.stages.find((x) => x.key === s)?.label ?? humanize(s);
  const approved = p.bids.decisions.find((d) => d.status === "approved") ?? null;
  const names = new Map(p.users.map((u) => [u.id, u.name]));
  const canSeeCost = p.quotes.length === 0 || p.quotes.some((q) => q.canSeeCost);

  const startMove = (to: Stage) => {
    setStageEl(null);
    // Bid visibility is restricted, so a bd non-owner can't know approval status; the server re-checks.
    const needs = gateFor(o, to, approved ?? (p.bids.visible ? null : ({ status: "approved", verdict: "bid" } as BidDecision))).filter(
      (g) => g.kind !== "handoff",
    );
    if (needs.some((n) => n.kind === "bid_decision")) {
      setTab("bid");
      return;
    }
    if (needs.length) {
      setReason("");
      setGate({ to });
      return;
    }
    void move.exec(o.id, { to });
  };

  return (
    <Stack spacing={4}>
      <RecordHeader
        name={o.name}
        subtitle={
          <>
            <Link href={`/accounts/${p.account.id}`}>{p.account.name}</Link>
            {o.solicitation_no && (
              <>
                {" · "}
                <Typography component="span" variant="mono">
                  {o.solicitation_no}
                </Typography>
              </>
            )}
          </>
        }
        chips={
          <>
            <StatusChip value={o.stage} label={label(o.stage)} />
            <StatusChip tone="accent" label={humanize(o.kind)} />
            {o.service_lines.map((s) => (
              <StatusChip key={s} tone="neutral" label={humanize(s)} />
            ))}
            {o.proposal_due && !["won", "lost", "no_bid"].includes(o.stage) && <Countdown date={o.proposal_due} label="Proposal" />}
            {o.questions_due && (o.stage === "capture" || o.stage === "qualify" || o.stage === "bid_no_bid") && (
              <Countdown date={o.questions_due} label="Questions" />
            )}
          </>
        }
        metrics={[
          { label: "Value", value: <Money value={o.value} currency={o.currency} /> },
          { label: "Probability", value: pct(o.probability) },
          { label: "Weighted", value: <Money value={(o.value * o.probability) / 100} currency={o.currency} /> },
          { label: "Pwin", value: o.pwin === null ? "—" : pct(o.pwin) },
          { label: "Expected close", value: dateLabel(o.expected_close) },
          { label: "Owner", value: p.ownerName },
        ]}
        actions={
          <>
            {o.stage === "won" && !p.handoff && p.canHandoff && (
              <Button variant="contained" color="gold" onClick={() => setTab("handoff")}>
                Hand off to Konnect Hub
              </Button>
            )}
            {p.canEdit && (
              <>
                <Button variant="outlined" startIcon={<Edit />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="contained" startIcon={<SwapHoriz />} onClick={(e) => setStageEl(e.currentTarget)} aria-haspopup="menu">
                  Move stage
                </Button>
              </>
            )}
          </>
        }
      />
      <Menu anchorEl={stageEl} open={!!stageEl} onClose={() => setStageEl(null)}>
        {p.stages
          .filter((s) => s.key !== o.stage)
          .map((s) => (
            <MenuItem key={s.key} onClick={() => startMove(s.key)}>
              {s.label}
            </MenuItem>
          ))}
      </Menu>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile aria-label="Opportunity sections">
        {tabs.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </Tabs>

      {tab === "overview" && (
        <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" } }}>
          <Stack spacing={4}>
            <GlassCard title="Next step">
              <Typography>{o.next_step ?? "No next step set."}</Typography>
              {o.next_step_due && (
                <Box sx={{ mt: 2 }}>
                  <Countdown date={o.next_step_due} label="Due" />
                </Box>
              )}
              {o.lost_reason && (
                <Typography sx={{ mt: 2 }} color="error.main">
                  Lost: {o.lost_reason}
                </Typography>
              )}
              {o.no_bid_reason && (
                <Typography sx={{ mt: 2 }} color="warning.main">
                  No-bid: {o.no_bid_reason}
                </Typography>
              )}
            </GlassCard>
            {o.kind === "public_bid" && (
              <GlassCard title="Solicitation">
                <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
                  {(
                    [
                      ["Solicitation no.", o.solicitation_no],
                      ["Agency buyer", o.agency_buyer],
                      ["Procurement vehicle", o.procurement_vehicle],
                      ["NAICS", o.naics],
                      ["Set-aside", o.set_aside],
                      ["Submission method", o.submission_method],
                      ["Incumbent", o.incumbent],
                      ["Questions due", dateLabel(o.questions_due)],
                      ["Proposal due", dateLabel(o.proposal_due)],
                    ] as const
                  ).map(([k, v]) => (
                    <Box key={k}>
                      <Typography variant="subtitle2" component="p">
                        {k}
                      </Typography>
                      <Typography variant={k === "Solicitation no." || k === "NAICS" ? "mono" : "body1"}>{v ?? "—"}</Typography>
                    </Box>
                  ))}
                </Box>
              </GlassCard>
            )}
          </Stack>
          <Stack spacing={4}>
            {p.health && (
              <GlassCard title="Delivery health" subtitle="Read-only from Konnect Hub">
                <HealthRing
                  schedule={p.health.health_schedule}
                  budget={p.health.health_budget}
                  acceptance={p.health.health_acceptance}
                  percentComplete={p.health.percent_complete}
                  updatedAt={p.health.hub_updated_at}
                  hubUrl={p.handoff?.konnect_hub_url}
                  size={96}
                />
              </GlassCard>
            )}
            <GlassCard title="Team">
              <Typography>
                Owner: <strong>{p.ownerName}</strong>
              </Typography>
              <Typography sx={{ mt: 1 }} color="text.secondary">
                Shared with: {p.sharedNames.length ? p.sharedNames.join(", ") : "nobody"}
              </Typography>
            </GlassCard>
            <GlassCard title="Bid / No-Bid">
              {!p.bids.visible ? (
                <Typography color="text.secondary">Restricted to the deal owner and executives.</Typography>
              ) : p.bids.decisions[0] ? (
                <Stack direction="row" spacing={2} alignItems="center">
                  <Typography variant="h4">{p.bids.decisions[0].total_score}</Typography>
                  <StatusChip value={p.bids.decisions[0].verdict} />
                  <StatusChip value={p.bids.decisions[0].status} />
                </Stack>
              ) : (
                <Typography color="text.secondary">No scorecard yet.</Typography>
              )}
            </GlassCard>
          </Stack>
        </Box>
      )}

      {tab === "bid" && (
        <BidPanel opportunityId={o.id} bids={p.bids} weights={p.weights} canEdit={p.canEdit} canApprove={p.canApprove} names={names} />
      )}

      {tab === "quotes" && (
        <GlassCard
          title="Quotes"
          subtitle={`Margin floor ${p.marginFloor}% — lower margins need executive approval`}
          action={
            p.canEdit && canSeeCost ? (
              <Button startIcon={<Add />} onClick={() => setQuoteOpen(true)}>
                New quote
              </Button>
            ) : undefined
          }
          flush
        >
          {p.quotes.length ? (
            <List>
              {p.quotes.map((q) => (
                <ListItemButton key={q.id} component={Link} href={`/quotes/${q.id}`}>
                  <ListItemText
                    primary={`${q.number} · ${q.title}`}
                    secondary={`${money(q.totals.price, q.currency)}${q.totals.marginPct !== null ? ` · margin ${pct(q.totals.marginPct, 1)}` : ""}`}
                  />
                  <StatusChip value={q.status} />
                </ListItemButton>
              ))}
            </List>
          ) : (
            <EmptyState
              message="No quotes yet."
              action={p.canEdit ? <Button onClick={() => setQuoteOpen(true)}>New quote</Button> : undefined}
            />
          )}
        </GlassCard>
      )}

      {tab === "handoff" && <HandoffPanel ctx={p.handoffCtx} autoOpen={p.openHandoff} />}

      {tab === "timeline" && (
        <TimelinePanel
          items={p.timeline}
          relatedType="opportunity"
          relatedId={o.id}
          accountId={p.account.id}
          people={p.people}
          currentUserId={p.currentUserId}
        />
      )}
      {tab === "tasks" && (
        <TasksPanel tasks={p.tasks} users={p.users} related={{ type: "opportunity", id: o.id, accountId: p.account.id }} />
      )}
      {tab === "files" && <FilesPanel files={p.files} related={{ type: "opportunity", id: o.id, accountId: p.account.id }} />}

      {gate && (
        <FormDialog
          open
          title={`Move to ${label(gate.to)}`}
          onClose={() => setGate(null)}
          danger={gate.to === "lost" || gate.to === "no_bid"}
          pending={move.pending}
          onSubmit={async () => {
            const r = await move.exec(o.id, {
              to: gate.to,
              lost_reason: gate.to === "lost" ? reason : undefined,
              no_bid_reason: gate.to === "no_bid" ? reason : undefined,
              proposal_due: due,
            });
            if (r.ok) setGate(null);
          }}
        >
          {gate.to === "proposal" && !o.proposal_due && <DateField label="Proposal due date" value={due} onChange={setDue} required />}
          {(gate.to === "lost" || gate.to === "no_bid") && (
            <Text
              label={gate.to === "lost" ? "Why did we lose?" : "Why are we not bidding?"}
              value={reason}
              onChange={setReason}
              multiline
              minRows={2}
              required
              autoFocus
            />
          )}
        </FormDialog>
      )}
      {editing && (
        <OpportunityFormDialog
          open
          onClose={() => setEditing(false)}
          opportunity={o}
          accounts={p.accounts}
          owners={p.users}
          canAssign={p.canAssign}
        />
      )}
      {quoteOpen && (
        <QuoteEditor open onClose={() => setQuoteOpen(false)} opportunityId={o.id} marginFloor={p.marginFloor} partners={p.partners} />
      )}
    </Stack>
  );
}
