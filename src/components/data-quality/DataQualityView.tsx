"use client";
import AccessTime from "@mui/icons-material/AccessTime";
import ContactMail from "@mui/icons-material/ContactMailOutlined";
import ContentCopy from "@mui/icons-material/ContentCopyOutlined";
import EventBusy from "@mui/icons-material/EventBusyOutlined";
import FactCheck from "@mui/icons-material/FactCheckOutlined";
import PersonOff from "@mui/icons-material/PersonOffOutlined";
import RuleOutlined from "@mui/icons-material/RuleOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataTable, EmptyState, GlassCard, StatTile } from "@/components/kit";
import { DQ_RULES, type DqRow, type DqRule } from "@/lib/domain/data-quality";
import type { DataQualityReport } from "@/lib/services/data-quality";

const RULES: Record<DqRule, { label: string; tile: string; icon: React.ReactNode; empty: string; column: string }> = {
  unowned_accounts: {
    label: "Account owners",
    tile: "Accounts without an active owner",
    icon: <PersonOff fontSize="small" />,
    empty: "Every account has an active owner.",
    column: "Account",
  },
  overdue_opportunities: {
    label: "Past close date",
    tile: "Open deals past close date",
    icon: <EventBusy fontSize="small" />,
    empty: "No open deal is past its expected close date.",
    column: "Opportunity",
  },
  incomplete_opportunities: {
    label: "Missing value or close",
    tile: "Deals missing value or close",
    icon: <RuleOutlined fontSize="small" />,
    empty: "Every open deal has a value and an expected close date.",
    column: "Opportunity",
  },
  contacts_without_email: {
    label: "Contacts without email",
    tile: "Contacts without email",
    icon: <ContactMail fontSize="small" />,
    empty: "Every contact has an email address.",
    column: "Contact",
  },
  stale_deals: {
    label: "Stale deals",
    tile: "Stale deals",
    icon: <AccessTime fontSize="small" />,
    empty: "Every open deal has recent activity.",
    column: "Opportunity",
  },
};

export function DataQualityView({ report }: { report: DataQualityReport }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("tab") as DqRule | null;
  const tab: DqRule = requested && DQ_RULES.includes(requested) ? requested : "unowned_accounts";
  const rows = report.rows[tab];
  const meta = RULES[tab];
  const totalDupes = report.duplicates.accounts + report.duplicates.contacts;
  const totalIssues = DQ_RULES.reduce((n, r) => n + report.rows[r].length, 0) + totalDupes;

  const columns: GridColDef<DqRow>[] = [
    {
      field: "label",
      headerName: meta.column,
      flex: 1.4,
      minWidth: 200,
      renderCell: (p) => (
        <Link href={p.row.href} style={{ fontWeight: 600, color: "inherit" }}>
          {p.row.label}
        </Link>
      ),
    },
    { field: "context", headerName: tab === "unowned_accounts" ? "Location" : "Account", flex: 1, minWidth: 180 },
    { field: "issue", headerName: "Issue", flex: 1.4, minWidth: 220 },
    {
      field: "fix",
      headerName: "",
      width: 90,
      sortable: false,
      filterable: false,
      disableExport: true,
      renderCell: (p) => (
        <Button component={Link} href={p.row.href} size="small" aria-label={`Fix ${p.row.label}`}>
          Fix
        </Button>
      ),
    },
  ];

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Data quality
        </Typography>
        <Typography color="text.secondary">
          Gaps that make the pipeline and forecast less trustworthy. Each row links to where you fix it. Deals count as stale after{" "}
          {report.staleDays} days without timeline activity.
        </Typography>
      </Box>

      <Box
        component="ul"
        aria-label="Data quality checks"
        sx={{
          listStyle: "none",
          p: 0,
          m: 0,
          display: "grid",
          gap: 4,
          gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(3, 1fr)", xl: "repeat(6, 1fr)" },
        }}
      >
        {DQ_RULES.map((r) => (
          <Box component="li" key={r}>
            <Box
              component={Link}
              href={`${pathname}?tab=${r}`}
              replace
              scroll={false}
              aria-label={`${RULES[r].tile}: ${report.rows[r].length}`}
              sx={{ display: "block", height: "100%", color: "inherit", textDecoration: "none", borderRadius: 2 }}
            >
              <StatTile label={RULES[r].tile} value={report.rows[r].length} icon={RULES[r].icon} />
            </Box>
          </Box>
        ))}
        <Box component="li">
          <Box
            component={Link}
            href="/duplicates"
            aria-label={`Likely duplicates: ${totalDupes}`}
            sx={{ display: "block", height: "100%", color: "inherit", textDecoration: "none", borderRadius: 2 }}
          >
            <StatTile label="Likely duplicates" value={totalDupes} icon={<ContentCopy fontSize="small" />} />
          </Box>
        </Box>
      </Box>

      {totalIssues === 0 ? (
        <GlassCard>
          <EmptyState icon={<FactCheck />} message="No data quality issues. Nice work." />
        </GlassCard>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={(_, v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}
            variant="scrollable"
            allowScrollButtonsMobile
            aria-label="Data quality checks"
          >
            {DQ_RULES.map((r) => (
              <Tab key={r} value={r} label={`${RULES[r].label} (${report.rows[r].length})`} />
            ))}
          </Tabs>
          {rows.length ? (
            <DataTable rows={rows} columns={columns} exportName={`konnector-${tab.replace(/_/g, "-")}`} aria-label={meta.label} />
          ) : (
            <GlassCard>
              <EmptyState icon={<FactCheck />} message={meta.empty} />
            </GlassCard>
          )}
          {totalDupes > 0 && (
            <Typography variant="body2" color="text.secondary">
              {report.duplicates.accounts} likely duplicate account pairs and {report.duplicates.contacts} contact pairs.{" "}
              <Link href="/duplicates" style={{ color: "inherit", fontWeight: 600 }}>
                Review duplicates
              </Link>
            </Typography>
          )}
        </>
      )}
    </Stack>
  );
}
