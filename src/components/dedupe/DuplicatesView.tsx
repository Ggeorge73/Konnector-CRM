"use client";
import CallMerge from "@mui/icons-material/CallMerge";
import ContentCopy from "@mui/icons-material/ContentCopyOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { dismissDuplicateAction, undoDismissalAction } from "@/app/actions/dedupe";
import { useAction } from "@/components/common/useAction";
import { EmptyState, GlassCard, RelTime, StatusChip } from "@/components/kit";
import { NAME_SIMILARITY_THRESHOLD } from "@/lib/domain/dedupe";
import type { DedupeEntity } from "@/lib/domain/types";
import { humanize } from "@/lib/format";
import type { AccountSide, ContactSide, DuplicatePair } from "@/lib/services/dedupe";
import { MergeDialog, recordName } from "./MergeDialog";

type AnyRow = AccountSide | ContactSide;
export interface DismissedRow {
  id: string;
  entity: DedupeEntity;
  label: string;
  created_at: string;
}

const scoreTone = (s: number) => (s >= 85 ? "danger" : s >= 60 ? "warning" : "accent");

function summary(entity: DedupeEntity, r: AnyRow): string {
  if (entity === "accounts") {
    const a = r as AccountSide;
    return [humanize(a.type), [a.city, a.state_region ?? a.country].filter(Boolean).join(", "), `Owner ${a.owner_name}`]
      .filter(Boolean)
      .join(" · ");
  }
  const c = r as ContactSide;
  return [c.title, c.account_name, c.email, c.phone].filter(Boolean).join(" · ");
}

export function DuplicatesView({
  accounts,
  contacts,
  dismissed,
}: {
  accounts: DuplicatePair<AccountSide>[];
  contacts: DuplicatePair<ContactSide>[];
  dismissed: DismissedRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: DedupeEntity = params.get("tab") === "contacts" ? "contacts" : "accounts";
  const pairs: DuplicatePair<AnyRow>[] = tab === "accounts" ? accounts : contacts;
  const [merging, setMerging] = useState<DuplicatePair<AnyRow> | null>(null);
  const dismiss = useAction(dismissDuplicateAction, { success: "Marked as not a duplicate" });
  const undo = useAction(undoDismissalAction, { success: "Pair restored" });
  const gone = dismissed.filter((d) => d.entity === tab);

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Duplicates
        </Typography>
        <Typography color="text.secondary">
          Likely duplicate {tab} with the reasons we matched them. Merge keeps every contact, deal and timeline entry; &ldquo;Not a
          duplicate&rdquo; hides the pair for good.
        </Typography>
      </Box>

      <Tabs value={tab} onChange={(_, v) => router.replace(`${pathname}?tab=${v}`)} aria-label="Record type">
        <Tab value="accounts" label={`Accounts (${accounts.length})`} />
        <Tab value="contacts" label={`Contacts (${contacts.length})`} />
      </Tabs>

      {pairs.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={<ContentCopy />}
            message={`No likely duplicate ${tab}. New matches appear here as records are added.`}
            action={
              <Button component={Link} href={`/${tab}`}>
                Back to {tab}
              </Button>
            }
          />
        </GlassCard>
      ) : (
        <Stack component="ul" spacing={3} aria-label={`Duplicate ${tab}`} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {pairs.map((p) => {
            const label = `${recordName(tab, p.a)} and ${recordName(tab, p.b)}`;
            return (
              <GlassCard key={p.id} component="li" aria-label={label}>
                <Stack direction={{ xs: "column", md: "row" }} spacing={4} alignItems={{ md: "center" }}>
                  <Stack alignItems="center" spacing={1} sx={{ minWidth: 88 }}>
                    <Typography variant="h3" component="p" sx={{ fontVariantNumeric: "tabular-nums" }} aria-label={`Score ${p.score}`}>
                      {p.score}
                    </Typography>
                    <StatusChip tone={scoreTone(p.score)} label={p.score >= 85 ? "Very likely" : p.score >= 60 ? "Likely" : "Possible"} />
                  </Stack>
                  <Box sx={{ flex: 1, minWidth: 0, display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
                    {[p.a, p.b].map((r) => (
                      <Box key={r.id} sx={{ minWidth: 0 }}>
                        <Link href={`/${tab}/${r.id}`} style={{ color: "inherit", fontWeight: 700 }}>
                          {recordName(tab, r)}
                        </Link>
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                          {summary(tab, r)}
                        </Typography>
                        <Typography variant="caption">
                          Added <RelTime value={r.created_at} />
                        </Typography>
                      </Box>
                    ))}
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ gridColumn: "1 / -1" }} aria-label="Reasons">
                      {p.reasons.map((r) => (
                        <StatusChip key={r.code} tone="neutral" label={r.label} />
                      ))}
                    </Stack>
                  </Box>
                  <Stack direction={{ xs: "row", md: "column" }} spacing={2} sx={{ flexShrink: 0 }}>
                    <Button variant="contained" startIcon={<CallMerge />} onClick={() => setMerging(p)} aria-label={`Merge ${label}`}>
                      Merge
                    </Button>
                    <Button
                      disabled={dismiss.pending}
                      onClick={() => void dismiss.exec({ entity: tab, a: p.a.id, b: p.b.id })}
                      aria-label={`Not a duplicate: ${label}`}
                    >
                      Not a duplicate
                    </Button>
                  </Stack>
                </Stack>
              </GlassCard>
            );
          })}
        </Stack>
      )}

      <Typography variant="caption" component="p">
        Accounts match on the same name once legal suffixes, &ldquo;the&rdquo;, punctuation and case are ignored, the same website domain,
        or names at least {Math.round(NAME_SIMILARITY_THRESHOLD * 100)}% alike by trigram similarity. Contacts match on the same email
        (case-insensitive; Gmail dots and +tags ignored), the same name at the same account, or the same phone digits. Archived records are
        never listed.
      </Typography>

      {gone.length > 0 && (
        <GlassCard title="Marked as not a duplicate" subtitle="Restore a pair to list it again.">
          <Stack component="ul" spacing={2} sx={{ listStyle: "none", p: 0, m: 0 }}>
            {gone.map((d) => (
              <Stack component="li" key={d.id} direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {d.label}{" "}
                  <Typography component="span" variant="caption">
                    · <RelTime value={d.created_at} />
                  </Typography>
                </Typography>
                <Button size="small" disabled={undo.pending} onClick={() => void undo.exec(d.id)} aria-label={`Restore ${d.label}`}>
                  Restore
                </Button>
              </Stack>
            ))}
          </Stack>
        </GlassCard>
      )}

      {merging && <MergeDialog key={merging.id} entity={tab} pair={merging} onClose={() => setMerging(null)} />}
    </Stack>
  );
}
