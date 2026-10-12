"use client";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import { DataTable, EmptyState } from "@/components/kit";
import type { AuditLog } from "@/lib/domain/types";
import { dateTimeLabel } from "@/lib/format";

type Row = AuditLog & { actor: string };
const json = (v: unknown) => (v ? JSON.stringify(v) : "—");

export function AuditView({ rows }: { rows: Row[] }) {
  const cols: GridColDef<Row>[] = [
    { field: "created_at", headerName: "When", width: 190, valueFormatter: (v: string) => dateTimeLabel(v) },
    { field: "actor", headerName: "Who", width: 160 },
    { field: "action", headerName: "Action", width: 220, cellClassName: "mono" },
    { field: "entity", headerName: "Entity", width: 140 },
    { field: "before", headerName: "Before", flex: 1, minWidth: 220, valueFormatter: (v: unknown) => json(v), cellClassName: "mono" },
    { field: "after", headerName: "After", flex: 1, minWidth: 220, valueFormatter: (v: unknown) => json(v), cellClassName: "mono" },
  ];
  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Audit log
        </Typography>
        <Typography color="text.secondary">Append-only record of changes to money, stage, ownership and permissions.</Typography>
      </Box>
      {rows.length ? (
        <DataTable rows={rows} columns={cols} exportName="konnector-audit" aria-label="Audit log" />
      ) : (
        <EmptyState message="No audited changes yet." />
      )}
    </Stack>
  );
}
