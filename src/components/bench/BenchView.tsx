"use client";
import Add from "@mui/icons-material/Add";
import Badge from "@mui/icons-material/BadgeOutlined";
import EventAvailable from "@mui/icons-material/EventAvailableOutlined";
import Payments from "@mui/icons-material/PaymentsOutlined";
import Schedule from "@mui/icons-material/ScheduleOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DateField, Select, Text } from "@/components/common/fields";
import { DataTable, EmptyState, GlassCard, Money, Restricted, StatTile, StatusChip } from "@/components/kit";
import { money } from "@/lib/format";
import type { ConsultantView } from "@/lib/services/bench";
import { AvailabilityChip, CONSULTANT_STATUS_OPTIONS, ConsultantFormDialog, SkillChips, useDesktop } from "./shared";

export function BenchView({
  rows,
  stats,
  today,
  canEdit,
  canSeeCost,
}: {
  rows: ConsultantView[];
  stats: { availableNow: number; available30: number; avgBill: number };
  today: string;
  canEdit: boolean;
  canSeeCost: boolean;
}) {
  const desktop = useDesktop();
  const [creating, setCreating] = useState(false);
  const [skill, setSkill] = useState("");
  const [status, setStatus] = useState("");
  const [by, setBy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needles = skill
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return rows.filter((r) => {
      const hay = [...r.skills, ...r.certifications, r.title].join(" ").toLowerCase();
      if (needles.length && !needles.every((n) => hay.includes(n))) return false;
      if (status && r.status !== status) return false;
      if (by && (r.availability_from ?? today) > by) return false;
      return true;
    });
  }, [rows, skill, status, by, today]);

  const columns: GridColDef<ConsultantView>[] = [
    {
      field: "full_name",
      headerName: "Consultant",
      flex: 1.2,
      minWidth: 180,
      renderCell: (p) => (
        <Box sx={{ minWidth: 0, py: 1 }}>
          <Link href={`/bench/${p.row.id}`} style={{ fontWeight: 600, color: "inherit" }}>
            {p.row.full_name}
          </Link>
          <Typography variant="caption" component="p" noWrap>
            {p.row.title}
          </Typography>
        </Box>
      ),
    },
    {
      field: "skills",
      headerName: "Skills",
      flex: 1.6,
      minWidth: 210,
      sortable: false,
      valueFormatter: (v: string[]) => v.join("; "),
      renderCell: (p) => (
        <Box sx={{ py: 1 }}>
          <SkillChips skills={p.row.skills} max={3} />
        </Box>
      ),
    },
    {
      field: "certifications",
      headerName: "Certifications",
      flex: 1,
      minWidth: 120,
      sortable: false,
      valueFormatter: (v: string[]) => v.join("; "),
      renderCell: (p) => (
        <Typography variant="body2" color={p.row.certifications.length ? "text.primary" : "text.secondary"} sx={{ whiteSpace: "normal" }}>
          {p.row.certifications.join(", ") || "—"}
        </Typography>
      ),
    },
    {
      field: "rate_bill",
      headerName: "Bill rate",
      type: "number",
      width: 95,
      renderCell: (p) => <Money value={p.row.rate_bill} currency={p.row.currency} />,
    },
    {
      field: "rate_cost",
      headerName: "Cost rate",
      type: "number",
      width: 110,
      renderCell: (p) =>
        canSeeCost && p.row.rate_cost !== null ? <Money value={p.row.rate_cost} currency={p.row.currency} /> : <Restricted />,
    },
    {
      field: "availability_from",
      headerName: "Availability",
      width: 140,
      valueGetter: (_v, r) => (r.availability_from && r.availability_from > today ? r.availability_from : today),
      renderCell: (p) => <AvailabilityChip from={p.row.availability_from} />,
    },
    { field: "location", headerName: "Location", width: 120 },
    { field: "clearance", headerName: "Clearance", width: 110, valueFormatter: (v: string | null) => v ?? "—" },
    { field: "status", headerName: "Status", width: 110, renderCell: (p) => <StatusChip value={p.row.status} /> },
  ];

  return (
    <Stack spacing={4}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
        <Box>
          <Typography variant="h2" component="h1">
            Bench
          </Typography>
          <Typography color="text.secondary">
            Consultants we can put on a bid: skills, rates and availability. Allocation to live projects is read from Konnect Hub.
          </Typography>
        </Box>
        {canEdit && (
          <Box>
            <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)} sx={{ whiteSpace: "nowrap" }}>
              New consultant
            </Button>
          </Box>
        )}
      </Stack>

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}>
        <StatTile label="Available now" value={stats.availableNow} icon={<EventAvailable fontSize="small" />} />
        <StatTile label="Available within 30 days" value={stats.available30} icon={<Schedule fontSize="small" />} />
        <StatTile label="Avg bill rate (USD/hr)" value={stats.avgBill} format={(v) => money(v)} icon={<Payments fontSize="small" />} />
      </Box>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "2fr 1fr 1fr" } }}>
        <Text label="Skill or certification" value={skill} onChange={setSkill} placeholder="e.g. MuleSoft, ServiceNow" />
        <Select label="Status" value={status} onChange={setStatus} options={CONSULTANT_STATUS_OPTIONS} allowEmpty="Any status" />
        <DateField label="Available by" value={by} onChange={setBy} />
      </Box>

      {filtered.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={<Badge />}
            message={rows.length ? "No consultants match these filters." : "The bench is empty."}
            action={
              rows.length ? (
                <Button
                  onClick={() => {
                    setSkill("");
                    setStatus("");
                    setBy(null);
                  }}
                >
                  Clear filters
                </Button>
              ) : canEdit ? (
                <Button variant="contained" onClick={() => setCreating(true)}>
                  Add the first consultant
                </Button>
              ) : undefined
            }
          />
        </GlassCard>
      ) : desktop ? (
        <DataTable rows={filtered} columns={columns} getRowHeight={() => "auto"} exportName="konnector-bench" aria-label="Bench" />
      ) : (
        <Stack spacing={3} component="ul" sx={{ listStyle: "none", p: 0, m: 0 }} aria-label="Bench">
          {filtered.map((r) => (
            <GlassCard key={r.id} component="li" sx={{ p: 4 }}>
              <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="flex-start">
                <Box sx={{ minWidth: 0 }}>
                  <Link href={`/bench/${r.id}`} style={{ fontWeight: 700, color: "inherit" }}>
                    {r.full_name}
                  </Link>
                  <Typography variant="caption" component="p">
                    {r.title} · {r.location}
                    {r.clearance ? ` · ${r.clearance}` : ""}
                  </Typography>
                </Box>
                <StatusChip value={r.status} />
              </Stack>
              <Box sx={{ mt: 2 }}>
                <SkillChips skills={r.skills} max={4} />
              </Box>
              <Stack
                direction="row"
                spacing={3}
                alignItems="center"
                justifyContent="space-between"
                sx={{ mt: 3 }}
                useFlexGap
                flexWrap="wrap"
              >
                <AvailabilityChip from={r.availability_from} />
                <Stack direction="row" spacing={2} alignItems="baseline">
                  <Typography variant="caption">Bill</Typography>
                  <Money value={r.rate_bill} currency={r.currency} />
                  <Typography variant="caption">Cost</Typography>
                  {canSeeCost && r.rate_cost !== null ? <Money value={r.rate_cost} currency={r.currency} /> : <Restricted />}
                </Stack>
              </Stack>
            </GlassCard>
          ))}
        </Stack>
      )}

      {creating && <ConsultantFormDialog onClose={() => setCreating(false)} />}
    </Stack>
  );
}
