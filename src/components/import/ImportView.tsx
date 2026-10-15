"use client";
import Download from "@mui/icons-material/FileDownloadOutlined";
import Upload from "@mui/icons-material/UploadFileOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { useState } from "react";
import { commitImportAction, previewImportAction } from "@/app/actions/imports";
import { IMPORT_UNDO_DAYS } from "@/lib/auth/permissions";
import { Select } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { DataTable, GlassCard, StatusChip, type Tone } from "@/components/kit";
import { STAGES, type ImportBatch, type ImportEntity, type Stage } from "@/lib/domain/types";
import { CsvError, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsvTable } from "@/lib/import/csv";
import { ENTITY_LABEL, IMPORT_FIELDS, isRestrictedHeader, suggestMapping, templateCsv, type ImportMapping } from "@/lib/import/fields";
import type { ImportBatchRow, ImportPreview, ImportRequestT, PreviewRow } from "@/lib/services/imports";
import { ImportBatches } from "./ImportBatches";

const STEPS = ["Upload", "Map columns", "Dry run", "Import", "Done"];
const STATUS_TONE: Record<PreviewRow["status"], Tone> = { create: "success", skip: "warning", error: "danger" };
const STATUS_LABEL: Record<PreviewRow["status"], string> = { create: "Create", skip: "Skip", error: "Error" };
const LIST_HREF: Record<ImportEntity, string> = { accounts: "/accounts", contacts: "/contacts", opportunities: "/opportunities" };

interface Props {
  entities: ImportEntity[];
  initialEntity: ImportEntity;
  batches: ImportBatchRow[];
  stages: Array<{ key: Stage; label: string }>;
  me: { id: string; name: string };
  /** Leaders may pick a fallback owner for unknown deal owners; null for everyone else. */
  owners: Array<{ id: string; name: string }> | null;
}

export function ImportView({ entities, initialEntity, batches, stages, me, owners }: Props) {
  const [step, setStep] = useState(0);
  const [entity, setEntity] = useState<ImportEntity>(initialEntity);
  const [file, setFile] = useState<{ name: string; csv: string; headers: string[]; rows: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [createMissing, setCreateMissing] = useState(false);
  const [fallbackOwner, setFallbackOwner] = useState(me.id);
  const [stageMap, setStageMap] = useState<Record<string, Stage>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<{ batch: ImportBatch; totals: ImportPreview["totals"] } | null>(null);

  const dry = useAction(previewImportAction, {
    onSuccess: (p) => {
      setPreview(p);
      setStep(2);
    },
  });
  const commit = useAction(commitImportAction, {
    success: "Import complete",
    onSuccess: (d) => {
      setDone(d);
      setStep(4);
    },
  });

  const request = (overrides: Partial<{ stage_map: Record<string, Stage> }> = {}): ImportRequestT => ({
    entity,
    csv: file?.csv ?? "",
    file_name: file?.name ?? "import.csv",
    mapping,
    options: {
      create_missing_accounts: createMissing,
      fallback_owner_id: entity === "opportunities" && owners ? fallbackOwner : null,
      stage_map: overrides.stage_map ?? stageMap,
    },
  });

  const reset = (next: ImportEntity = entity) => {
    setEntity(next);
    setFile(null);
    setFileError(null);
    setMapping({});
    setStageMap({});
    setPreview(null);
    setDone(null);
    setCreateMissing(false);
    setStep(0);
  };

  const onFile = async (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) return setFileError("The file is larger than 5 MB.");
    const csv = await f.text();
    try {
      const table = parseCsvTable(csv);
      if (table.rows.length === 0) return setFileError("The file has a header row but no data.");
      setFile({ name: f.name, csv, headers: table.headers, rows: table.rows.length });
      setMapping(suggestMapping(entity, table.headers));
      setStep(1);
    } catch (e) {
      setFileError(e instanceof CsvError ? e.message : "We couldn't read that file. Save it as CSV (UTF-8) and try again.");
    }
  };

  const ignored = file?.headers.filter(isRestrictedHeader) ?? [];
  const headerOptions = (file?.headers ?? []).filter((h) => !isRestrictedHeader(h)).map((h) => ({ value: h, label: h }));

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Import
        </Typography>
        <Typography color="text.secondary">
          Bring accounts, contacts and pipeline in from a spreadsheet. Every import starts with a dry run, and can be undone for{" "}
          {IMPORT_UNDO_DAYS} days.
        </Typography>
      </Box>

      <GlassCard>
        <Stepper activeStep={step} alternativeLabel sx={{ mb: 6 }} aria-label="Import steps">
          {STEPS.map((s) => (
            <Step key={s}>
              <StepLabel>{s}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {step === 0 && (
          <Stack spacing={4}>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                What are you importing?
              </Typography>
              <ToggleButtonGroup
                exclusive
                value={entity}
                onChange={(_e, v: ImportEntity | null) => v && reset(v)}
                aria-label="Record type"
                size="small"
              >
                {entities.map((e) => (
                  <ToggleButton key={e} value={e}>
                    {ENTITY_LABEL[e]}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
              <Button component="label" variant="contained" startIcon={<Upload />}>
                Choose CSV file
                <input
                  hidden
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="CSV file"
                  onChange={(e) => {
                    void onFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </Button>
              <Button
                variant="outlined"
                startIcon={<Download />}
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv(entity))}`}
                download={`konnector-${entity}-template.csv`}
              >
                Download {ENTITY_LABEL[entity].toLowerCase()} template
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              CSV with a header row, up to {MAX_IMPORT_ROWS.toLocaleString("en-US")} rows and 5 MB. Columns that look like cost, margin,
              score or quote data are never imported.
            </Typography>
            {fileError && <Alert severity="error">{fileError}</Alert>}
          </Stack>
        )}

        {step === 1 && file && (
          <Stack spacing={4}>
            <Typography>
              <strong>{file.name}</strong> · {file.rows.toLocaleString("en-US")} row{file.rows === 1 ? "" : "s"} · {file.headers.length}{" "}
              columns. We matched what we could; adjust anything that&apos;s wrong.
            </Typography>
            {ignored.length > 0 && (
              <Alert severity="warning">
                Ignored {ignored.length === 1 ? "1 column that looks" : `${ignored.length} columns that look`} like restricted commercial
                data: {ignored.join(", ")}. Cost, margin, bid scores and quotes are never imported.
              </Alert>
            )}
            <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", lg: "1fr 1fr 1fr" } }}>
              {IMPORT_FIELDS[entity].map((f) => (
                <Select
                  key={f.key}
                  label={`${f.label}${f.required ? " *" : ""}`}
                  value={mapping[f.key] ?? ""}
                  onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v || null }))}
                  options={headerOptions}
                  allowEmpty="— Don't import —"
                  helperText={f.hint}
                />
              ))}
            </Box>
            {entity !== "accounts" && (
              <FormControlLabel
                control={<Switch checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />}
                label="Create missing accounts (owned by you)"
              />
            )}
            {entity === "opportunities" && owners && (
              <Box sx={{ maxWidth: 360 }}>
                <Select
                  label="Owner for unknown or blank owner emails"
                  value={fallbackOwner}
                  onChange={setFallbackOwner}
                  options={owners.map((o) => ({ value: o.id, label: o.id === me.id ? `${o.name} (you)` : o.name }))}
                />
              </Box>
            )}
            {dry.error && <Alert severity="error">{dry.error}</Alert>}
            <Stack direction="row" spacing={2}>
              <Button onClick={() => reset()}>Start over</Button>
              <Button variant="contained" disabled={dry.pending} onClick={() => dry.exec(request())}>
                {dry.pending ? "Checking…" : "Preview (dry run)"}
              </Button>
            </Stack>
            {dry.pending && <LinearProgress aria-label="Running dry run" />}
          </Stack>
        )}

        {step === 2 && preview && (
          <PreviewStep
            preview={preview}
            stages={stages}
            stageMap={stageMap}
            pending={dry.pending}
            onStageMap={(next) => {
              setStageMap(next);
              void dry.exec(request({ stage_map: next }));
            }}
            onBack={() => setStep(1)}
            onImport={() => {
              setStep(3);
              void commit.exec(request()).then((r) => !r.ok && setStep(2));
            }}
          />
        )}

        {step === 3 && (
          <Stack spacing={3} role="status">
            <Typography>
              Importing {preview?.totals.create.toLocaleString("en-US")} {ENTITY_LABEL[entity].toLowerCase()} rows…
            </Typography>
            <LinearProgress aria-label="Importing" />
          </Stack>
        )}

        {step === 4 && done && (
          <Stack spacing={3}>
            <Alert severity="success">
              Imported {done.batch.created_count.toLocaleString("en-US")} record{done.batch.created_count === 1 ? "" : "s"} from{" "}
              {done.batch.file_name}
              {done.totals.skip ? ` · ${done.totals.skip} skipped` : ""}
              {done.totals.error ? ` · ${done.totals.error} with errors (not imported)` : ""}.
            </Alert>
            <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
              <Button variant="contained" component={Link} href={LIST_HREF[entity]}>
                View {ENTITY_LABEL[entity].toLowerCase()}
              </Button>
              <Button component={Link} href="#recent-imports">
                Undo this import
              </Button>
              <Button onClick={() => reset()}>Import another file</Button>
            </Stack>
          </Stack>
        )}
      </GlassCard>

      <ImportBatches batches={batches} />
    </Stack>
  );
}

function PreviewStep({
  preview,
  stages,
  stageMap,
  pending,
  onStageMap,
  onBack,
  onImport,
}: {
  preview: ImportPreview;
  stages: Array<{ key: Stage; label: string }>;
  stageMap: Record<string, Stage>;
  pending: boolean;
  onStageMap: (next: Record<string, Stage>) => void;
  onBack: () => void;
  onImport: () => void;
}) {
  const t = preview.totals;
  const rows = preview.rows.map((r) => ({ ...r, id: r.row }));
  const columns: GridColDef<(typeof rows)[number]>[] = [
    { field: "row", headerName: "Row", width: 70, type: "number" },
    {
      field: "status",
      headerName: "Result",
      width: 100,
      renderCell: (p) => <StatusChip label={STATUS_LABEL[p.row.status]} tone={STATUS_TONE[p.row.status]} />,
    },
    { field: "label", headerName: "Record", flex: 1, minWidth: 180 },
    {
      field: "account",
      headerName: "Account",
      flex: 1,
      minWidth: 180,
      renderCell: (p) =>
        p.row.account ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <span>{p.row.account}</span>
            {p.row.account_action === "create" && <StatusChip label="New" tone="accent" />}
          </Stack>
        ) : (
          "—"
        ),
    },
    {
      field: "reasons",
      headerName: "Details",
      flex: 2,
      minWidth: 260,
      sortable: false,
      valueGetter: (_v, r) => [...r.reasons, ...r.notes].join(" · "),
      renderCell: (p) => (
        <Typography
          variant="body2"
          color={p.row.status === "create" ? "text.secondary" : "text.primary"}
          sx={{ whiteSpace: "normal", py: 1 }}
        >
          {[...p.row.reasons, ...p.row.notes].join(" · ") || "—"}
        </Typography>
      ),
    },
  ];
  const stageLabel = Object.fromEntries(stages.map((s) => [s.key, s.label]));
  return (
    <Stack spacing={4}>
      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" aria-label="Dry run totals">
        <StatusChip tone="success" label={`${t.create} to create`} />
        <StatusChip tone="warning" label={`${t.skip} to skip`} />
        <StatusChip tone="danger" label={`${t.error} with errors`} />
        {preview.entity !== "accounts" && t.accounts_to_create > 0 && (
          <StatusChip tone="accent" label={`${t.accounts_to_create} new account${t.accounts_to_create === 1 ? "" : "s"}`} />
        )}
        <Typography variant="body2" color="text.secondary" sx={{ alignSelf: "center" }}>
          Dry run of {t.rows} rows: nothing has been written yet.
        </Typography>
      </Stack>
      {preview.warnings.map((w) => (
        <Alert key={w} severity="warning">
          {w}
        </Alert>
      ))}
      {preview.stage_values.length > 0 && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Stage mapping
          </Typography>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", lg: "1fr 1fr 1fr" } }}>
            {preview.stage_values.map((sv) => (
              <Select
                key={sv.key}
                label={`"${sv.raw}" (${sv.count})`}
                value={stageMap[sv.key] ?? sv.mapped ?? ""}
                onChange={(v) => onStageMap({ ...stageMap, [sv.key]: v as Stage })}
                options={STAGES.map((s) => ({ value: s, label: stageLabel[s] ?? s }))}
                allowEmpty={sv.mapped ? undefined : "— Unknown —"}
                disabled={pending}
                error={sv.mapped ? undefined : "Pick a stage"}
              />
            ))}
          </Box>
        </Box>
      )}
      {pending && <LinearProgress aria-label="Updating preview" />}
      <Box component="section" aria-label="Dry run preview">
        <DataTable rows={rows} columns={columns} getRowHeight={() => "auto"} exportName={`import-dry-run-${preview.entity}`} />
      </Box>
      <Stack direction="row" spacing={2}>
        <Button onClick={onBack}>Back to mapping</Button>
        <Button variant="contained" disabled={pending || t.create === 0} onClick={onImport}>
          Import {t.create} row{t.create === 1 ? "" : "s"}
        </Button>
      </Stack>
    </Stack>
  );
}
