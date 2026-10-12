"use client";
import Save from "@mui/icons-material/SaveOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { updateSettingsAction } from "@/app/actions/compliance";
import { NumberField, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { GlassCard, StatusChip } from "@/components/kit";
import { BID_CRITERIA, type BidCriterion, type OrgSettings, type StageDef } from "@/lib/domain/types";
import { humanize } from "@/lib/format";

type Nullable<T> = { [K in keyof T]: T[K] | null };

export function SettingsView({ settings }: { settings: OrgSettings }) {
  const [floor, setFloor] = useState<number | null>(settings.margin_floor_pct);
  const [survey, setSurvey] = useState<number | null>(settings.low_survey_threshold);
  const [weights, setWeights] = useState<Nullable<Record<BidCriterion, number>>>({ ...settings.bid_weights });
  const [stages, setStages] = useState<Array<Nullable<StageDef>>>(settings.stages.map((s) => ({ ...s })));
  const save = useAction(updateSettingsAction, { success: "Settings saved" });
  const e = save.fieldErrors;

  const sum = BID_CRITERIA.reduce((s, k) => s + (weights[k] ?? 0), 0);
  const sumOk = sum === 100;
  const setStage = (i: number, patch: Partial<Nullable<StageDef>>) =>
    setStages((xs) => xs.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const submit = () =>
    save.exec({
      margin_floor_pct: floor ?? NaN,
      low_survey_threshold: survey ?? NaN,
      bid_weights: Object.fromEntries(BID_CRITERIA.map((k) => [k, weights[k] ?? 0])) as Record<BidCriterion, number>,
      stages: stages.map((s) => ({
        key: s.key!,
        label: s.label ?? "",
        probability: s.probability ?? NaN,
        wip_limit: s.wip_limit ?? null,
        closed: !!s.closed,
      })),
    });

  return (
    <Box
      component="form"
      noValidate
      onSubmit={(ev: React.FormEvent) => {
        ev.preventDefault();
        submit();
      }}
    >
      <Stack spacing={4}>
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
          <Box>
            <Typography variant="h2" component="h1">
              Settings
            </Typography>
            <Typography color="text.secondary">Guardrails, Bid/No-Bid weights and the capture pipeline. Admins only.</Typography>
          </Box>
          <Box>
            <Button type="submit" variant="contained" startIcon={<Save />} disabled={save.pending || !sumOk}>
              {save.pending ? "Saving…" : "Save settings"}
            </Button>
          </Box>
        </Stack>

        {save.error && <Alert severity="error">{save.error}</Alert>}

        <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, alignItems: "start" }}>
          <GlassCard title="Guardrails" subtitle="Applied to quotes and client surveys">
            <Stack spacing={3}>
              <NumberField
                label="Margin floor"
                value={floor}
                onChange={setFloor}
                error={e.margin_floor_pct}
                helperText="Quotes below this margin need executive approval."
                slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }, htmlInput: { min: 0, max: 90 } }}
              />
              <NumberField
                label="Low survey threshold"
                value={survey}
                onChange={setSurvey}
                error={e.low_survey_threshold}
                helperText="Client survey scores at or below this (0–10) alert the account owner."
                slotProps={{ htmlInput: { min: 0, max: 10, step: 1 } }}
              />
            </Stack>
          </GlassCard>

          <GlassCard
            title="Bid/No-Bid weights"
            subtitle="Seven criteria, each scored 1–5; weights are percentages and must add up to 100."
            action={<StatusChip tone={sumOk ? "success" : "danger"} label={`Total ${sum} / 100`} aria-live="polite" />}
          >
            <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)", lg: "1fr 1fr" } }}>
              {BID_CRITERIA.map((k) => (
                <NumberField
                  key={k}
                  label={humanize(k)}
                  value={weights[k]}
                  onChange={(x) => setWeights((w) => ({ ...w, [k]: x }))}
                  error={e[`bid_weights.${k}`]}
                  slotProps={{
                    input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                    htmlInput: { min: 0, max: 100 },
                  }}
                />
              ))}
            </Box>
            {!sumOk && (
              <Alert severity="error" sx={{ mt: 3 }}>
                Weights must add up to 100 — currently {sum} ({sum > 100 ? `${sum - 100} over` : `${100 - sum} short`}).
              </Alert>
            )}
          </GlassCard>
        </Box>

        <GlassCard title="Pipeline stages" subtitle="Labels shown on the board, default win probability (%) and WIP limits per stage">
          <Box
            role="table"
            aria-label="Pipeline stages"
            sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr 1fr", md: "140px 2fr 1fr 1fr 100px" }, alignItems: "center" }}
          >
            <Box role="row" sx={{ display: { xs: "none", md: "contents" } }}>
              {["Stage", "Label", "Probability", "WIP limit", "Type"].map((h) => (
                <Typography key={h} role="columnheader" variant="subtitle2" component="span">
                  {h}
                </Typography>
              ))}
            </Box>
            {stages.map((s, i) => (
              <Box role="row" key={s.key} sx={{ display: "contents" }}>
                <Typography
                  role="cell"
                  variant="mono"
                  component="span"
                  sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, pt: { xs: 2, md: 0 } }}
                >
                  {s.key}
                </Typography>
                <Box role="cell" sx={{ gridColumn: { xs: "1 / -1", md: "auto" } }}>
                  <Text
                    label={`${humanize(s.key)} label`}
                    value={s.label}
                    onChange={(x) => setStage(i, { label: x })}
                    error={e[`stages.${i}.label`]}
                  />
                </Box>
                <Box role="cell">
                  <NumberField
                    label="Probability"
                    value={s.probability}
                    onChange={(x) => setStage(i, { probability: x })}
                    error={e[`stages.${i}.probability`]}
                    slotProps={{
                      input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                      htmlInput: { min: 0, max: 100, "aria-label": `${humanize(s.key)} probability` },
                    }}
                  />
                </Box>
                <Box role="cell">
                  <NumberField
                    label="WIP limit"
                    value={s.wip_limit}
                    onChange={(x) => setStage(i, { wip_limit: x })}
                    error={e[`stages.${i}.wip_limit`]}
                    placeholder="No limit"
                    slotProps={{ htmlInput: { min: 1, "aria-label": `${humanize(s.key)} WIP limit` }, inputLabel: { shrink: true } }}
                  />
                </Box>
                <Box role="cell" sx={{ display: { xs: "none", md: "block" } }}>
                  <StatusChip tone={s.closed ? "neutral" : "primary"} label={s.closed ? "Closed" : "Open"} />
                </Box>
              </Box>
            ))}
          </Box>
        </GlassCard>
      </Stack>
    </Box>
  );
}
