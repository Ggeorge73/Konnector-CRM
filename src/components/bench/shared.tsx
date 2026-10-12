"use client";
import EventAvailable from "@mui/icons-material/EventAvailableOutlined";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveConsultantAction } from "@/app/actions/bench";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, NumberField, Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { StatusChip } from "@/components/kit";
import { daysUntil, dateLabel } from "@/lib/format";
import type { ConsultantInputT, ConsultantView } from "@/lib/services/bench";

export const CONSULTANT_STATUS_OPTIONS = ["available", "partial", "allocated", "inactive"] as const;

export function useDesktop() {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.up("md"), { defaultMatches: true });
}

/** "Available now" or "Free in Nd" (with the date as a tooltip). */
export function AvailabilityChip({ from }: { from: string | null }) {
  const days = daysUntil(from);
  if (days === null || days <= 0)
    return <StatusChip tone="success" icon={<EventAvailable sx={{ fontSize: 14 }} />} label="Available now" />;
  return (
    <StatusChip
      tone={days <= 30 ? "accent" : "neutral"}
      icon={<EventAvailable sx={{ fontSize: 14 }} />}
      label={`Free in ${days}d`}
      title={`Available from ${dateLabel(from)}`}
    />
  );
}

export function SkillChips({ skills, max, highlight = [] }: { skills: string[]; max?: number; highlight?: string[] }) {
  const shown = max ? skills.slice(0, max) : skills;
  const rest = skills.length - shown.length;
  const hl = highlight.map((h) => h.toLowerCase());
  const isHl = (s: string) => hl.includes(s.toLowerCase());
  return (
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ minWidth: 0 }}>
      {shown.map((s) => (
        <Chip key={s} size="small" label={s} variant={isHl(s) ? "filled" : "outlined"} color={isHl(s) ? "primary" : "default"} />
      ))}
      {rest > 0 && <Chip size="small" variant="outlined" label={`+${rest}`} title={skills.slice(shown.length).join(", ")} />}
    </Stack>
  );
}

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

type FormState = Omit<ConsultantInputT, "skills" | "certifications"> & { skills: string; certifications: string };

export function ConsultantFormDialog({ consultant, onClose }: { consultant?: ConsultantView; onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<FormState>(
    consultant
      ? {
          full_name: consultant.full_name,
          title: consultant.title,
          email: consultant.email ?? "",
          skills: consultant.skills.join(", "),
          certifications: consultant.certifications.join(", "),
          rate_cost: consultant.rate_cost,
          rate_bill: consultant.rate_bill,
          currency: consultant.currency,
          availability_from: consultant.availability_from,
          location: consultant.location,
          clearance: consultant.clearance ?? "",
          status: consultant.status,
        }
      : {
          full_name: "",
          title: "",
          email: "",
          skills: "",
          certifications: "",
          rate_cost: null,
          rate_bill: 0,
          currency: "USD",
          availability_from: null,
          location: "Atlanta, GA",
          clearance: "",
          status: "available",
        },
  );
  const set = <K extends keyof FormState>(k: K, val: FormState[K]) => setV((x) => ({ ...x, [k]: val }));
  const save = useAction(saveConsultantAction, {
    success: consultant ? "Consultant updated" : "Consultant added to the bench",
    onSuccess: (row) => (consultant ? onClose() : router.push(`/bench/${row.id}`)),
  });
  const e = save.fieldErrors;
  const submit = () =>
    save.exec(
      {
        ...v,
        skills: splitList(v.skills),
        certifications: splitList(v.certifications),
        rate_bill: v.rate_bill ?? 0,
      },
      consultant?.id,
    );

  return (
    <FormDialog
      open
      title={consultant ? "Edit consultant" : "New consultant"}
      subtitle="Rates are hourly. Cost rates are visible to recruiters and executives only."
      onClose={onClose}
      onSubmit={submit}
      pending={save.pending}
      submitLabel={consultant ? "Save" : "Add consultant"}
    >
      <Text label="Full name" required value={v.full_name} onChange={(x) => set("full_name", x)} error={e.full_name} autoFocus />
      <Text
        label="Title"
        required
        value={v.title}
        onChange={(x) => set("title", x)}
        error={e.title}
        placeholder="e.g. Integration Engineer"
      />
      <Text label="Email" type="email" value={v.email} onChange={(x) => set("email", x)} error={e.email} />
      <Text
        label="Skills"
        required
        value={v.skills}
        onChange={(x) => set("skills", x)}
        error={e.skills ?? e["skills.0"]}
        helperText="Comma-separated, e.g. MuleSoft, APIs, Java"
      />
      <Text
        label="Certifications"
        value={v.certifications}
        onChange={(x) => set("certifications", x)}
        error={e.certifications}
        helperText="Comma-separated"
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <NumberField
          label="Bill rate (USD/hr)"
          required
          value={v.rate_bill}
          onChange={(x) => set("rate_bill", x ?? 0)}
          error={e.rate_bill}
        />
        <NumberField label="Cost rate (USD/hr)" value={v.rate_cost} onChange={(x) => set("rate_cost", x)} error={e.rate_cost} />
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <DateField
          label="Available from"
          value={v.availability_from}
          onChange={(x) => set("availability_from", x)}
          error={e.availability_from}
          helperText="Leave empty if available now"
        />
        <Select label="Status" value={v.status} onChange={(x) => set("status", x)} options={CONSULTANT_STATUS_OPTIONS} error={e.status} />
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <Text label="Location" required value={v.location} onChange={(x) => set("location", x)} error={e.location} />
        <Text
          label="Clearance"
          value={v.clearance}
          onChange={(x) => set("clearance", x)}
          error={e.clearance}
          placeholder="e.g. Public Trust"
        />
      </Stack>
    </FormDialog>
  );
}
