"use client";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import { retryEventAction } from "@/app/actions/handoff";
import { useAction } from "@/components/common/useAction";
import { DataTable, EmptyState, GlassCard, StatTile, StatusChip } from "@/components/kit";
import type { IntegrationEvent } from "@/lib/domain/types";
import { dateTimeLabel } from "@/lib/format";

export function IntegrationsView({
  events,
  mode,
  target,
}: {
  events: IntegrationEvent[];
  mode: "mock" | "live" | "disabled";
  target: string;
}) {
  const retry = useAction(retryEventAction, { success: "Retry attempted" });
  const cols: GridColDef<IntegrationEvent>[] = [
    { field: "created_at", headerName: "When", width: 190, valueFormatter: (v: string) => dateTimeLabel(v) },
    {
      field: "direction",
      headerName: "Dir.",
      width: 100,
      renderCell: (p) => <StatusChip tone={p.row.direction === "outbound" ? "primary" : "accent"} label={p.row.direction} />,
    },
    { field: "event", headerName: "Event", width: 220, cellClassName: "mono" },
    { field: "status", headerName: "Status", width: 120, renderCell: (p) => <StatusChip value={p.row.status} /> },
    { field: "attempts", headerName: "Attempts", type: "number", width: 90 },
    { field: "last_error", headerName: "Last error", flex: 1, minWidth: 220 },
    { field: "idempotency_key", headerName: "Idempotency key", width: 260, cellClassName: "mono" },
    {
      field: "actions",
      headerName: "",
      width: 100,
      sortable: false,
      renderCell: (p) =>
        p.row.direction === "outbound" && p.row.status !== "delivered" ? (
          <Button size="small" disabled={retry.pending} onClick={() => retry.exec(p.row.id)}>
            Retry
          </Button>
        ) : null,
    },
  ];
  const failed = events.filter((e) => e.status === "failed" || e.status === "rejected").length;
  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Integrations
        </Typography>
        <Typography color="text.secondary">
          Konnect Hub contract v1 — signed (HMAC-SHA256), idempotent, retried with backoff. Target:{" "}
          <Typography component="span" variant="mono">
            {target}
          </Typography>
        </Typography>
      </Box>
      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", sm: "repeat(4, 1fr)" } }}>
        <StatTile label="Mode" value={0} format={() => (mode === "mock" ? "Mock" : mode === "live" ? "Live" : "Off")} />
        <StatTile label="Delivered" value={events.filter((e) => e.status === "delivered" || e.status === "processed").length} />
        <StatTile label="Pending retry" value={events.filter((e) => e.status === "pending").length} />
        <StatTile label="Failed" value={failed} />
      </Box>
      {events.length ? (
        <DataTable rows={events} columns={cols} exportName="integration-events" aria-label="Integration events" />
      ) : (
        <GlassCard>
          <EmptyState message="No integration traffic yet. Hand off a won deal to see it here." />
        </GlassCard>
      )}
    </Stack>
  );
}
