"use client";
import Undo from "@mui/icons-material/Undo";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import type { GridColDef } from "@mui/x-data-grid";
import { useState } from "react";
import { undoImportAction } from "@/app/actions/imports";
import { FormDialog } from "@/components/common/FormDialog";
import { useAction } from "@/components/common/useAction";
import { DataTable, EmptyState, GlassCard, RelTime, StatusChip } from "@/components/kit";
import { ENTITY_LABEL } from "@/lib/import/fields";
import type { ImportBatchRow } from "@/lib/services/imports";

/** Recent import batches with Undo (importer or a leader, within 7 days, if nothing was edited since). */
export function ImportBatches({ batches }: { batches: ImportBatchRow[] }) {
  const [confirm, setConfirm] = useState<ImportBatchRow | null>(null);
  const undo = useAction(undoImportAction, { success: "Import undone", onSuccess: () => setConfirm(null) });

  const columns: GridColDef<ImportBatchRow>[] = [
    { field: "created_at", headerName: "When", width: 140, renderCell: (p) => <RelTime value={p.row.created_at} /> },
    { field: "entity", headerName: "Type", width: 110, valueFormatter: (v: ImportBatchRow["entity"]) => ENTITY_LABEL[v] },
    { field: "file_name", headerName: "File", flex: 1, minWidth: 160 },
    { field: "user_name", headerName: "By", width: 150 },
    { field: "created_count", headerName: "Created", type: "number", width: 90 },
    { field: "skipped_count", headerName: "Skipped", type: "number", width: 90 },
    { field: "error_count", headerName: "Errors", type: "number", width: 80 },
    {
      field: "status",
      headerName: "Status",
      width: 120,
      renderCell: (p) => (
        <StatusChip label={p.row.status === "undone" ? "Undone" : "Imported"} tone={p.row.status === "undone" ? "neutral" : "success"} />
      ),
    },
    {
      field: "actions",
      headerName: "",
      width: 110,
      sortable: false,
      filterable: false,
      renderCell: (p) =>
        p.row.can_undo ? (
          <Button size="small" startIcon={<Undo />} onClick={() => setConfirm(p.row)} aria-label={`Undo import ${p.row.file_name}`}>
            Undo
          </Button>
        ) : null,
    },
  ];

  return (
    <GlassCard
      title="Recent imports"
      subtitle="Undo archives exactly the records an import created."
      id="recent-imports"
      aria-label="Recent imports"
    >
      {batches.length === 0 ? (
        <EmptyState message="No imports yet. Your imports will show up here." />
      ) : (
        <DataTable rows={batches} columns={columns} exportName="konnector-imports" aria-label="Recent imports" />
      )}
      <FormDialog
        open={!!confirm}
        title="Undo this import?"
        subtitle={
          confirm
            ? `Archives the ${confirm.created_count} record${confirm.created_count === 1 ? "" : "s"} created from ${confirm.file_name}. ` +
              "Refused if any of them was edited since."
            : undefined
        }
        onClose={() => setConfirm(null)}
        onSubmit={() => confirm && undo.exec(confirm.id)}
        submitLabel="Undo import"
        pending={undo.pending}
        danger
      >
        {undo.error ? <Alert severity="error">{undo.error}</Alert> : <span />}
      </FormDialog>
    </GlassCard>
  );
}
