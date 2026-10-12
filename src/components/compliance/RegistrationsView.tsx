"use client";
import Add from "@mui/icons-material/Add";
import EventBusy from "@mui/icons-material/EventBusyOutlined";
import NotificationsActive from "@mui/icons-material/NotificationsActiveOutlined";
import Schedule from "@mui/icons-material/ScheduleOutlined";
import Verified from "@mui/icons-material/VerifiedOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import { useState } from "react";
import { runRemindersAction, saveRegistrationAction } from "@/app/actions/compliance";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { Countdown, DataTable, EmptyState, GlassCard, StatTile } from "@/components/kit";
import { dateLabel } from "@/lib/format";
import type { RegistrationInputT } from "@/lib/services/capture";
import type { RegistrationRow } from "@/lib/services/compliance";
import { KIND_LABEL, REGISTRATION_KINDS, RegistrationStatusChip, useDesktop } from "./shared";

export function RegistrationsView({
  rows,
  counts,
  canManage,
}: {
  rows: RegistrationRow[];
  counts: { current: number; expiring: number; expired: number };
  canManage: boolean;
}) {
  const desktop = useDesktop();
  const [editing, setEditing] = useState<RegistrationRow | "new" | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const reminders = useAction(runRemindersAction, { onSuccess: (d) => setSent(d.sent) });

  const columns: GridColDef<RegistrationRow>[] = [
    {
      field: "name",
      headerName: "Registration",
      flex: 1.5,
      minWidth: 220,
      renderCell: (p) => (
        <Typography variant="body2" fontWeight={600} noWrap>
          {p.row.name}
        </Typography>
      ),
    },
    { field: "kind", headerName: "Kind", width: 140, valueFormatter: (v: RegistrationRow["kind"]) => KIND_LABEL[v] },
    { field: "identifier", headerName: "Identifier", width: 160, cellClassName: "mono", valueFormatter: (v: string | null) => v ?? "—" },
    { field: "issuer", headerName: "Issuer", flex: 1, minWidth: 170, valueFormatter: (v: string | null) => v ?? "—" },
    {
      field: "expires_on",
      headerName: "Expires",
      width: 210,
      valueFormatter: (v: string | null) => dateLabel(v),
      renderCell: (p) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <span>{dateLabel(p.row.expires_on)}</span>
          <Countdown date={p.row.expires_on} />
        </Stack>
      ),
    },
    {
      field: "status",
      headerName: "Status",
      width: 140,
      valueFormatter: (v: string) => v,
      renderCell: (p) => <RegistrationStatusChip status={p.row.status} />,
    },
    ...(canManage
      ? [
          {
            field: "actions",
            headerName: "",
            width: 90,
            sortable: false,
            filterable: false,
            disableExport: true,
            renderCell: (p) => (
              <Button size="small" onClick={() => setEditing(p.row)} aria-label={`Edit ${p.row.name}`}>
                Edit
              </Button>
            ),
          } satisfies GridColDef<RegistrationRow>,
        ]
      : []),
  ];

  return (
    <Stack spacing={4}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h2" component="h1">
            Registrations
          </Typography>
          <Typography color="text.secondary">
            Konnector&apos;s own registrations, certifications and insurance — kept current so we can always bid.
          </Typography>
        </Box>
        {canManage && (
          <Stack direction="row" spacing={2} alignItems="flex-start" useFlexGap flexWrap="wrap">
            <Button variant="outlined" startIcon={<NotificationsActive />} disabled={reminders.pending} onClick={() => reminders.exec()}>
              {reminders.pending ? "Sending…" : "Run reminders now"}
            </Button>
            <Button variant="contained" startIcon={<Add />} onClick={() => setEditing("new")}>
              New registration
            </Button>
          </Stack>
        )}
      </Stack>

      {sent !== null && (
        <Alert severity={sent ? "success" : "info"} onClose={() => setSent(null)}>
          {sent
            ? `Sent ${sent} reminder${sent === 1 ? "" : "s"} for expiring registrations and vetting reviews.`
            : "No new reminders — everyone has already been notified today."}
        </Alert>
      )}

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}>
        <StatTile label="Current" value={counts.current} icon={<Verified fontSize="small" />} />
        <StatTile label="Expiring within 30 days" value={counts.expiring} icon={<Schedule fontSize="small" />} />
        <StatTile label="Expired" value={counts.expired} icon={<EventBusy fontSize="small" />} />
      </Box>

      {rows.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={<Verified />}
            message="No registrations recorded yet."
            action={
              canManage ? (
                <Button variant="contained" onClick={() => setEditing("new")}>
                  Add the first registration
                </Button>
              ) : undefined
            }
          />
        </GlassCard>
      ) : desktop ? (
        <DataTable rows={rows} columns={columns} exportName="konnector-registrations" aria-label="Registrations" />
      ) : (
        <Stack spacing={3} component="ul" sx={{ listStyle: "none", p: 0, m: 0 }} aria-label="Registrations">
          {rows.map((r) => (
            <GlassCard key={r.id} component="li" sx={{ p: 4 }}>
              <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="flex-start">
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={700}>{r.name}</Typography>
                  <Typography variant="caption" component="p">
                    {KIND_LABEL[r.kind]} · {r.issuer ?? "—"}
                  </Typography>
                </Box>
                <RegistrationStatusChip status={r.status} />
              </Stack>
              {r.identifier && (
                <Typography variant="mono" component="p" sx={{ mt: 2 }}>
                  {r.identifier}
                </Typography>
              )}
              <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" sx={{ mt: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    {r.expires_on ? `Expires ${dateLabel(r.expires_on)}` : "No expiry"}
                  </Typography>
                  <Countdown date={r.expires_on} />
                </Stack>
                {canManage && (
                  <Button size="small" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>
                    Edit
                  </Button>
                )}
              </Stack>
            </GlassCard>
          ))}
        </Stack>
      )}

      {!canManage && (
        <Typography variant="caption" color="text.secondary">
          Read-only — executives and admins maintain registrations.
        </Typography>
      )}

      {editing && (
        <RegistrationDialog
          key={editing === "new" ? "new" : editing.id}
          registration={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}

function RegistrationDialog({ registration, onClose }: { registration?: RegistrationRow; onClose: () => void }) {
  const [v, setV] = useState<RegistrationInputT>(
    registration
      ? {
          kind: registration.kind,
          name: registration.name,
          identifier: registration.identifier ?? "",
          issuer: registration.issuer ?? "",
          issued_on: registration.issued_on,
          expires_on: registration.expires_on,
          notes: registration.notes ?? "",
        }
      : { kind: "certification", name: "", identifier: "", issuer: "", issued_on: null, expires_on: null, notes: "" },
  );
  const set = <K extends keyof RegistrationInputT>(k: K, val: RegistrationInputT[K]) => setV((x) => ({ ...x, [k]: val }));
  const save = useAction(saveRegistrationAction, {
    success: registration ? "Registration updated" : "Registration added",
    onSuccess: onClose,
  });
  const e = save.fieldErrors;
  return (
    <FormDialog
      open
      title={registration ? "Edit registration" : "New registration"}
      onClose={onClose}
      onSubmit={() => save.exec(v, registration?.id)}
      pending={save.pending}
      submitLabel={registration ? "Save" : "Add registration"}
    >
      <Select
        label="Kind"
        value={v.kind}
        onChange={(x) => set("kind", x)}
        options={REGISTRATION_KINDS}
        labels={KIND_LABEL}
        error={e.kind}
      />
      <Text label="Name" required value={v.name} onChange={(x) => set("name", x)} error={e.name} autoFocus />
      <Text
        label="Identifier"
        value={v.identifier}
        onChange={(x) => set("identifier", x)}
        error={e.identifier}
        placeholder="UEI, CAGE, certificate or policy number"
        slotProps={{ htmlInput: { style: { fontFamily: "var(--font-mono), monospace" } } }}
      />
      <Text label="Issuer" value={v.issuer} onChange={(x) => set("issuer", x)} error={e.issuer} />
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        <DateField label="Issued on" value={v.issued_on} onChange={(x) => set("issued_on", x)} error={e.issued_on} />
        <DateField label="Expires on" value={v.expires_on} onChange={(x) => set("expires_on", x)} error={e.expires_on} />
      </Box>
      <Text label="Notes" multiline minRows={2} value={v.notes} onChange={(x) => set("notes", x)} error={e.notes} />
    </FormDialog>
  );
}
