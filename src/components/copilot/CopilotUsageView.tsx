"use client";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import { DataTable, EmptyState, StatTile, StatusChip } from "@/components/kit";
import type { CopilotUsageRow } from "@/lib/copilot/usage";
import { dateTimeLabel, humanize } from "@/lib/format";

export function CopilotUsageView({
  usage,
  live,
}: {
  usage: {
    scope: "everyone" | "mine";
    days: number;
    totals: { requests: number; inputTokens: number; outputTokens: number; failed: number };
    rows: CopilotUsageRow[];
  };
  live: boolean;
}) {
  const cols: GridColDef<CopilotUsageRow>[] = [
    { field: "created_at", headerName: "When", width: 180, valueFormatter: (v: string) => dateTimeLabel(v) },
    ...(usage.scope === "everyone" ? [{ field: "user", headerName: "Who", width: 160 } as GridColDef<CopilotUsageRow>] : []),
    { field: "task", headerName: "Task", width: 170, valueFormatter: (v: string) => humanize(v) },
    { field: "related_type", headerName: "Record", width: 120, valueFormatter: (v: string | null) => humanize(v) },
    { field: "status", headerName: "Status", width: 120, renderCell: (p) => <StatusChip value={p.value} label={humanize(p.value)} /> },
    { field: "input_tokens", headerName: "Input tokens", width: 130, type: "number", cellClassName: "mono" },
    { field: "output_tokens", headerName: "Output tokens", width: 130, type: "number", cellClassName: "mono" },
    {
      field: "latency_ms",
      headerName: "Time (s)",
      width: 100,
      type: "number",
      valueFormatter: (v: number) => (v / 1000).toFixed(1),
      cellClassName: "mono",
    },
  ];
  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Copilot
        </Typography>
        <Typography color="text.secondary">
          {usage.scope === "everyone" ? "Everyone's" : "Your"} Copilot requests in the last {usage.days} days. Prompts and answers
          aren&apos;t stored — only usage.
        </Typography>
      </Box>
      {!live && (
        <Alert severity="info">
          Copilot is in demo mode: answers are generated from CRM data without calling Claude. Set ANTHROPIC_API_KEY on the server to go
          live.
        </Alert>
      )}
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
        <StatTile label="Requests" value={usage.totals.requests} />
        <StatTile label="Input tokens" value={usage.totals.inputTokens} />
        <StatTile label="Output tokens" value={usage.totals.outputTokens} />
        <StatTile label="Refused or failed" value={usage.totals.failed} />
      </Box>
      {usage.rows.length ? (
        <DataTable rows={usage.rows} columns={cols} exportName="konnector-copilot-usage" aria-label="Copilot usage" />
      ) : (
        <EmptyState message="No Copilot requests yet. Open an account, contact or opportunity and press Copilot." />
      )}
    </Stack>
  );
}
