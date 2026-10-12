"use client";
import Groups from "@mui/icons-material/GroupsOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, GlassCard, Money, StatusChip, UserAvatar } from "@/components/kit";
import { dateLabel } from "@/lib/format";
import type { StaffingMatch } from "@/lib/services/bench";
import { AvailabilityChip, SkillChips } from "./shared";

/**
 * "Who can staff this?" — ranked consultants for an opportunity. Feed it the result of
 * `staffingMatches(c, opportunityId)` from a server component (bd never gets here).
 */
export function StaffingPanel({
  matches,
  wantedSkills,
  needBy,
  initial = 6,
}: {
  matches: StaffingMatch[];
  wantedSkills: string[];
  needBy?: string;
  initial?: number;
}) {
  const t = useTheme().palette.kc;
  const [all, setAll] = useState(false);
  const shown = all ? matches : matches.slice(0, initial);
  const toneFor = (s: number) => (s >= 75 ? t.success : s >= 50 ? t.accent : s >= 30 ? t.warning : t.textSecondary);

  return (
    <GlassCard
      title="Who can staff this?"
      subtitle={
        <>
          Ranked by skill fit, availability{needBy ? ` by ${dateLabel(needBy)}` : ""}, bench status and certifications. Allocation to live
          projects is read from Konnect Hub.
        </>
      }
    >
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mb: 4 }}>
        <Typography variant="subtitle2" component="span" sx={{ mr: 1 }}>
          Looking for
        </Typography>
        {wantedSkills.length ? (
          wantedSkills.map((s) => <StatusChip key={s} tone="accent" label={s} />)
        ) : (
          <Typography variant="body2" color="text.secondary">
            any skill set
          </Typography>
        )}
      </Stack>

      {matches.length === 0 ? (
        <EmptyState icon={<Groups />} message="No active consultants on the bench yet." />
      ) : (
        <Stack component="ol" spacing={3} sx={{ listStyle: "none", p: 0, m: 0 }} aria-label="Staffing matches">
          {shown.map((m, i) => {
            const c = m.consultant;
            const tone = toneFor(m.score);
            return (
              <Box
                component="li"
                key={c.id}
                sx={{
                  p: { xs: 3, md: 4 },
                  borderRadius: "16px",
                  border: `1px solid ${t.surfaceBorder}`,
                  bgcolor: alpha(t.primary, i === 0 ? 0.06 : 0),
                }}
              >
                <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 2, md: 4 }} alignItems={{ md: "center" }}>
                  <Stack direction="row" spacing={2} alignItems="center" sx={{ minWidth: 0, flex: 1.2 }}>
                    <Typography variant="mono" component="span" sx={{ color: "text.secondary", width: 20 }} aria-label={`Rank ${i + 1}`}>
                      {i + 1}
                    </Typography>
                    <UserAvatar name={c.full_name} size={36} />
                    <Box sx={{ minWidth: 0 }}>
                      <Link href={`/bench/${c.id}`} style={{ fontWeight: 700, color: "inherit" }}>
                        {c.full_name}
                      </Link>
                      <Typography variant="caption" component="p" noWrap>
                        {c.title} · {c.location}
                      </Typography>
                    </Box>
                  </Stack>
                  <Box sx={{ flex: 1, minWidth: 140 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                      <Typography variant="caption">Fit</Typography>
                      <Typography variant="mono" component="span" sx={{ color: tone, fontWeight: 700 }}>
                        {m.score}
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={m.score}
                      aria-label={`Fit score ${m.score} of 100`}
                      sx={{
                        height: 8,
                        borderRadius: 999,
                        bgcolor: alpha(tone, 0.16),
                        "& .MuiLinearProgress-bar": { bgcolor: tone, borderRadius: 999 },
                      }}
                    />
                  </Box>
                  <Stack
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    justifyContent={{ xs: "space-between", md: "flex-end" }}
                    sx={{ minWidth: 220 }}
                  >
                    <AvailabilityChip from={m.available_on} />
                    <Box sx={{ textAlign: "right" }}>
                      <Money value={c.rate_bill} currency={c.currency} />
                      <Typography variant="caption" component="span">
                        {" "}
                        /hr
                      </Typography>
                    </Box>
                  </Stack>
                </Stack>
                <Box sx={{ mt: 2, pl: { md: "56px" } }}>
                  <SkillChips skills={c.skills} max={5} highlight={m.matched_skills} />
                  <Box component="ul" sx={{ m: 0, mt: 1.5, pl: 4, color: "text.secondary" }}>
                    {m.reasons.map((r) => (
                      <Typography key={r} component="li" variant="body2">
                        {r}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}
      {matches.length > initial && (
        <Button sx={{ mt: 3 }} onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${matches.length}`}
        </Button>
      )}
    </GlassCard>
  );
}
