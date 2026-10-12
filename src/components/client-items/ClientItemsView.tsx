"use client";
import Add from "@mui/icons-material/Add";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { useState } from "react";
import { Countdown, DataTable, EmptyState, Money, StatTile, StatusChip } from "@/components/kit";
import type { ClientItem } from "@/lib/domain/types";
import { humanize } from "@/lib/format";
import { NewClientItemDialog, type HubAccount } from "./NewClientItemDialog";

type Row = ClientItem & { account_name: string; owner_name: string };

export function ClientItemsView({ rows, accounts }: { rows: Row[]; accounts: HubAccount[] }) {
  const [open, setOpen] = useState(false);
  const live = rows.filter((r) => r.status !== "superseded");
  const cols: GridColDef<Row>[] = [
    {
      field: "title",
      headerName: "Item",
      flex: 1.5,
      minWidth: 240,
      renderCell: (p) => (
        <Link href={`/client-items/${p.row.id}`} style={{ color: "inherit", fontWeight: 600 }}>
          {p.row.title}
        </Link>
      ),
    },
    { field: "type", headerName: "Type", width: 160, valueFormatter: (v: string) => humanize(v) },
    { field: "account_name", headerName: "Client", flex: 1, minWidth: 180 },
    { field: "version", headerName: "Ver.", width: 70, valueFormatter: (v: number) => `v${v}` },
    { field: "status", headerName: "Status", width: 160, renderCell: (p) => <StatusChip value={p.row.status} /> },
    {
      field: "amount",
      headerName: "Amount",
      type: "number",
      width: 130,
      renderCell: (p) => (p.row.amount === null ? "—" : <Money value={p.row.amount} />),
    },
    {
      field: "respond_by",
      headerName: "Respond by",
      width: 140,
      renderCell: (p) => (p.row.respond_by && ["published", "viewed"].includes(p.row.status) ? <Countdown date={p.row.respond_by} /> : "—"),
    },
    { field: "owner_name", headerName: "Owner", width: 140 },
  ];
  return (
    <Stack spacing={4}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h2" component="h1">
            Client items
          </Typography>
          <Typography color="text.secondary">
            Quotes, amendments, renewal offers and surveys published to the client&apos;s Konnect Hub portal. Clients have one door.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)} sx={{ alignSelf: "flex-start" }}>
          New client item
        </Button>
      </Stack>
      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
        <StatTile label="Awaiting client" value={live.filter((r) => r.status === "published" || r.status === "viewed").length} />
        <StatTile label="Changes requested" value={live.filter((r) => r.status === "changes_requested").length} />
        <StatTile label="Accepted" value={live.filter((r) => r.status === "accepted").length} />
        <StatTile label="Drafts" value={live.filter((r) => r.status === "draft").length} />
      </Box>
      {rows.length ? (
        <DataTable rows={live} columns={cols} exportName="client-items" aria-label="Client items" />
      ) : (
        <EmptyState message="Nothing has been shared with clients yet." />
      )}
      {open && <NewClientItemDialog open onClose={() => setOpen(false)} accounts={accounts} />}
    </Stack>
  );
}
