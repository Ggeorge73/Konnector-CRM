"use client";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { DataTable, EmptyState, Restricted, StatTile, StatusChip } from "@/components/kit";
import type { Quote } from "@/lib/domain/types";
import { dateLabel, money, pct } from "@/lib/format";

interface Row {
  id: string;
  number: string;
  title: string;
  status: Quote["status"];
  account: string;
  opportunity: string;
  opportunity_id: string;
  price: number;
  margin_pct: number | null;
  below_floor: boolean | null;
  currency: string;
  valid_until: string | null;
}

export function QuotesView({ rows, marginFloor }: { rows: Row[]; marginFloor: number }) {
  const cols: GridColDef<Row>[] = [
    {
      field: "number",
      headerName: "Quote",
      width: 130,
      cellClassName: "mono",
      renderCell: (p) => (
        <Link href={`/quotes/${p.row.id}`} style={{ color: "inherit", fontWeight: 600 }}>
          {p.row.number}
        </Link>
      ),
    },
    { field: "title", headerName: "Title", flex: 1, minWidth: 220 },
    { field: "account", headerName: "Account", flex: 1, minWidth: 180 },
    { field: "status", headerName: "Status", width: 150, renderCell: (p) => <StatusChip value={p.row.status} /> },
    { field: "price", headerName: "Total", type: "number", width: 140, cellClassName: "mono", valueFormatter: (v: number) => money(v) },
    {
      field: "margin_pct",
      headerName: "Margin",
      width: 110,
      renderCell: (p) =>
        p.row.margin_pct === null ? (
          <Restricted />
        ) : (
          <Typography variant="body2" color={p.row.below_floor ? "warning.main" : "success.main"} fontWeight={700}>
            {pct(p.row.margin_pct, 1)}
          </Typography>
        ),
    },
    { field: "valid_until", headerName: "Valid until", width: 130, valueFormatter: (v: string) => dateLabel(v) },
  ];
  const pending = rows.filter((r) => r.status === "pending_approval").length;
  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Quotes
        </Typography>
        <Typography color="text.secondary">
          Services and reseller quotes. Margin floor {marginFloor}% — below that needs executive approval.
        </Typography>
      </Box>
      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}>
        <StatTile
          label="Open quote value"
          value={rows.filter((r) => ["draft", "pending_approval", "approved", "sent"].includes(r.status)).reduce((s, r) => s + r.price, 0)}
          format={(v) => money(v, "USD", { compact: true })}
        />
        <StatTile label="Awaiting approval" value={pending} />
        <StatTile label="Accepted" value={rows.filter((r) => r.status === "accepted").length} />
      </Box>
      {rows.length ? (
        <DataTable rows={rows} columns={cols} exportName="konnector-quotes" aria-label="Quotes" />
      ) : (
        <EmptyState message="No quotes yet. Create one from an opportunity." />
      )}
    </Stack>
  );
}
