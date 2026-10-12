"use client";
import Add from "@mui/icons-material/Add";
import Delete from "@mui/icons-material/DeleteOutline";
import RocketLaunch from "@mui/icons-material/RocketLaunch";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { retryHandoffAction, startHandoffAction } from "@/app/actions/handoff";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, NumberField, Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { EmptyState, GlassCard, HealthRing, Money, RelTime, StatusChip } from "@/components/kit";
import type { Handoff, ProjectHealth } from "@/lib/domain/types";
import { dateLabel } from "@/lib/format";

export interface HandoffContext {
  opportunityId: string;
  opportunityName: string;
  value: number;
  currency: string;
  won: boolean;
  canHandoff: boolean;
  contacts: Array<{ id: string; name: string; email: string | null; title: string | null }>;
  leads: Array<{ id: string; name: string }>;
  files: Array<{ id: string; name: string }>;
  handoff: Handoff | null;
  health: ProjectHealth | null;
}

const STEPS = ["Contract", "People", "Scope & acceptance", "Documents & review"];

export function HandoffWizard({ ctx, open, onClose }: { ctx: HandoffContext; open: boolean; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState(0);
  const [contractNo, setContractNo] = useState("");
  const [value, setValue] = useState<number | null>(ctx.value);
  const [start, setStart] = useState<string | null>(today);
  const [end, setEnd] = useState<string | null>(null);
  const [lead, setLead] = useState(ctx.leads[0]?.id ?? "");
  const [invites, setInvites] = useState<Record<string, "client_admin" | "client_approver" | "client_member" | "">>({});
  const [scope, setScope] = useState("");
  const [criteria, setCriteria] = useState<string[]>([""]);
  const [docs, setDocs] = useState<string[]>([]);
  const go = useAction(startHandoffAction, { onSuccess: (h) => (h.status === "acknowledged" ? onClose() : undefined) });
  const chosen = Object.entries(invites).filter(([, r]) => r) as Array<[string, "client_admin" | "client_approver" | "client_member"]>;
  const canNext = [
    !!contractNo && !!value && !!start && !!end,
    !!lead && chosen.length > 0,
    scope.trim().length >= 10 && criteria.some((c) => c.trim().length >= 3),
    true,
  ][step];

  return (
    <FormDialog
      open={open}
      title="Hand off to Konnect Hub"
      subtitle={`${ctx.opportunityName} — creates the project in Konnect Hub and invites the client.`}
      onClose={onClose}
      maxWidth="md"
      pending={go.pending}
      submitLabel={step < 3 ? "Next" : "Send handoff"}
      onSubmit={() => {
        if (step < 3) {
          if (canNext) setStep(step + 1);
          return;
        }
        void go.exec(ctx.opportunityId, {
          contract_no: contractNo,
          contract_value: value ?? 0,
          start_date: start ?? "",
          end_date: end ?? "",
          delivery_lead_id: lead,
          client_contacts: chosen.map(([contact_id, role]) => ({ contact_id, role })),
          scope_summary: scope,
          acceptance_criteria: criteria.filter((c) => c.trim()),
          document_file_ids: docs,
        });
      }}
    >
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 2 }}>
        {STEPS.map((s) => (
          <Step key={s}>
            <StepLabel>{s}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {go.error && <Alert severity="error">{go.error}</Alert>}
      {step === 0 && (
        <>
          <Text label="Contract number" value={contractNo} onChange={setContractNo} required autoFocus error={go.fieldErrors.contract_no} />
          <NumberField label={`Contract value (${ctx.currency})`} value={value} onChange={setValue} required />
          <DateField label="Start date" value={start} onChange={setStart} required />
          <DateField label="End date" value={end} onChange={setEnd} required error={go.fieldErrors.end_date} />
        </>
      )}
      {step === 1 && (
        <>
          <Select label="Delivery lead" value={lead} onChange={setLead} options={ctx.leads.map((l) => ({ value: l.id, label: l.name }))} />
          <Typography variant="subtitle2">Client contacts to invite to the Konnect Hub portal</Typography>
          {ctx.contacts.length === 0 && <Alert severity="warning">Add contacts on the account first.</Alert>}
          {ctx.contacts.map((c) => (
            <Stack key={c.id} direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
              <FormControlLabel
                sx={{ flex: 1 }}
                control={
                  <Checkbox
                    checked={!!invites[c.id]}
                    disabled={!c.email}
                    onChange={(e) => setInvites((m) => ({ ...m, [c.id]: e.target.checked ? "client_member" : "" }))}
                  />
                }
                label={`${c.name}${c.title ? ` · ${c.title}` : ""}${c.email ? "" : " (no email)"}`}
              />
              {invites[c.id] && (
                <TextField
                  select
                  size="small"
                  value={invites[c.id]}
                  onChange={(e) => setInvites((m) => ({ ...m, [c.id]: e.target.value as never }))}
                  sx={{ width: 200 }}
                  slotProps={{ htmlInput: { "aria-label": `Portal role for ${c.name}` } }}
                >
                  <MenuItem value="client_admin">Client admin</MenuItem>
                  <MenuItem value="client_approver">Approver</MenuItem>
                  <MenuItem value="client_member">Member</MenuItem>
                </TextField>
              )}
            </Stack>
          ))}
        </>
      )}
      {step === 2 && (
        <>
          <Text label="Scope summary" value={scope} onChange={setScope} multiline minRows={3} required autoFocus />
          <Typography variant="subtitle2">Acceptance criteria headlines</Typography>
          {criteria.map((c, i) => (
            <Stack key={i} direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                value={c}
                onChange={(e) => setCriteria((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))}
                slotProps={{ htmlInput: { "aria-label": `Acceptance criterion ${i + 1}` } }}
              />
              <IconButton
                aria-label={`Remove criterion ${i + 1}`}
                disabled={criteria.length === 1}
                onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))}
              >
                <Delete fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Button startIcon={<Add />} onClick={() => setCriteria((cs) => [...cs, ""])} sx={{ alignSelf: "flex-start" }}>
            Add criterion
          </Button>
        </>
      )}
      {step === 3 && (
        <>
          <Typography variant="subtitle2">Key documents (shared as 7-day signed links)</Typography>
          {ctx.files.length === 0 && (
            <Typography color="text.secondary">No files on this opportunity. Upload them in the Files tab to include them.</Typography>
          )}
          {ctx.files.map((f) => (
            <FormControlLabel
              key={f.id}
              control={
                <Checkbox
                  checked={docs.includes(f.id)}
                  onChange={(e) => setDocs((d) => (e.target.checked ? [...d, f.id] : d.filter((x) => x !== f.id)))}
                />
              }
              label={f.name}
            />
          ))}
          <Alert severity="info">
            Sending {contractNo} for <Money value={value} currency={ctx.currency} /> ({dateLabel(start)} – {dateLabel(end)}) with{" "}
            {chosen.length} client invite{chosen.length === 1 ? "" : "s"}. Only client-facing data is sent — no costs, margins or bid
            scores.
          </Alert>
        </>
      )}
      {step > 0 && (
        <Button onClick={() => setStep(step - 1)} sx={{ alignSelf: "flex-start" }}>
          Back
        </Button>
      )}
    </FormDialog>
  );
}

export function HandoffPanel({ ctx, autoOpen }: { ctx: HandoffContext; autoOpen?: boolean }) {
  const h = ctx.handoff;
  const [open, setOpen] = useState(!!autoOpen && ctx.won && ctx.canHandoff && h?.status !== "acknowledged");
  const retry = useAction(retryHandoffAction, { success: "Retry sent" });
  return (
    <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" } }}>
      <GlassCard title="Handoff to Konnect Hub" subtitle="Signed, versioned and idempotent — retried automatically with backoff">
        {!h ? (
          <EmptyState
            icon={<RocketLaunch />}
            message={
              ctx.won
                ? "This deal is won. Hand it off to create the project in Konnect Hub."
                : "The handoff unlocks when the opportunity is Won."
            }
            action={
              ctx.won && ctx.canHandoff ? (
                <Button variant="contained" onClick={() => setOpen(true)}>
                  Start handoff
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Stack spacing={3}>
            <Stack direction="row" spacing={2} alignItems="center">
              <StatusChip value={h.status} />
              <Typography variant="body2">
                {h.attempts} attempt{h.attempts === 1 ? "" : "s"} · payload v{h.payload_version} · updated <RelTime value={h.updated_at} />
              </Typography>
            </Stack>
            {h.konnect_hub_project_id && (
              <Typography>
                Project{" "}
                <Typography component="span" variant="mono">
                  {h.konnect_hub_project_id}
                </Typography>
                {h.konnect_hub_url && (
                  <>
                    {" · "}
                    <a href={h.konnect_hub_url} target="_blank" rel="noopener">
                      Open in Konnect Hub
                    </a>
                  </>
                )}
              </Typography>
            )}
            {h.last_error && (
              <Alert severity={h.status === "failed" ? "error" : "warning"}>
                {h.last_error}
                {h.next_attempt_at && (
                  <>
                    {" "}
                    · next automatic retry <RelTime value={h.next_attempt_at} />
                  </>
                )}
              </Alert>
            )}
            {ctx.canHandoff && (h.status === "failed" || h.status === "sent" || h.status === "pending") && (
              <Stack direction="row" spacing={2}>
                <Button variant="contained" disabled={retry.pending} onClick={() => retry.exec(h.id, ctx.opportunityId)}>
                  Retry now
                </Button>
                <Button onClick={() => setOpen(true)}>Edit and resend</Button>
              </Stack>
            )}
          </Stack>
        )}
      </GlassCard>
      <GlassCard title="Delivery health" subtitle="Read-only from Konnect Hub">
        {ctx.health ? (
          <HealthRing
            schedule={ctx.health.health_schedule}
            budget={ctx.health.health_budget}
            acceptance={ctx.health.health_acceptance}
            percentComplete={ctx.health.percent_complete}
            updatedAt={ctx.health.hub_updated_at}
            hubUrl={h?.konnect_hub_url}
          />
        ) : (
          <EmptyState
            message={
              h?.status === "acknowledged" ? "Waiting for the first health update from Konnect Hub." : "Health appears after the handoff."
            }
          />
        )}
      </GlassCard>
      {open && <HandoffWizard ctx={ctx} open onClose={() => setOpen(false)} />}
    </Box>
  );
}
