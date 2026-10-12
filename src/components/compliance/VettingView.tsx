"use client";
import Business from "@mui/icons-material/BusinessOutlined";
import Policy from "@mui/icons-material/PolicyOutlined";
import ReportProblem from "@mui/icons-material/ReportProblemOutlined";
import Schedule from "@mui/icons-material/ScheduleOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";
import { saveVettingAction } from "@/app/actions/compliance";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { Countdown, EmptyState, GlassCard, StatTile, StatusChip } from "@/components/kit";
import { dateLabel, daysUntil, humanize } from "@/lib/format";
import type { VettingInputT } from "@/lib/services/capture";
import type { VettingRow } from "@/lib/services/compliance";

const SCREENS = ["clear", "pending", "hit"] as const;
const RISKS = ["low", "medium", "high"] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2} sx={{ minHeight: 32 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ textAlign: "right", minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}

export function VettingView({ rows }: { rows: VettingRow[] }) {
  const [editing, setEditing] = useState<VettingRow | null>(null);
  const vetted = rows.filter((r) => r.vetting);
  const dueSoon = vetted.filter((r) => {
    const d = daysUntil(r.vetting!.review_due);
    return d !== null && d <= 14;
  }).length;

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Partner vetting
        </Typography>
        <Typography color="text.secondary">
          Due diligence on subcontractors and OEMs: sanctions and PEP screens, ownership, anti-corruption and references. Executives only.
        </Typography>
      </Box>

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
        <StatTile label="Partners & OEMs" value={rows.length} icon={<Business fontSize="small" />} />
        <StatTile label="Not vetted" value={rows.length - vetted.length} icon={<Policy fontSize="small" />} />
        <StatTile
          label="High risk"
          value={vetted.filter((r) => r.vetting!.risk_rating === "high").length}
          icon={<ReportProblem fontSize="small" />}
        />
        <StatTile label="Reviews due ≤14d" value={dueSoon} icon={<Schedule fontSize="small" />} />
      </Box>

      {rows.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={<Policy />}
            message="No partner or OEM accounts yet. Add one from Accounts to start vetting."
            action={
              <Button component={Link} href="/accounts?segment=partners">
                Go to accounts
              </Button>
            }
          />
        </GlassCard>
      ) : (
        <Box
          component="ul"
          aria-label="Partners"
          sx={{
            listStyle: "none",
            p: 0,
            m: 0,
            display: "grid",
            gap: 4,
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", xl: "repeat(3, 1fr)" },
          }}
        >
          {rows.map((r) => (
            <GlassCard
              key={r.account.id}
              component="li"
              aria-label={r.account.name}
              title={
                <Link href={`/accounts/${r.account.id}`} style={{ color: "inherit" }}>
                  {r.account.name}
                </Link>
              }
              subtitle={`${humanize(r.account.type)} · ${[r.account.city, r.account.country].filter(Boolean).join(", ")}`}
              action={
                r.vetting ? (
                  <StatusChip value={r.vetting.risk_rating} label={`${humanize(r.vetting.risk_rating)} risk`} />
                ) : (
                  <StatusChip tone="warning" label="Not vetted" />
                )
              }
              sx={{ display: "flex", flexDirection: "column" }}
            >
              {r.vetting ? (
                <Stack spacing={1} sx={{ flex: 1 }}>
                  <Field label="Sanctions screen">
                    <StatusChip value={r.vetting.sanctions_screen} />
                  </Field>
                  <Field label="PEP screen">
                    <StatusChip value={r.vetting.pep_screen} />
                  </Field>
                  <Field label="Anti-corruption attestation">
                    <StatusChip
                      tone={r.vetting.anti_corruption_attested ? "success" : "warning"}
                      label={r.vetting.anti_corruption_attested ? "Attested" : "Outstanding"}
                    />
                  </Field>
                  <Field label="References">
                    <StatusChip
                      tone={r.vetting.references_checked ? "success" : "warning"}
                      label={r.vetting.references_checked ? "Checked" : "Not checked"}
                    />
                  </Field>
                  <Field label="Beneficial ownership">
                    <Typography variant="body2">{r.vetting.beneficial_ownership ?? "—"}</Typography>
                  </Field>
                  <Field label="Review due">
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                      <Typography variant="body2">{dateLabel(r.vetting.review_due)}</Typography>
                      <Countdown date={r.vetting.review_due} />
                    </Stack>
                  </Field>
                  {r.vetting.notes && (
                    <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
                      {r.vetting.notes}
                    </Typography>
                  )}
                  <Box sx={{ flex: 1 }} />
                  <Divider sx={{ pt: 2 }} />
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ pt: 1 }}>
                    <Typography variant="caption">Reviewer: {r.vetting.reviewer_name}</Typography>
                    <Button size="small" onClick={() => setEditing(r)} aria-label={`Edit vetting for ${r.account.name}`}>
                      Edit vetting
                    </Button>
                  </Stack>
                </Stack>
              ) : (
                <Stack spacing={3} alignItems="flex-start">
                  <Typography variant="body2" color="text.secondary">
                    No screening on file. Don&apos;t team with or resell for this partner until it&apos;s vetted.
                  </Typography>
                  <Button variant="contained" size="small" onClick={() => setEditing(r)} aria-label={`Start vetting ${r.account.name}`}>
                    Start vetting
                  </Button>
                </Stack>
              )}
            </GlassCard>
          ))}
        </Box>
      )}

      {editing && <VettingDialog key={editing.account.id} row={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

function VettingDialog({ row, onClose }: { row: VettingRow; onClose: () => void }) {
  const v0 = row.vetting;
  const [v, setV] = useState<VettingInputT>(
    v0
      ? {
          account_id: row.account.id,
          sanctions_screen: v0.sanctions_screen,
          pep_screen: v0.pep_screen,
          beneficial_ownership: v0.beneficial_ownership ?? "",
          anti_corruption_attested: v0.anti_corruption_attested,
          references_checked: v0.references_checked,
          risk_rating: v0.risk_rating,
          review_due: v0.review_due,
          notes: v0.notes ?? "",
        }
      : {
          account_id: row.account.id,
          sanctions_screen: "pending",
          pep_screen: "pending",
          beneficial_ownership: "",
          anti_corruption_attested: false,
          references_checked: false,
          risk_rating: "medium",
          review_due: null,
          notes: "",
        },
  );
  const set = <K extends keyof VettingInputT>(k: K, val: VettingInputT[K]) => setV((x) => ({ ...x, [k]: val }));
  const save = useAction(saveVettingAction, { success: v0 ? "Vetting updated" : "Vetting started", onSuccess: onClose });
  const e = save.fieldErrors;
  return (
    <FormDialog
      open
      title={v0 ? "Edit vetting" : "Start vetting"}
      subtitle={row.account.name}
      onClose={onClose}
      onSubmit={() => save.exec(v, v0?.id)}
      pending={save.pending}
      submitLabel={v0 ? "Save" : "Save vetting"}
    >
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        <Select
          label="Sanctions screen"
          value={v.sanctions_screen}
          onChange={(x) => set("sanctions_screen", x)}
          options={SCREENS}
          error={e.sanctions_screen}
        />
        <Select label="PEP screen" value={v.pep_screen} onChange={(x) => set("pep_screen", x)} options={SCREENS} error={e.pep_screen} />
      </Box>
      <Text
        label="Beneficial ownership"
        value={v.beneficial_ownership}
        onChange={(x) => set("beneficial_ownership", x)}
        error={e.beneficial_ownership}
        placeholder="e.g. Jane Doe 60%, holding company 40%"
      />
      <Stack>
        <FormControlLabel
          control={<Switch checked={!!v.anti_corruption_attested} onChange={(ev) => set("anti_corruption_attested", ev.target.checked)} />}
          label="Anti-corruption attestation signed"
        />
        <FormControlLabel
          control={<Switch checked={!!v.references_checked} onChange={(ev) => set("references_checked", ev.target.checked)} />}
          label="References checked"
        />
      </Stack>
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        <Select label="Risk rating" value={v.risk_rating} onChange={(x) => set("risk_rating", x)} options={RISKS} error={e.risk_rating} />
        <DateField label="Review due" value={v.review_due} onChange={(x) => set("review_due", x)} error={e.review_due} />
      </Box>
      <Text label="Notes" multiline minRows={2} value={v.notes} onChange={(x) => set("notes", x)} error={e.notes} />
    </FormDialog>
  );
}
