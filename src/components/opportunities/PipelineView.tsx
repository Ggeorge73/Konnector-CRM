"use client";
import Add from "@mui/icons-material/Add";
import TableRows from "@mui/icons-material/TableRowsOutlined";
import ViewKanban from "@mui/icons-material/ViewKanbanOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { moveStageAction } from "@/app/actions/capture";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { Countdown, DataTable, EmptyState, KanbanBoard, Money, StatusChip, UserAvatar } from "@/components/kit";
import { gateFor, OPEN_STAGES, type GateRequirement } from "@/lib/domain/stages";
import { OPP_KINDS, SERVICE_LINES, type Opportunity, type Stage, type StageDef } from "@/lib/domain/types";
import { humanize } from "@/lib/format";
import { OpportunityFormDialog } from "./OpportunityFormDialog";

export type PipelineRow = Opportunity & {
  account_name: string;
  owner_name: string;
  owner_color: string;
  bid_approved: boolean;
  can_edit: boolean;
};

interface PendingMove {
  row: PipelineRow;
  to: Stage;
  needs: GateRequirement[];
}

export function PipelineView(props: {
  rows: PipelineRow[];
  stages: StageDef[];
  accounts: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string }>;
  views: Array<{ id: string; name: string; query: Record<string, string> }>;
  canAssign: boolean;
  canCreate: boolean;
  isRecruiter: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = params.get("view") === "table" ? "table" : "board";
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [kind, setKind] = useState(params.get("kind") ?? "");
  const [owner, setOwner] = useState(params.get("owner") ?? "");
  const [line, setLine] = useState(params.get("line") ?? "");
  const [showClosed, setShowClosed] = useState(params.get("open") !== "true" && view === "table");
  const [local, setLocal] = useState<Record<string, Stage>>({});
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [reason, setReason] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [wonId, setWonId] = useState<string | null>(null);

  const move = useAction(moveStageAction);
  const stageLabel = (s: Stage) => props.stages.find((x) => x.key === s)?.label ?? humanize(s);

  const rows = useMemo(
    () =>
      props.rows
        .map((r) => ({ ...r, stage: local[r.id] ?? r.stage }))
        .filter(
          (r) => (!kind || r.kind === kind) && (!owner || r.owner_id === owner) && (!line || r.service_lines.includes(line as never)),
        ),
    [props.rows, local, kind, owner, line],
  );

  const commit = async (
    row: PipelineRow,
    to: Stage,
    extra: { lost_reason?: string; no_bid_reason?: string; proposal_due?: string | null } = {},
  ) => {
    const prev = row.stage;
    setLocal((m) => ({ ...m, [row.id]: to }));
    const r = await move.exec(row.id, { to, ...extra });
    if (!r.ok) setLocal((m) => ({ ...m, [row.id]: prev }));
    else if (to === "won") setWonId(row.id);
  };

  const onMove = (row: PipelineRow, to: string) => {
    const target = to as Stage;
    const needs = gateFor(row, target, row.bid_approved ? ({ status: "approved", verdict: "bid" } as never) : null).filter(
      (g) => g.kind !== "handoff",
    );
    if (needs.length) {
      setReason("");
      setDue(row.proposal_due);
      setPending({ row, to: target, needs });
      return false;
    }
    void commit(row, target);
    return true;
  };

  const columns = props.stages
    .filter((s) => OPEN_STAGES.includes(s.key) || s.key === "won" || s.key === "lost" || s.key === "no_bid")
    .map((s) => ({
      key: s.key,
      label: s.label,
      wipLimit: s.wip_limit,
      tone: s.key === "won" ? ("gold" as const) : s.closed ? ("muted" as const) : ("default" as const),
    }));

  const tableCols: GridColDef<PipelineRow>[] = [
    {
      field: "name",
      headerName: "Opportunity",
      flex: 1.6,
      minWidth: 240,
      renderCell: (p) => (
        <Link href={`/opportunities/${p.row.id}`} style={{ color: "inherit", fontWeight: 600 }}>
          {p.row.name}
        </Link>
      ),
    },
    { field: "account_name", headerName: "Account", flex: 1, minWidth: 180 },
    {
      field: "stage",
      headerName: "Stage",
      width: 130,
      valueGetter: (_v, r) => stageLabel(r.stage),
      renderCell: (p) => <StatusChip value={p.row.stage} label={stageLabel(p.row.stage)} />,
    },
    { field: "kind", headerName: "Kind", width: 150, valueFormatter: (v: string) => humanize(v) },
    {
      field: "value",
      headerName: "Value",
      type: "number",
      width: 130,
      cellClassName: "mono",
      renderCell: (p) => <Money value={p.row.value} currency={p.row.currency} />,
    },
    { field: "probability", headerName: "Prob.", type: "number", width: 80, valueFormatter: (v: number) => `${v}%` },
    { field: "solicitation_no", headerName: "Solicitation", width: 170, cellClassName: "mono" },
    {
      field: "proposal_due",
      headerName: "Proposal due",
      width: 140,
      renderCell: (p) =>
        p.row.proposal_due && !["won", "lost", "no_bid"].includes(p.row.stage) ? <Countdown date={p.row.proposal_due} /> : "—",
    },
    { field: "owner_name", headerName: "Owner", width: 140 },
  ];

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("new");
    router.replace(`${pathname}?${next.toString()}`);
  };
  const visibleRows = view === "table" && !showClosed ? rows.filter((r) => OPEN_STAGES.includes(r.stage)) : rows;

  return (
    <Stack spacing={4}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h2" component="h1">
            Pipeline
          </Typography>
          <Typography color="text.secondary">Signal → Qualify → Capture → Bid / No-Bid → Proposal → Submitted → Won.</Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v) => v && setParam("view", v === "board" ? "" : v)}
            aria-label="View"
          >
            <ToggleButton value="board" aria-label="Board view">
              <ViewKanban fontSize="small" />
            </ToggleButton>
            <ToggleButton value="table" aria-label="Table view">
              <TableRows fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
          {props.canCreate && (
            <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>
              New opportunity
            </Button>
          )}
        </Stack>
      </Stack>

      {props.views.length > 0 && (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {props.views.map((v) => (
            <Chip
              key={v.id}
              label={v.name}
              onClick={() => router.replace(`${pathname}?${new URLSearchParams({ ...v.query, view: "table" }).toString()}`)}
            />
          ))}
        </Stack>
      )}

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "220px 220px 220px auto" }, alignItems: "center" }}>
        <Select label="Kind" value={kind} onChange={setKind} options={OPP_KINDS} allowEmpty="Any kind" />
        <Select
          label="Owner"
          value={owner}
          onChange={setOwner}
          options={props.owners.map((o) => ({ value: o.id, label: o.name }))}
          allowEmpty="Anyone"
        />
        <Select label="Service line" value={line} onChange={setLine} options={SERVICE_LINES} allowEmpty="Any line" />
        {view === "table" && (
          <FormControlLabel
            control={<Switch checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />}
            label="Include closed"
          />
        )}
      </Box>

      {rows.length === 0 ? (
        <EmptyState
          message="No opportunities match these filters."
          action={props.canCreate ? <Button onClick={() => setCreating(true)}>New opportunity</Button> : undefined}
        />
      ) : view === "board" ? (
        <KanbanBoard
          columns={columns}
          cards={rows.map((r) => ({ ...r, column: r.stage, highlight: r.stage === "won" && (local[r.id] === "won" || r.id === wonId) }))}
          canDrag={(c) => (c as PipelineRow).can_edit}
          onMove={(card, to) => onMove(card as PipelineRow, to)}
          renderCard={(c) => {
            const r = c as unknown as PipelineRow;
            return (
              <Stack spacing={1.5}>
                <Link
                  href={`/opportunities/${r.id}`}
                  style={{ color: "inherit", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {r.name}
                </Link>
                <Typography variant="caption">{r.account_name}</Typography>
                {r.solicitation_no && (
                  <Typography variant="mono" sx={{ fontSize: 11 }}>
                    {r.solicitation_no}
                  </Typography>
                )}
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Money value={r.value} compact variant="body2" fontWeight={700} />
                  <Stack direction="row" spacing={1} alignItems="center">
                    {r.proposal_due && OPEN_STAGES.includes(r.stage) && <Countdown date={r.proposal_due} />}
                    <UserAvatar name={r.owner_name} color={r.owner_color} size={22} />
                  </Stack>
                </Stack>
              </Stack>
            );
          }}
        />
      ) : (
        <DataTable rows={visibleRows} columns={tableCols} exportName="konnector-pipeline" aria-label="Opportunities" />
      )}

      {pending && (
        <FormDialog
          open
          title={`Move to ${stageLabel(pending.to)}`}
          subtitle={pending.row.name}
          onClose={() => setPending(null)}
          submitLabel={pending.needs.some((n) => n.kind === "bid_decision") ? "Open scorecard" : `Move to ${stageLabel(pending.to)}`}
          danger={pending.to === "lost" || pending.to === "no_bid"}
          onSubmit={async () => {
            if (pending.needs.some((n) => n.kind === "bid_decision")) {
              router.push(`/opportunities/${pending.row.id}?tab=bid`);
              return;
            }
            const extra = {
              lost_reason: pending.to === "lost" ? reason : undefined,
              no_bid_reason: pending.to === "no_bid" ? reason : undefined,
              proposal_due: due,
            };
            setPending(null);
            await commit(pending.row, pending.to, extra);
          }}
        >
          {pending.needs.map((n) =>
            n.kind === "bid_decision" ? (
              <Alert key={n.kind} severity="warning">
                This is a public bid. Complete the Bid/No-Bid scorecard and get executive approval before it can leave the Bid / No-Bid
                gate.
              </Alert>
            ) : n.kind === "proposal_due" ? (
              <DateField key={n.kind} label="Proposal due date" value={due} onChange={setDue} required />
            ) : (
              <Text
                key={n.kind}
                label={n.kind === "lost_reason" ? "Why did we lose?" : "Why are we not bidding?"}
                value={reason}
                onChange={setReason}
                multiline
                minRows={2}
                required
                autoFocus
              />
            ),
          )}
        </FormDialog>
      )}

      {wonId && (
        <FormDialog
          open
          title="Won! Hand off to Konnect Hub?"
          subtitle="Run the handoff wizard to create the project in Konnect Hub."
          onClose={() => setWonId(null)}
          submitLabel="Start handoff"
          onSubmit={() => router.push(`/opportunities/${wonId}?handoff=1`)}
        >
          <Typography>Delivery happens in Konnect Hub. The wizard collects the contract details and sends a signed handoff.</Typography>
        </FormDialog>
      )}

      {creating && (
        <OpportunityFormDialog
          open
          onClose={() => setCreating(false)}
          accounts={props.accounts}
          owners={props.owners}
          canAssign={props.canAssign}
          defaultAccountId={params.get("account") ?? undefined}
          onlyStaffing={props.isRecruiter}
        />
      )}
    </Stack>
  );
}
