"use client";
import AccountBalance from "@mui/icons-material/AccountBalanceWalletOutlined";
import Flag from "@mui/icons-material/FlagOutlined";
import ShowChart from "@mui/icons-material/ShowChart";
import TrendingUp from "@mui/icons-material/TrendingUp";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import type { GridColDef } from "@mui/x-data-grid";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataTable, EmptyState, GlassCard, StatTile } from "@/components/kit";
import { humanize, money } from "@/lib/format";
import { BEST_CASE_MIN, COMMIT_MIN, type ForecastData } from "@/lib/domain/forecast";
import { seriesColors } from "@/theme/tokens";

type StageRow = ForecastData["byStage"][number];
type LineRow = ForecastData["byServiceLine"][number];

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  currency: string;
}) {
  const t = useTheme().palette.kc;
  if (!active || !payload?.length) return null;
  return (
    <Box
      sx={{
        bgcolor: t.surfaceGlassStrong,
        border: `1px solid ${t.surfaceBorder}`,
        borderRadius: "12px",
        p: 2,
        backdropFilter: t.surfaceBlur,
      }}
    >
      <Typography variant="caption" component="p">
        {label}
      </Typography>
      {payload.map((p) => (
        <Typography key={p.name} variant="body2" sx={{ color: p.color }}>
          {p.name}: <strong>{money(p.value, currency, { compact: true })}</strong>
        </Typography>
      ))}
    </Box>
  );
}

export function ForecastView({ data }: { data: ForecastData }) {
  const theme = useTheme();
  const t = theme.palette.kc;
  const colors = seriesColors(theme.palette.mode);
  const cur = data.currency;
  const compact = (v: number) => money(v, cur, { compact: true });
  const axis = { stroke: t.textSecondary, fontSize: 12, tickLine: false, axisLine: false };
  const k = data.totals;
  const o = data.outside;
  const quarterHasData = data.byQuarter.some((q) => q.unweighted > 0);

  const moneyCol = (field: "unweighted" | "weighted", headerName: string) => ({
    field,
    headerName,
    type: "number" as const,
    width: 150,
    cellClassName: "mono",
    valueFormatter: (v: number) => money(v, cur),
  });

  const stageCols: GridColDef<StageRow>[] = [
    { field: "label", headerName: "Stage", flex: 1, minWidth: 140 },
    { field: "probability", headerName: "Probability", type: "number", width: 110, valueFormatter: (v: number) => `${v}%` },
    { field: "count", headerName: "Deals", type: "number", width: 80 },
    moneyCol("unweighted", `Unweighted (${cur})`),
    moneyCol("weighted", `Weighted (${cur})`),
  ];
  const lineCols: GridColDef<LineRow>[] = [
    { field: "line", headerName: "Service line", flex: 1, minWidth: 160, valueFormatter: (v: string) => humanize(v) },
    { field: "deals", headerName: "Deals", type: "number", width: 80 },
    moneyCol("unweighted", `Unweighted (${cur})`),
    moneyCol("weighted", `Weighted (${cur})`),
  ];

  const series = [
    { key: "commit", name: `Commit (≥${COMMIT_MIN}%)`, color: colors[0] },
    { key: "upside", name: `Best-case upside (${BEST_CASE_MIN}–${COMMIT_MIN - 1}%)`, color: colors[1] },
    { key: "pipelineOnly", name: `Pipeline (<${BEST_CASE_MIN}%)`, color: colors[4] },
  ];

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Forecast
        </Typography>
        <Typography color="text.secondary">
          Open pipeline you can see, unweighted and weighted by stage probability. Commit is ≥{COMMIT_MIN}% probability, best case ≥
          {BEST_CASE_MIN}%. All figures in {cur}.
        </Typography>
      </Box>

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr 1fr", lg: "repeat(4, 1fr)" } }}>
        <StatTile
          label={`Open pipeline (${k.count} deals)`}
          value={k.unweighted}
          format={compact}
          icon={<AccountBalance fontSize="small" />}
        />
        <StatTile label="Weighted pipeline" value={k.weighted} format={compact} icon={<ShowChart fontSize="small" />} />
        <StatTile label={`Commit (≥${COMMIT_MIN}%)`} value={k.commit} format={compact} icon={<Flag fontSize="small" />} />
        <StatTile label={`Best case (≥${BEST_CASE_MIN}%)`} value={k.bestCase} format={compact} icon={<TrendingUp fontSize="small" />} />
      </Box>

      <GlassCard
        title="By expected close quarter"
        subtitle={`Unweighted value stacked by forecast category, with the weighted total as a line (${cur})`}
      >
        {quarterHasData ? (
          <Box sx={{ height: 300 }} role="img" aria-label="Stacked bar chart of pipeline by expected close quarter">
            <ResponsiveContainer>
              <ComposedChart data={data.byQuarter} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  {series.map((s) => (
                    <linearGradient key={s.key} id={`fc-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0.45} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical horizontal={false} stroke={t.surfaceBorder} />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} tickFormatter={compact} width={64} />
                <Tooltip content={<ChartTooltip currency={cur} />} cursor={{ fill: t.surfaceHover }} />
                <Legend wrapperStyle={{ fontSize: 12, color: t.textSecondary }} />
                {series.map((s, i) => (
                  <Bar
                    key={s.key}
                    name={s.name}
                    dataKey={s.key}
                    stackId="q"
                    fill={`url(#fc-${s.key})`}
                    stroke={s.color}
                    radius={i === series.length - 1 ? [8, 8, 0, 0] : 0}
                    maxBarSize={72}
                  />
                ))}
                <Line name="Weighted" type="monotone" dataKey="weighted" stroke={colors[2]} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </Box>
        ) : (
          <EmptyState message="No open deals are expected to close in the next four quarters." />
        )}
        {(o.overdue.count > 0 || o.later.count > 0 || o.undated.count > 0) && (
          <Stack direction="row" spacing={3} useFlexGap flexWrap="wrap" sx={{ mt: 3 }}>
            {o.overdue.count > 0 && (
              <Typography variant="caption">
                Past close date: {o.overdue.count} deal{o.overdue.count === 1 ? "" : "s"}, {compact(o.overdue.unweighted)}
              </Typography>
            )}
            {o.later.count > 0 && (
              <Typography variant="caption">
                Beyond {data.byQuarter.at(-1)?.label}: {o.later.count} deal{o.later.count === 1 ? "" : "s"}, {compact(o.later.unweighted)}
              </Typography>
            )}
            {o.undated.count > 0 && (
              <Typography variant="caption">
                No expected close: {o.undated.count} deal{o.undated.count === 1 ? "" : "s"}, {compact(o.undated.unweighted)}
              </Typography>
            )}
          </Stack>
        )}
      </GlassCard>

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" }, alignItems: "start" }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            By stage
          </Typography>
          <DataTable
            rows={data.byStage}
            columns={stageCols}
            getRowId={(r) => r.stage}
            exportName="konnector-forecast-by-stage"
            hideFooter
            aria-label="Forecast by stage"
          />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            By service line
          </Typography>
          <DataTable
            rows={data.byServiceLine}
            columns={lineCols}
            getRowId={(r) => r.line}
            exportName="konnector-forecast-by-service-line"
            hideFooter
            aria-label="Forecast by service line"
          />
          <Typography variant="caption" component="p" sx={{ mt: 1 }}>
            A deal with several service lines splits its value evenly between them.
          </Typography>
        </Box>
      </Box>
      {data.otherCurrency > 0 && (
        <Typography variant="caption">
          {data.otherCurrency} open deal{data.otherCurrency === 1 ? " is" : "s are"} priced in another currency and not included.
        </Typography>
      )}
    </Stack>
  );
}
