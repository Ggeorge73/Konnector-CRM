"use client";
import Lock from "@mui/icons-material/LockOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { decideBidAction, submitBidAction } from "@/app/actions/capture";
import { useAction } from "@/components/common/useAction";
import { EmptyState, GlassCard, RelTime, ScoreCard, StatusChip } from "@/components/kit";
import { defaultScores } from "@/lib/domain/bid";
import type { BidCriterion, BidDecision } from "@/lib/domain/types";

export function BidPanel({
  opportunityId,
  bids,
  weights,
  canEdit,
  canApprove,
  names,
}: {
  opportunityId: string;
  bids: { visible: boolean; decisions: BidDecision[] };
  weights: Record<BidCriterion, number>;
  canEdit: boolean;
  canApprove: boolean;
  names: Map<string, string>;
}) {
  const latest = bids.decisions[0] ?? null;
  const [scores, setScores] = useState<Record<BidCriterion, number>>(latest?.scores ?? defaultScores());
  const [notes, setNotes] = useState("");
  const [execNote, setExecNote] = useState("");
  const submit = useAction(submitBidAction, { success: "Scorecard submitted for executive approval" });
  const decide = useAction(decideBidAction, { success: "Decision recorded" });

  if (!bids.visible) {
    return (
      <GlassCard title="Bid / No-Bid">
        <EmptyState icon={<Lock />} message="Bid scores are restricted to the deal owner and executives." />
      </GlassCard>
    );
  }

  return (
    <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" } }}>
      <GlassCard
        title="Bid / No-Bid scorecard"
        subtitle="Score each criterion 1–5. Weights are set in Settings. Executives approve the verdict."
      >
        {latest?.status === "pending_approval" && (
          <Alert severity="warning" sx={{ mb: 4 }}>
            Waiting for executive approval ({latest.total_score}/100).
          </Alert>
        )}
        <ScoreCard
          scores={scores}
          weights={weights}
          readOnly={!canEdit || latest?.status === "pending_approval"}
          onChange={(c, v) => setScores((s) => ({ ...s, [c]: v }))}
        />
        {canEdit && latest?.status !== "pending_approval" && (
          <Stack spacing={2} sx={{ mt: 4 }}>
            <TextField size="small" label="Rationale" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button
              variant="contained"
              disabled={submit.pending}
              onClick={() => submit.exec(opportunityId, scores, notes || null)}
              sx={{ alignSelf: "flex-start" }}
            >
              Submit for approval
            </Button>
          </Stack>
        )}
        {canApprove && latest?.status === "pending_approval" && (
          <Stack spacing={2} sx={{ mt: 4 }}>
            <Divider />
            <Typography variant="h6">Executive decision</Typography>
            <TextField size="small" label="Note (optional)" value={execNote} onChange={(e) => setExecNote(e.target.value)} />
            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                color="success"
                disabled={decide.pending}
                onClick={() => decide.exec(latest.id, true, execNote || undefined)}
              >
                Approve verdict
              </Button>
              <Button
                variant="outlined"
                color="warning"
                disabled={decide.pending}
                onClick={() => decide.exec(latest.id, false, execNote || undefined)}
              >
                Send back
              </Button>
            </Stack>
          </Stack>
        )}
      </GlassCard>
      <GlassCard title="History">
        {bids.decisions.length ? (
          <Stack spacing={3} divider={<Divider flexItem />}>
            {bids.decisions.map((d) => (
              <Box key={d.id}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography fontWeight={700}>{d.total_score}/100</Typography>
                  <Stack direction="row" spacing={1}>
                    <StatusChip value={d.verdict} label={d.verdict === "no_bid" ? "No-Bid" : d.verdict === "bid" ? "Bid" : "Conditional"} />
                    <StatusChip value={d.status} />
                  </Stack>
                </Stack>
                <Typography variant="caption" component="p">
                  {names.get(d.decided_by ?? "") ?? "—"} · <RelTime value={d.created_at} />
                  {d.approved_by && ` · decided by ${names.get(d.approved_by) ?? "—"}`}
                </Typography>
                {d.notes && (
                  <Typography variant="body2" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
                    {d.notes}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        ) : (
          <EmptyState message="No scorecard yet." />
        )}
      </GlassCard>
    </Box>
  );
}
