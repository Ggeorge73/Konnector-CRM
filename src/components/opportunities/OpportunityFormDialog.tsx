"use client";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createOpportunityAction, updateOpportunityAction } from "@/app/actions/capture";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, NumberField, Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { OPP_KINDS, OPP_SOURCES, PROCUREMENT_VEHICLES, SERVICE_LINES, type Opportunity } from "@/lib/domain/types";
import { humanize } from "@/lib/format";
import type { OpportunityInputT } from "@/lib/services/capture";

export function OpportunityFormDialog({
  open,
  onClose,
  accounts,
  owners,
  canAssign,
  opportunity,
  defaultAccountId,
  onlyStaffing,
}: {
  open: boolean;
  onClose: () => void;
  accounts: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string }>;
  canAssign: boolean;
  opportunity?: Opportunity;
  defaultAccountId?: string;
  onlyStaffing?: boolean;
}) {
  const router = useRouter();
  const o = opportunity;
  const [v, setV] = useState<OpportunityInputT>({
    name: o?.name ?? "",
    account_id: o?.account_id ?? defaultAccountId ?? "",
    kind: o?.kind ?? (onlyStaffing ? "staffing_placement" : "public_bid"),
    value: o?.value ?? 0,
    currency: o?.currency ?? "USD",
    source: o?.source ?? "signal",
    service_lines: o?.service_lines ?? (onlyStaffing ? ["staffing"] : ["implementation"]),
    expected_close: o?.expected_close ?? null,
    pwin: o?.pwin ?? null,
    next_step: o?.next_step ?? "",
    next_step_due: o?.next_step_due ?? null,
    owner_id: o?.owner_id,
    shared_with: o?.shared_with ?? [],
    solicitation_no: o?.solicitation_no ?? "",
    agency_buyer: o?.agency_buyer ?? "",
    procurement_vehicle: o?.procurement_vehicle ?? "",
    naics: o?.naics ?? "",
    set_aside: o?.set_aside ?? "",
    questions_due: o?.questions_due ?? null,
    proposal_due: o?.proposal_due ?? null,
    submission_method: o?.submission_method ?? "",
    incumbent: o?.incumbent ?? "",
  });
  const set = <K extends keyof OpportunityInputT>(k: K, val: OpportunityInputT[K]) => setV((x) => ({ ...x, [k]: val }));
  const create = useAction(createOpportunityAction, {
    success: "Opportunity created",
    onSuccess: (r) => router.push(`/opportunities/${r.id}`),
  });
  const update = useAction(updateOpportunityAction, { success: "Opportunity updated", onSuccess: onClose });
  const act = o ? update : create;
  const e = act.fieldErrors;
  const isBid = v.kind === "public_bid";
  const lines = v.service_lines ?? [];

  return (
    <FormDialog
      open={open}
      title={o ? "Edit opportunity" : "New opportunity"}
      onClose={onClose}
      pending={act.pending}
      onSubmit={() => (o ? update.exec(o.id, v) : create.exec(v))}
      submitLabel={o ? "Save" : "Create opportunity"}
      maxWidth="md"
    >
      <Text label="Name" required value={v.name} onChange={(x) => set("name", x)} error={e.name} autoFocus />
      <Select
        label="Account"
        value={v.account_id}
        onChange={(x) => set("account_id", x)}
        options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        error={e.account_id}
        disabled={!!o}
      />
      <Select
        label="Kind"
        value={v.kind}
        onChange={(x) => set("kind", x)}
        options={onlyStaffing ? (["staffing_placement"] as const) : OPP_KINDS}
      />
      <NumberField label="Value (USD)" value={v.value as number} onChange={(x) => set("value", x ?? 0)} error={e.value} />
      <Select label="Source" value={v.source} onChange={(x) => set("source", x)} options={OPP_SOURCES} />
      <FormGroup>
        <FormLabel sx={{ fontSize: 12, mb: 1 }}>Service lines</FormLabel>
        <FormGroup row>
          {SERVICE_LINES.map((s) => (
            <FormControlLabel
              key={s}
              label={humanize(s)}
              control={
                <Checkbox
                  size="small"
                  checked={lines.includes(s)}
                  onChange={(ev) => set("service_lines", ev.target.checked ? [...lines, s] : lines.filter((x) => x !== s))}
                />
              }
            />
          ))}
        </FormGroup>
        {e.service_lines && <FormHelperText error>{e.service_lines}</FormHelperText>}
      </FormGroup>
      <DateField label="Expected close" value={v.expected_close} onChange={(x) => set("expected_close", x)} />
      <NumberField label="Pwin %" value={v.pwin as number | null} onChange={(x) => set("pwin", x)} />
      <Text label="Next step" value={v.next_step} onChange={(x) => set("next_step", x)} />
      <DateField label="Next step due" value={v.next_step_due} onChange={(x) => set("next_step_due", x)} />
      {canAssign && (
        <Select
          label="Owner"
          value={v.owner_id ?? ""}
          onChange={(x) => set("owner_id", x)}
          options={owners.map((u) => ({ value: u.id, label: u.name }))}
          allowEmpty="Me"
        />
      )}
      {isBid && (
        <>
          <Divider />
          <Typography variant="h6">Public bid</Typography>
          <Text
            label="Solicitation number"
            value={v.solicitation_no}
            onChange={(x) => set("solicitation_no", x)}
            slotProps={{ htmlInput: { style: { fontFamily: "var(--font-mono)" } } }}
          />
          <Text label="Agency buyer" value={v.agency_buyer} onChange={(x) => set("agency_buyer", x)} />
          <Select
            label="Procurement vehicle"
            value={v.procurement_vehicle ?? ""}
            onChange={(x) => set("procurement_vehicle", x)}
            options={PROCUREMENT_VEHICLES.map((p) => ({ value: p, label: p }))}
            allowEmpty="—"
          />
          <Text label="NAICS" value={v.naics} onChange={(x) => set("naics", x)} error={e.naics} placeholder="541512" />
          <Text label="Set-aside" value={v.set_aside} onChange={(x) => set("set_aside", x)} placeholder="None, SDVOSB, Small business…" />
          <DateField label="Questions due" value={v.questions_due} onChange={(x) => set("questions_due", x)} />
          <DateField label="Proposal due" value={v.proposal_due} onChange={(x) => set("proposal_due", x)} />
          <Text label="Submission method" value={v.submission_method} onChange={(x) => set("submission_method", x)} />
          <Text label="Incumbent" value={v.incumbent} onChange={(x) => set("incumbent", x)} />
        </>
      )}
    </FormDialog>
  );
}
