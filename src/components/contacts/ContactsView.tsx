"use client";
import Add from "@mui/icons-material/Add";
import ContentCopy from "@mui/icons-material/ContentCopyOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Select } from "@/components/common/fields";
import { DataTable, EmptyState } from "@/components/kit";
import { BUYING_ROLES, type AccountType, type Contact } from "@/lib/domain/types";
import { humanize } from "@/lib/format";
import { ContactFormDialog } from "./ContactFormDialog";

type Row = Contact & { account_name: string; account_type: AccountType; owner_name: string };

export function ContactsView({
  rows,
  accounts,
  duplicates,
}: {
  rows: Row[];
  accounts: Array<{ id: string; name: string }>;
  /** Likely duplicate pairs; only passed to leaders, who can open the Duplicates view. */
  duplicates?: number;
}) {
  const params = useSearchParams();
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [role, setRole] = useState("");
  const [account, setAccount] = useState("");
  const filtered = useMemo(
    () => rows.filter((r) => (!role || r.role_in_buying === role) && (!account || r.account_id === account)),
    [rows, role, account],
  );
  const cols: GridColDef<Row>[] = [
    {
      field: "name",
      headerName: "Name",
      flex: 1,
      minWidth: 180,
      valueGetter: (_v, r) => `${r.first_name} ${r.last_name}`,
      renderCell: (p) => (
        <Link href={`/contacts/${p.row.id}`} style={{ color: "inherit", fontWeight: 600 }}>
          {p.value as string}
        </Link>
      ),
    },
    { field: "title", headerName: "Title", flex: 1, minWidth: 180 },
    {
      field: "account_name",
      headerName: "Account",
      flex: 1.2,
      minWidth: 200,
      renderCell: (p) => (
        <Link href={`/accounts/${p.row.account_id}`} style={{ color: "inherit" }}>
          {p.row.account_name}
        </Link>
      ),
    },
    { field: "role_in_buying", headerName: "Buying role", width: 170, valueFormatter: (v: string | null) => humanize(v) },
    { field: "email", headerName: "Email", flex: 1, minWidth: 220 },
    { field: "phone", headerName: "Phone", width: 150 },
    { field: "owner_name", headerName: "Owner", width: 140 },
  ];
  return (
    <Stack spacing={4}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h2" component="h1">
            Contacts
          </Typography>
          <Typography color="text.secondary">Decision makers, procurement officers, evaluators and champions.</Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="flex-start" useFlexGap flexWrap="wrap">
          {duplicates !== undefined && (
            <Button variant="outlined" startIcon={<ContentCopy />} component={Link} href="/duplicates?tab=contacts">
              Duplicates ({duplicates})
            </Button>
          )}
          <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>
            New contact
          </Button>
        </Stack>
      </Stack>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "300px 300px" } }}>
        <Select
          label="Account"
          value={account}
          onChange={setAccount}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          allowEmpty="Any account"
        />
        <Select label="Buying role" value={role} onChange={setRole} options={BUYING_ROLES} allowEmpty="Any role" />
      </Box>
      {filtered.length ? (
        <DataTable rows={filtered} columns={cols} exportName="konnector-contacts" aria-label="Contacts" />
      ) : (
        <EmptyState message="No contacts match these filters." />
      )}
      {creating && <ContactFormDialog open onClose={() => setCreating(false)} accounts={accounts} />}
    </Stack>
  );
}
