"use client";
import Science from "@mui/icons-material/ScienceOutlined";
import Send from "@mui/icons-material/SendOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { publishItemAction, reviseItemAction, withdrawItemAction } from "@/app/actions/client-items";
import { FormDialog } from "@/components/common/FormDialog";
import { useToast } from "@/components/common/Toast";
import { useAction } from "@/components/common/useAction";
import { GlassCard, Money, RecordHeader, RelTime, StatusChip, Timeline, type TimelineItem } from "@/components/kit";
import type { ClientItem, ClientItemStatus } from "@/lib/domain/types";
import { dateLabel, dateTimeLabel, humanize } from "@/lib/format";
import type { ClientItemPublishedPayload } from "@/lib/integration/contract";

export function ClientItemDetail(p: {
  item: ClientItem;
  versions: Array<{ id: string; version: number; status: ClientItemStatus; published_at: string | null }>;
  accountName: string;
  ownerName: string;
  preview: ClientItemPublishedPayload | null;
  timeline: TimelineItem[];
  canManage: boolean;
  simulate: boolean;
}) {
  const i = p.item;
  const router = useRouter();
  const toast = useToast();
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState("");
  const [score, setScore] = useState(9);
  const [note, setNote] = useState("");
  const publish = useAction(publishItemAction, { success: "Published to the client's Konnect Hub portal" });
  const withdraw = useAction(withdrawItemAction, { success: "Withdrawn from Konnect Hub", onSuccess: () => setWithdrawing(false) });
  const revise = useAction(reviseItemAction, { success: "New version drafted", onSuccess: (n) => router.push(`/client-items/${n.id}`) });
  const live = ["published", "viewed", "changes_requested"].includes(i.status);
  const item = p.preview?.item;

  const sim = async (payload: Record<string, unknown>) => {
    const r = await fetch("/api/mock-konnect-hub/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    toast(r.ok ? `Konnect Hub sent ${payload.event}` : (j.error ?? "Simulation failed"), r.ok ? "success" : "error");
    router.refresh();
  };
  const who = { name: "Jasmine Carter", title: "Chief Information Officer", email: "jasmine.carter@atl.example.gov" };

  return (
    <Stack spacing={4}>
      <RecordHeader
        name={i.title}
        subtitle={
          <>
            {humanize(i.type)} · {p.accountName} · owner {p.ownerName}
          </>
        }
        chips={
          <>
            <StatusChip value={i.status} />
            <StatusChip tone="neutral" label={`v${i.version}`} />
            {i.respond_by && <StatusChip tone="accent" label={`Respond by ${dateLabel(i.respond_by)}`} />}
          </>
        }
        metrics={[
          { label: "Amount", value: i.amount === null ? "—" : <Money value={i.amount} currency={i.currency} /> },
          { label: "Published", value: i.published_at ? dateTimeLabel(i.published_at) : "—" },
          { label: "Decided", value: i.decided_at ? dateTimeLabel(i.decided_at) : "—" },
          ...(i.survey_score !== null ? [{ label: "Survey score", value: `${i.survey_score}/10` }] : []),
        ]}
        actions={
          p.canManage ? (
            <>
              {i.status === "draft" && (
                <Button variant="contained" startIcon={<Send />} disabled={publish.pending} onClick={() => publish.exec(i.id)}>
                  Publish to client
                </Button>
              )}
              {(live || i.status === "expired") && (
                <Button variant="outlined" disabled={revise.pending} onClick={() => revise.exec(i.id, {})}>
                  New version
                </Button>
              )}
              {live && (
                <Button variant="outlined" color="error" onClick={() => setWithdrawing(true)}>
                  Withdraw
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      {i.status === "draft" && (
        <Alert severity="info">
          Draft — nothing has left the CRM. The preview below is exactly what the client will see in Konnect Hub.
        </Alert>
      )}
      {i.status === "superseded" && <Alert severity="warning">Superseded by a newer version.</Alert>}
      {i.decided_at && (
        <Alert severity={i.status === "accepted" ? "success" : i.status === "declined" ? "error" : "warning"}>
          {i.decided_by_name} ({i.decided_by_title ?? "client"}, {i.decided_by_email}) {humanize(i.status).toLowerCase()} on{" "}
          {dateTimeLabel(i.decided_at)}
          {i.decision_ip ? ` from ${i.decision_ip}` : ""}. {i.decision_note && <>“{i.decision_note}”</>}
        </Alert>
      )}

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" } }}>
        <GlassCard title="Client preview" subtitle="Rendered from the exact Konnect Hub payload — client-facing fields only">
          {item ? (
            <Stack spacing={3}>
              <Typography variant="h4">{item.title}</Typography>
              {item.summary && <Typography>{item.summary}</Typography>}
              {item.lines.length > 0 && (
                <Box
                  component="table"
                  sx={{
                    width: "100%",
                    borderCollapse: "collapse",
                    "& td, & th": { py: 1.5, borderBottom: 1, borderColor: "divider", textAlign: "left" },
                    "& th": { fontSize: 12, color: "text.secondary" },
                  }}
                >
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Unit price</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.lines.map((l, n) => (
                      <tr key={n}>
                        <td>{l.item}</td>
                        <td>{l.qty}</td>
                        <td>
                          <Money value={l.unit_price} currency={item.currency} />
                        </td>
                        <td>
                          <Money value={l.qty * l.unit_price} currency={item.currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              )}
              {item.amount !== null && (
                <Typography variant="h5">
                  Total <Money value={item.amount} currency={item.currency} variant="h5" />
                </Typography>
              )}
              {item.new_end_date && (
                <Typography>
                  New end date: <strong>{dateLabel(item.new_end_date)}</strong>
                </Typography>
              )}
              {item.terms && (
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                  {item.terms}
                </Typography>
              )}
              {item.requires_signature ? (
                <Alert severity="info">The client signs this via e-signature (government amendment).</Alert>
              ) : (
                <Typography variant="caption">Client actions: Accept · Request changes · Decline</Typography>
              )}
              {item.supersedes_version && <Typography variant="caption">Supersedes v{item.supersedes_version}</Typography>}
              {i.document_file_id && (
                <Button href={`/api/files/${i.document_file_id}`} sx={{ alignSelf: "flex-start" }}>
                  Client PDF
                </Button>
              )}
            </Stack>
          ) : (
            <Alert severity="warning">This account has no Konnect Hub client yet.</Alert>
          )}
        </GlassCard>
        <Stack spacing={4}>
          <GlassCard title="Versions" flush>
            <List dense>
              {p.versions.map((v) => (
                <ListItemButton key={v.id} component={Link} href={`/client-items/${v.id}`} selected={v.id === i.id}>
                  <ListItemText
                    primary={`v${v.version}`}
                    secondary={
                      v.published_at ? (
                        <>
                          published <RelTime value={v.published_at} />
                        </>
                      ) : (
                        "not published"
                      )
                    }
                  />
                  <StatusChip value={v.status} />
                </ListItemButton>
              ))}
            </List>
          </GlassCard>
          {p.simulate && live && (
            <GlassCard title="Simulate the client (mock Konnect Hub)" subtitle="Demo only — sends a signed event as the portal would">
              <Stack spacing={2}>
                {i.status === "published" && (
                  <Button
                    startIcon={<Science />}
                    onClick={() =>
                      sim({
                        event: "client_item.viewed",
                        item_id: i.id,
                        version: i.version,
                        viewed_by: { name: who.name, email: who.email },
                        viewed_at: new Date().toISOString(),
                      })
                    }
                  >
                    Client opens it
                  </Button>
                )}
                {i.type === "survey" ? (
                  <>
                    <Typography variant="body2">Score: {score}/10</Typography>
                    <Slider
                      value={score}
                      min={0}
                      max={10}
                      step={1}
                      marks
                      onChange={(_, v) => setScore(v as number)}
                      aria-label="Survey score"
                    />
                    <TextField size="small" label="Comment" value={note} onChange={(e) => setNote(e.target.value)} />
                    <Button
                      variant="contained"
                      onClick={() =>
                        sim({
                          event: "survey.submitted",
                          item_id: i.id,
                          version: i.version,
                          score,
                          comment: note || null,
                          submitted_by: { name: who.name, email: who.email },
                          submitted_at: new Date().toISOString(),
                        })
                      }
                    >
                      Submit survey
                    </Button>
                  </>
                ) : (
                  <>
                    <TextField size="small" label="Client note" value={note} onChange={(e) => setNote(e.target.value)} />
                    <Divider />
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Button
                        variant="contained"
                        color="success"
                        onClick={() =>
                          sim({
                            event: "client_item.decided",
                            item_id: i.id,
                            version: i.version,
                            decision: "accepted",
                            note: note || null,
                            decided_by: who,
                            decided_at: new Date().toISOString(),
                            ip: "203.0.113.24",
                          })
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() =>
                          sim({
                            event: "client_item.decided",
                            item_id: i.id,
                            version: i.version,
                            decision: "changes_requested",
                            note: note || "Please split phase 2 into a separate line.",
                            decided_by: who,
                            decided_at: new Date().toISOString(),
                            ip: "203.0.113.24",
                          })
                        }
                      >
                        Request changes
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={() =>
                          sim({
                            event: "client_item.decided",
                            item_id: i.id,
                            version: i.version,
                            decision: "declined",
                            note: note || null,
                            decided_by: who,
                            decided_at: new Date().toISOString(),
                            ip: "203.0.113.24",
                          })
                        }
                      >
                        Decline
                      </Button>
                    </Stack>
                  </>
                )}
              </Stack>
            </GlassCard>
          )}
        </Stack>
      </Box>
      <GlassCard title="Timeline">
        <Timeline items={p.timeline} />
      </GlassCard>
      <FormDialog
        open={withdrawing}
        title="Withdraw from Konnect Hub"
        subtitle="The client will see “withdrawn by Konnector” if they open an old link."
        onClose={() => setWithdrawing(false)}
        onSubmit={() => withdraw.exec(i.id, reason || null)}
        pending={withdraw.pending}
        submitLabel="Withdraw"
        danger
      >
        <TextField size="small" label="Reason (internal)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </FormDialog>
    </Stack>
  );
}
