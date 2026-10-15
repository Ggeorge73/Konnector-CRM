"use client";
import Add from "@mui/icons-material/Add";
import BookmarkAdd from "@mui/icons-material/BookmarkAddOutlined";
import ContentCopy from "@mui/icons-material/ContentCopyOutlined";
import Upload from "@mui/icons-material/UploadFileOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { bulkAccountsAction, deleteViewAction, saveViewAction } from "@/app/actions/core";
import { FormDialog } from "@/components/common/FormDialog";
import { Select } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { DataTable, EmptyState, StatusChip } from "@/components/kit";
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, type Account } from "@/lib/domain/types";
import { humanize, money } from "@/lib/format";
import { AccountFormDialog } from "./AccountFormDialog";

export type AccountRow = Account & { owner_name: string; open_value: number; open_count: number };

const SEGMENTS: Record<string, (a: Account) => boolean> = {
  government: (a) => a.type.startsWith("government"),
  private: (a) => a.type === "private",
  partners: (a) => a.type === "partner_subcontractor" || a.type === "oem_vendor",
};

export function AccountsView({
  rows,
  views,
  owners,
  canBulk,
  canCreate,
  duplicates,
}: {
  rows: AccountRow[];
  views: Array<{ id: string; name: string; query: Record<string, string>; mine: boolean }>;
  owners: Array<{ id: string; name: string }>;
  canBulk: boolean;
  canCreate: boolean;
  /** Likely duplicate pairs; only passed to leaders, who can open the Duplicates view. */
  duplicates?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const [selection, setSelection] = useState<GridRowSelectionModel>([]);
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [saving, setSaving] = useState(false);
  const [viewName, setViewName] = useState("");
  const [shareView, setShareView] = useState(true);
  const [bulk, setBulk] = useState<{ owner_id?: string; tier?: Account["tier"] }>({});

  const filtered = useMemo(
    () =>
      rows.filter(
        (a) =>
          (!query.segment || SEGMENTS[query.segment]?.(a)) &&
          (!query.status || a.status === query.status) &&
          (!query.type || a.type === query.type) &&
          (!query.tier || a.tier === query.tier) &&
          (!query.owner || a.owner_id === query.owner),
      ),
    [rows, query.segment, query.status, query.type, query.tier, query.owner],
  );

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("new");
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  };
  const activeFilters = Object.fromEntries(Object.entries(query).filter(([k, v]) => k !== "new" && v));

  const save = useAction(saveViewAction, { success: "View saved", onSuccess: () => setSaving(false) });
  const del = useAction(deleteViewAction, { success: "View deleted" });
  const bulkRun = useAction(bulkAccountsAction, { success: "Accounts updated", onSuccess: () => setSelection([]) });

  const columns: GridColDef<AccountRow>[] = [
    {
      field: "name",
      headerName: "Account",
      flex: 1.6,
      minWidth: 220,
      renderCell: (p) => (
        <Link href={`/accounts/${p.row.id}`} style={{ fontWeight: 600, color: "inherit" }}>
          {p.row.name}
        </Link>
      ),
    },
    { field: "type", headerName: "Type", width: 170, valueFormatter: (v: string) => humanize(v) },
    { field: "status", headerName: "Status", width: 130, renderCell: (p) => <StatusChip value={p.row.status} /> },
    { field: "tier", headerName: "Tier", width: 70 },
    {
      field: "city",
      headerName: "Location",
      width: 150,
      valueGetter: (_v, r) => [r.city, r.state_region ?? r.country].filter(Boolean).join(", "),
    },
    { field: "owner_name", headerName: "Owner", width: 150 },
    { field: "open_count", headerName: "Open deals", type: "number", width: 100 },
    {
      field: "open_value",
      headerName: "Open pipeline",
      type: "number",
      width: 140,
      cellClassName: "mono",
      valueFormatter: (v: number) => money(v),
    },
  ];

  return (
    <Stack spacing={4}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h2" component="h1">
            Accounts
          </Typography>
          <Typography color="text.secondary">Every organisation Konnector deals with — agencies, companies, partners and OEMs.</Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="flex-start" useFlexGap flexWrap="wrap">
          {duplicates !== undefined && (
            <Button variant="outlined" startIcon={<ContentCopy />} component={Link} href="/duplicates?tab=accounts">
              Duplicates ({duplicates})
            </Button>
          )}
          {canCreate && (
            <Button variant="outlined" startIcon={<Upload />} component={Link} href="/import?type=accounts">
              Import CSV
            </Button>
          )}
          {canCreate && (
            <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>
              New account
            </Button>
          )}
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center" aria-label="Saved views">
        <Chip
          label="All accounts"
          color={Object.keys(activeFilters).length === 0 ? "primary" : "default"}
          onClick={() => router.replace(pathname)}
        />
        {views.map((v) => {
          const active = JSON.stringify(v.query) === JSON.stringify(activeFilters);
          return (
            <Chip
              key={v.id}
              label={v.name}
              color={active ? "primary" : "default"}
              onClick={() => router.replace(`${pathname}?${new URLSearchParams(v.query).toString()}`)}
              onDelete={v.mine ? () => del.exec(v.id, "accounts") : undefined}
            />
          );
        })}
        {Object.keys(activeFilters).length > 0 && (
          <Chip icon={<BookmarkAdd />} variant="outlined" label="Save view" onClick={() => setSaving(true)} />
        )}
      </Stack>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(5, 1fr)" } }}>
        <Select
          label="Segment"
          value={query.segment ?? ""}
          onChange={(v) => setFilter("segment", v)}
          options={["government", "private", "partners"] as const}
          allowEmpty="Any segment"
        />
        <Select
          label="Type"
          value={query.type ?? ""}
          onChange={(v) => setFilter("type", v)}
          options={ACCOUNT_TYPES}
          allowEmpty="Any type"
        />
        <Select
          label="Status"
          value={query.status ?? ""}
          onChange={(v) => setFilter("status", v)}
          options={ACCOUNT_STATUSES}
          allowEmpty="Any status"
        />
        <Select
          label="Tier"
          value={query.tier ?? ""}
          onChange={(v) => setFilter("tier", v)}
          options={["A", "B", "C"] as const}
          allowEmpty="Any tier"
        />
        <Select
          label="Owner"
          value={query.owner ?? ""}
          onChange={(v) => setFilter("owner", v)}
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
          allowEmpty="Anyone"
        />
      </Box>

      {canBulk && selection.length > 0 && (
        <Alert
          severity="info"
          icon={false}
          action={
            <Stack direction="row" spacing={2} alignItems="center">
              <Box sx={{ width: 180 }}>
                <Select
                  label="Reassign to"
                  value={bulk.owner_id ?? ""}
                  onChange={(v) => setBulk((b) => ({ ...b, owner_id: v }))}
                  options={owners.map((o) => ({ value: o.id, label: o.name }))}
                  allowEmpty="—"
                />
              </Box>
              <Box sx={{ width: 110 }}>
                <Select
                  label="Tier"
                  value={bulk.tier ?? ""}
                  onChange={(v) => setBulk((b) => ({ ...b, tier: v as Account["tier"] }))}
                  options={["A", "B", "C"] as const}
                  allowEmpty="—"
                />
              </Box>
              <Button
                size="small"
                variant="contained"
                disabled={bulkRun.pending || (!bulk.owner_id && !bulk.tier)}
                onClick={() => bulkRun.exec(selection as string[], { owner_id: bulk.owner_id || undefined, tier: bulk.tier || undefined })}
              >
                Apply
              </Button>
              <Button
                size="small"
                color="error"
                disabled={bulkRun.pending}
                onClick={() => bulkRun.exec(selection as string[], { archive: true })}
              >
                Archive
              </Button>
            </Stack>
          }
        >
          {selection.length} selected
        </Alert>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          message="No accounts match these filters."
          action={<Button onClick={() => router.replace(pathname)}>Clear filters</Button>}
        />
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          exportName="konnector-accounts"
          checkboxSelection={canBulk}
          rowSelectionModel={selection}
          onRowSelectionModelChange={setSelection}
          aria-label="Accounts"
        />
      )}

      <AccountFormDialog open={creating} onClose={() => setCreating(false)} owners={owners} canAssign={canBulk} />

      <FormDialog
        open={saving}
        title="Save view"
        onClose={() => setSaving(false)}
        onSubmit={() => save.exec("accounts", viewName, activeFilters, shareView)}
        pending={save.pending}
      >
        <TextField
          size="small"
          label="View name"
          value={viewName}
          onChange={(e) => setViewName(e.target.value)}
          error={!!save.fieldErrors.name}
          helperText={save.fieldErrors.name}
          autoFocus
        />
        <FormControlLabel
          control={<Switch checked={shareView} onChange={(e) => setShareView(e.target.checked)} />}
          label="Share with the team"
        />
      </FormDialog>
    </Stack>
  );
}
