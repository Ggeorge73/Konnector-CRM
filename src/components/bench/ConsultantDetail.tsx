"use client";
import Edit from "@mui/icons-material/EditOutlined";
import Email from "@mui/icons-material/EmailOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { GlassCard, Money, Restricted, StatusChip, RecordHeader, type TimelineItem } from "@/components/kit";
import { FilesPanel } from "@/components/records/FilesPanel";
import { TimelinePanel } from "@/components/records/TimelinePanel";
import type { FileRow } from "@/lib/domain/types";
import { dateLabel, pct } from "@/lib/format";
import type { ConsultantView } from "@/lib/services/bench";
import { AvailabilityChip, ConsultantFormDialog, SkillChips } from "./shared";

export function ConsultantDetail({
  consultant: c,
  timeline,
  files,
  people,
  currentUserId,
  canEdit,
  canSeeCost,
}: {
  consultant: ConsultantView;
  timeline: TimelineItem[];
  files: FileRow[];
  people: string[];
  currentUserId: string;
  canEdit: boolean;
  canSeeCost: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const cost = canSeeCost && c.rate_cost !== null;
  return (
    <Stack spacing={4}>
      <RecordHeader
        name={c.full_name}
        subtitle={`${c.title} · ${c.location}`}
        chips={
          <>
            <StatusChip value={c.status} />
            <AvailabilityChip from={c.availability_from} />
            {c.clearance && <StatusChip tone="violet" label={`Clearance: ${c.clearance}`} />}
          </>
        }
        metrics={[
          { label: "Bill rate / hr", value: <Money value={c.rate_bill} currency={c.currency} /> },
          { label: "Cost rate / hr", value: cost ? <Money value={c.rate_cost} currency={c.currency} /> : <Restricted /> },
          { label: "Margin", value: cost ? pct(c.margin_pct, 1) : <Restricted /> },
          { label: "Available from", value: c.availability_from ? dateLabel(c.availability_from) : "Now" },
        ]}
        actions={
          <>
            {c.email && (
              <Button variant="outlined" startIcon={<Email />} href={`mailto:${c.email}`}>
                Email
              </Button>
            )}
            {canEdit && (
              <Button variant="outlined" startIcon={<Edit />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </>
        }
      />
      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" } }}>
        <TimelinePanel
          items={timeline}
          relatedType="consultant"
          relatedId={c.id}
          accountId={null}
          people={people}
          currentUserId={currentUserId}
        />
        <Stack spacing={4}>
          <GlassCard title="Skills & certifications">
            <Typography variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
              Skills
            </Typography>
            <SkillChips skills={c.skills} />
            <Typography variant="subtitle2" component="h3" sx={{ mt: 4, mb: 1.5 }}>
              Certifications
            </Typography>
            {c.certifications.length ? (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {c.certifications.map((x) => (
                  <StatusChip key={x} tone="gold" label={x} />
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                None recorded.
              </Typography>
            )}
          </GlassCard>
          <GlassCard title="Availability">
            <Stack spacing={2}>
              <Stack direction="row" spacing={2} alignItems="center">
                <AvailabilityChip from={c.availability_from} />
                <Typography variant="body2" color="text.secondary">
                  {c.availability_from ? `From ${dateLabel(c.availability_from)}` : "No start constraint"}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Allocation to live projects is read from Konnect Hub, not stored in the CRM.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Keep the latest resume and certificates under Files.
              </Typography>
            </Stack>
          </GlassCard>
          <FilesPanel files={files} related={{ type: "consultant", id: c.id, accountId: null }} />
        </Stack>
      </Box>
      {editing && <ConsultantFormDialog consultant={c} onClose={() => setEditing(false)} />}
    </Stack>
  );
}
