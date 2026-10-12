"use client";
import Download from "@mui/icons-material/DownloadOutlined";
import Edit from "@mui/icons-material/EditOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { useState } from "react";
import { approveQuoteAction, setQuoteStatusAction, submitQuoteAction } from "@/app/actions/capture";
import { useAction } from "@/components/common/useAction";
import { DataTable, GlassCard, Money, RecordHeader, Restricted, StatusChip } from "@/components/kit";
import { dateLabel, pct } from "@/lib/format";
import type { QuoteView } from "@/lib/services/capture";
import { QuoteEditor } from "./QuoteEditor";

type Line = QuoteView["lines"][number];

export function QuoteDetail(p: {
  quote: QuoteView;
  opportunity: { id: string; name: string };
  accountName: string;
  partnerNames: Record<string, string>;
  partners: Array<{ id: string; name: string }>;
  ownerName: string;
  approverName: string | null;
  marginFloor: number;
  canEdit: boolean;
  canApprove: boolean;
  /** Slot for the Publish-to-client action (client commercial loop). */
  publishSlot?: React.ReactNode;
}) {
  const q = p.quote;
  const [editing, setEditing] = useState(false);
  const submit = useAction(submitQuoteAction, { success: "Quote submitted" });
  const approve = useAction(approveQuoteAction, { success: "Decision recorded" });
  const status = useAction(setQuoteStatusAction, { success: "Quote updated" });
  const cols: GridColDef<Line>[] = [
    { field: "position", headerName: "#", width: 50 },
    { field: "item", headerName: "Item", flex: 1, minWidth: 220 },
    {
      field: "oem_partner_account_id",
      headerName: "OEM / partner",
      width: 180,
      valueFormatter: (v: string | null) => (v ? (p.partnerNames[v] ?? "—") : "—"),
    },
    { field: "qty", headerName: "Qty", type: "number", width: 90 },
    ...(q.canSeeCost
      ? [
          {
            field: "unit_cost",
            headerName: "Unit cost",
            type: "number",
            width: 130,
            cellClassName: "mono",
            renderCell: (r: { row: Line }) => <Money value={r.row.unit_cost} />,
          } as GridColDef<Line>,
        ]
      : []),
    {
      field: "unit_price",
      headerName: "Unit price",
      type: "number",
      width: 130,
      cellClassName: "mono",
      renderCell: (r) => <Money value={r.row.unit_price} />,
    },
    {
      field: "total",
      headerName: "Amount",
      type: "number",
      width: 140,
      cellClassName: "mono",
      valueGetter: (_v, r) => r.qty * r.unit_price,
      renderCell: (r) => <Money value={r.row.qty * r.row.unit_price} />,
    },
    ...(q.canSeeCost
      ? [
          {
            field: "margin_pct",
            headerName: "Margin",
            width: 100,
            renderCell: (r: { row: Line }) => (
              <Typography
                variant="body2"
                fontWeight={700}
                color={(r.row.margin_pct ?? 0) < p.marginFloor ? "warning.main" : "success.main"}
              >
                {pct(r.row.margin_pct, 1)}
              </Typography>
            ),
          } as GridColDef<Line>,
        ]
      : []),
  ];

  return (
    <Stack spacing={4}>
      <RecordHeader
        name={`${q.number} · ${q.title}`}
        subtitle={
          <>
            {p.accountName} · <Link href={`/opportunities/${p.opportunity.id}`}>{p.opportunity.name}</Link>
          </>
        }
        chips={<StatusChip value={q.status} />}
        metrics={[
          { label: "Total", value: <Money value={q.totals.price} currency={q.currency} /> },
          { label: "Cost", value: q.totals.cost === null ? <Restricted /> : <Money value={q.totals.cost} /> },
          { label: "Margin", value: q.totals.marginPct === null ? <Restricted /> : pct(q.totals.marginPct, 1) },
          { label: "Valid until", value: dateLabel(q.valid_until) },
          { label: "Owner", value: p.ownerName },
          { label: "Approved by", value: p.approverName ?? "—" },
        ]}
        actions={
          <>
            <Button variant="outlined" startIcon={<Download />} href={`/api/quotes/${q.id}/pdf`} target="_blank">
              Client PDF
            </Button>
            {p.canEdit && ["draft", "pending_approval", "approved"].includes(q.status) && (
              <Button variant="outlined" startIcon={<Edit />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {p.canEdit && q.status === "draft" && (
              <Button variant="contained" disabled={submit.pending} onClick={() => submit.exec(q.id)}>
                Submit
              </Button>
            )}
            {p.canEdit && q.status === "approved" && (
              <Button variant="contained" disabled={status.pending} onClick={() => status.exec(q.id, "sent")}>
                Mark sent
              </Button>
            )}
            {p.canEdit && q.status === "sent" && (
              <>
                <Button variant="contained" color="success" onClick={() => status.exec(q.id, "accepted")}>
                  Accepted
                </Button>
                <Button variant="outlined" color="error" onClick={() => status.exec(q.id, "declined")}>
                  Declined
                </Button>
              </>
            )}
            {p.publishSlot}
          </>
        }
      />
      {q.belowFloor && q.status === "draft" && (
        <Alert severity="warning">
          Margin {pct(q.totals.marginPct, 1)} is below the {p.marginFloor}% floor. Submitting routes it to an executive.
        </Alert>
      )}
      {q.status === "pending_approval" && (
        <Alert
          severity="warning"
          action={
            p.canApprove ? (
              <Stack direction="row" spacing={1}>
                <Button color="inherit" size="small" disabled={approve.pending} onClick={() => approve.exec(q.id, true)}>
                  Approve margin
                </Button>
                <Button color="inherit" size="small" disabled={approve.pending} onClick={() => approve.exec(q.id, false)}>
                  Send back
                </Button>
              </Stack>
            ) : undefined
          }
        >
          Waiting for executive margin approval.
        </Alert>
      )}
      <DataTable rows={q.lines} columns={cols} exportName={q.number} hideFooter aria-label="Quote lines" />
      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
        <GlassCard title="Client terms" subtitle="Printed on the PDF">
          <Typography sx={{ whiteSpace: "pre-wrap" }}>{q.terms ?? "—"}</Typography>
        </GlassCard>
        <GlassCard title="Internal notes" subtitle="Never leaves the CRM">
          {q.canSeeCost ? <Typography sx={{ whiteSpace: "pre-wrap" }}>{q.internal_notes ?? "—"}</Typography> : <Restricted />}
        </GlassCard>
      </Box>
      {editing && (
        <QuoteEditor
          open
          onClose={() => setEditing(false)}
          opportunityId={p.opportunity.id}
          quote={q}
          marginFloor={p.marginFloor}
          partners={p.partners}
        />
      )}
    </Stack>
  );
}
