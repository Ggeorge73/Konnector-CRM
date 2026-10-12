"use client";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { BID_CRITERIA, type BidCriterion } from "@/lib/domain/types";
import { scoreBid, verdictFor } from "@/lib/domain/bid";
import { humanize } from "@/lib/format";
import { StatusChip } from "./StatusChip";

export interface ScoreCardProps {
  scores: Record<BidCriterion, number>;
  weights: Record<BidCriterion, number>;
  onChange?: (criterion: BidCriterion, score: number) => void;
  readOnly?: boolean;
}

/** Weighted Bid/No-Bid grid: each criterion 1–5, total out of 100, verdict chip. */
export function ScoreCard({ scores, weights, onChange, readOnly }: ScoreCardProps) {
  const total = scoreBid(scores, weights);
  const verdict = verdictFor(total);
  return (
    <Box>
      <Stack spacing={3}>
        {BID_CRITERIA.map((c) => (
          <Stack key={c} direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body1" fontWeight={600}>
                {humanize(c)}
              </Typography>
              <Typography variant="caption">Weight {weights[c]}%</Typography>
            </Box>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={scores[c]}
              disabled={readOnly}
              onChange={(_, v) => v && onChange?.(c, v)}
              aria-label={`${humanize(c)} score`}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <ToggleButton key={n} value={n} sx={{ width: 40 }} aria-label={`${n}`}>
                  {n}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
        ))}
      </Stack>
      <Stack direction="row" alignItems="center" spacing={3} sx={{ mt: 5 }}>
        <Typography variant="h4" component="p" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {total}
          <Typography component="span" variant="caption">
            {" "}
            / 100
          </Typography>
        </Typography>
        <Box sx={{ flex: 1 }}>
          <LinearProgress
            variant="determinate"
            value={total}
            color={verdict === "bid" ? "success" : verdict === "conditional" ? "warning" : "error"}
            aria-label="Weighted score"
          />
        </Box>
        <StatusChip value={verdict} label={verdict === "bid" ? "Bid" : verdict === "no_bid" ? "No-Bid" : "Conditional"} />
      </Stack>
    </Box>
  );
}
