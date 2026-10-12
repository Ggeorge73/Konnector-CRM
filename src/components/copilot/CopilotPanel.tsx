"use client";
import AutoAwesome from "@mui/icons-material/AutoAwesome";
import Close from "@mui/icons-material/Close";
import ContentCopy from "@mui/icons-material/ContentCopy";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logActivityAction } from "@/app/actions/core";
import { copilotAction, createCopilotTasksAction } from "@/app/actions/copilot";
import { useToast } from "@/components/common/Toast";
import { StatusChip } from "@/components/kit";
import type { CopilotResult } from "@/lib/copilot/run";
import type { CopilotOutputs } from "@/lib/copilot/schemas";
import { BID_CRITERIA, type BidCriterion, type CopilotTask, type RelatedType } from "@/lib/domain/types";
import { humanize } from "@/lib/format";

export interface CopilotRecord {
  type: Extract<RelatedType, "account" | "opportunity" | "contact">;
  id: string;
  name: string;
  accountId: string;
  /** Opportunity only: can this user score the bid? */
  canBid?: boolean;
  /** Opportunity only: PDFs attached (for the RFP checklist). */
  pdfs?: Array<{ id: string; name: string }>;
  /** Opportunity only: pre-fill the scorecard with suggested scores (the human still submits). */
  onUseScores?: (scores: Record<BidCriterion, number>) => void;
}

const LABEL: Record<CopilotTask, string> = {
  account_summary: "Summarise account",
  followup_email: "Draft follow-up",
  bid_suggestion: "Suggest Bid/No-Bid",
  notes_to_tasks: "Notes → follow-ups",
  rfp_checklist: "RFP checklist",
};

function tasksFor(r: CopilotRecord): CopilotTask[] {
  if (r.type === "account") return ["account_summary", "followup_email", "notes_to_tasks"];
  if (r.type === "contact") return ["followup_email", "notes_to_tasks"];
  return ["followup_email", ...(r.canBid ? (["bid_suggestion"] as const) : []), "notes_to_tasks", "rfp_checklist"];
}

/** "Copilot" button + right-hand drawer. Every output is a draft; nothing is saved or sent without a click. */
export function CopilotButton({ record }: { record: CopilotRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outlined" color="secondary" startIcon={<AutoAwesome />} onClick={() => setOpen(true)}>
        Copilot
      </Button>
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 520 }, borderRadius: { sm: "20px 0 0 20px" } } }}
      >
        {open && (
          <CopilotPanel
            record={record.onUseScores ? { ...record, onUseScores: (s) => (setOpen(false), record.onUseScores!(s)) } : record}
            onClose={() => setOpen(false)}
          />
        )}
      </Drawer>
    </>
  );
}

export function CopilotPanel({ record, onClose }: { record: CopilotRecord; onClose: () => void }) {
  const t = useTheme().palette.kc;
  const toast = useToast();
  const router = useRouter();
  const tasks = tasksFor(record);
  const [task, setTask] = useState<CopilotTask>(tasks[0]);
  const [notes, setNotes] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pdf, setPdf] = useState(record.pdfs?.[0]?.id ?? "");
  const [results, setResults] = useState<Partial<Record<CopilotTask, CopilotResult>>>({});
  const [pending, start] = useTransition();
  const result = results[task];

  const go = () =>
    start(async () => {
      const input =
        task === "account_summary"
          ? { task, accountId: record.accountId }
          : task === "followup_email"
            ? { task, relatedType: record.type, relatedId: record.id, instructions }
            : task === "bid_suggestion"
              ? { task, opportunityId: record.id }
              : task === "notes_to_tasks"
                ? { task, notes, relatedType: record.type, relatedId: record.id }
                : { task, opportunityId: record.id, fileId: pdf };
      const r = await copilotAction(input as never);
      if (!r.ok) {
        toast(r.error, "error");
        return;
      }
      setResults((m) => ({ ...m, [task]: r.data as CopilotResult }));
    });

  return (
    <Stack sx={{ height: "100%" }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ p: 4, borderBottom: `1px solid ${t.surfaceBorder}` }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: "12px",
            display: "grid",
            placeItems: "center",
            background: `linear-gradient(135deg, ${t.primary}, ${t.accent})`,
            color: "#fff",
          }}
          aria-hidden
        >
          <AutoAwesome fontSize="small" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" component="h2">
            Konnector Copilot
          </Typography>
          <Typography variant="caption" noWrap component="p">
            {record.name}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close Copilot">
          <Close />
        </IconButton>
      </Stack>
      <Tabs value={task} onChange={(_, v) => setTask(v)} variant="scrollable" sx={{ px: 2 }} aria-label="Copilot tasks">
        {tasks.map((k) => (
          <Tab key={k} value={k} label={LABEL[k]} />
        ))}
      </Tabs>
      <Box sx={{ p: 4, overflowY: "auto", flex: 1 }}>
        <Stack spacing={3}>
          {task === "followup_email" && (
            <TextField
              size="small"
              label="Anything to add? (optional)"
              placeholder="e.g. mention the pricing workshop next Tuesday"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          )}
          {task === "notes_to_tasks" && (
            <TextField
              label="Meeting notes"
              multiline
              minRows={6}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Paste your notes from the call or meeting"
            />
          )}
          {task === "rfp_checklist" &&
            (record.pdfs?.length ? (
              <TextField select size="small" label="RFP document" value={pdf} onChange={(e) => setPdf(e.target.value)}>
                {record.pdfs.map((f) => (
                  <MenuItem key={f.id} value={f.id}>
                    {f.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <Alert severity="info">Upload the RFP as a PDF in this opportunity&apos;s Files tab first.</Alert>
            ))}
          <Button
            variant="contained"
            startIcon={<AutoAwesome />}
            disabled={pending || (task === "rfp_checklist" && !pdf)}
            onClick={go}
            sx={{ alignSelf: "flex-start" }}
          >
            {result ? "Run again" : LABEL[task]}
          </Button>
          {pending && <LinearProgress aria-label="Copilot is working" />}
          {result && !result.ok && <Alert severity={result.reason === "refused" ? "warning" : "error"}>{result.message}</Alert>}
          {result?.ok && (
            <Box sx={{ border: `1px solid ${t.surfaceBorder}`, borderRadius: "16px", p: 3, bgcolor: alpha(t.primary, 0.05) }}>
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Chip size="small" label="AI draft — review before use" />
                {result.demo && (
                  <StatusChip
                    tone="warning"
                    label="Demo response"
                    title="No Anthropic API key configured — set ANTHROPIC_API_KEY for live Copilot"
                  />
                )}
              </Stack>
              <Result record={record} result={result} onDone={() => router.refresh()} />
            </Box>
          )}
          <Typography variant="caption">
            Copilot only sees what you can see in the CRM. Nothing is sent to clients or saved without your click.
          </Typography>
        </Stack>
      </Box>
    </Stack>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Box>
      <Typography variant="subtitle2" component="h3">
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 5 }}>
        {items.map((x, i) => (
          <li key={i}>
            <Typography variant="body1">{x}</Typography>
          </li>
        ))}
      </Box>
    </Box>
  );
}

function Result({ record, result, onDone }: { record: CopilotRecord; result: Extract<CopilotResult, { ok: true }>; onDone: () => void }) {
  const toast = useToast();
  const [busy, start] = useTransition();
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    toast("Copied", "success");
  };

  if (result.task === "account_summary") {
    const o = result.output as CopilotOutputs["account_summary"];
    return (
      <Stack spacing={2}>
        <Typography variant="h6">{o.headline}</Typography>
        <List title="Situation" items={o.situation} />
        <List title="Opportunities" items={o.opportunities.map((x) => `${x.name} — ${x.status}: ${x.note}`)} />
        <List title="Risks" items={o.risks} />
        <List title="Next actions" items={o.next_actions} />
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            startIcon={<ContentCopy />}
            onClick={() =>
              copy([o.headline, ...o.situation, ...o.risks.map((r) => `Risk: ${r}`), ...o.next_actions.map((n) => `Next: ${n}`)].join("\n"))
            }
          >
            Copy
          </Button>
          <Button
            size="small"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await logActivityAction({
                  type: "note",
                  subject: "Account summary (Copilot draft, reviewed)",
                  body: [o.headline, ...o.situation, ...o.next_actions.map((n) => `Next: ${n}`)].join("\n"),
                  related_type: "account",
                  related_id: record.accountId,
                  account_id: record.accountId,
                });
                toast(r.ok ? "Saved to the timeline" : r.error, r.ok ? "success" : "error");
                onDone();
              })
            }
          >
            Save as note
          </Button>
        </Stack>
      </Stack>
    );
  }

  if (result.task === "followup_email") {
    const o = result.output as CopilotOutputs["followup_email"];
    return <EmailDraft record={record} draft={o} recipients={result.recipients ?? []} onDone={onDone} />;
  }

  if (result.task === "bid_suggestion") {
    const o = result.output as CopilotOutputs["bid_suggestion"];
    return (
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h6">Suggested verdict</Typography>
          <StatusChip value={o.verdict} label={o.verdict === "no_bid" ? "No-Bid" : humanize(o.verdict)} />
        </Stack>
        <Typography>{o.rationale}</Typography>
        <Box
          component="table"
          sx={{
            width: "100%",
            borderCollapse: "collapse",
            "& td": { py: 1, verticalAlign: "top", borderBottom: 1, borderColor: "divider" },
          }}
        >
          <tbody>
            {BID_CRITERIA.map((k) => (
              <tr key={k}>
                <td style={{ width: 170 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {humanize(k)}
                  </Typography>
                </td>
                <td style={{ width: 40 }}>
                  <Typography variant="mono">{o.scores[k]}</Typography>
                </td>
                <td>
                  <Typography variant="body2">{o.reasons[k]}</Typography>
                </td>
              </tr>
            ))}
          </tbody>
        </Box>
        <List title="Open questions" items={o.open_questions} />
        {record.onUseScores && (
          <Button variant="contained" size="small" sx={{ alignSelf: "flex-start" }} onClick={() => record.onUseScores?.(o.scores)}>
            Use in scorecard
          </Button>
        )}
        <Typography variant="caption">Pre-fills the scorecard. You review and submit it for executive approval.</Typography>
      </Stack>
    );
  }

  if (result.task === "notes_to_tasks") {
    const o = result.output as CopilotOutputs["notes_to_tasks"];
    return <TaskPicker record={record} summary={o.summary} tasks={o.tasks} onDone={onDone} />;
  }

  const o = result.output as CopilotOutputs["rfp_checklist"];
  const mandatory = o.requirements.filter((r) => r.mandatory);
  return (
    <Stack spacing={2}>
      <Typography variant="h6">{o.solicitation.title}</Typography>
      <Typography variant="caption">
        {o.solicitation.number} · {o.solicitation.agency}
      </Typography>
      <Typography>{o.solicitation.summary}</Typography>
      <List title="Key dates" items={o.key_dates.map((d) => `${d.label}: ${d.date}`)} />
      <Typography variant="subtitle2" component="h3">
        Requirements ({mandatory.length} mandatory of {o.requirements.length})
      </Typography>
      <Stack spacing={1}>
        {o.requirements.map((r, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
            <StatusChip tone={r.mandatory ? "danger" : "neutral"} label={r.mandatory ? "Must" : "Should"} />
            <Typography variant="body2">
              <strong>{r.ref}</strong> · {humanize(r.category)} — {r.requirement}
            </Typography>
          </Stack>
        ))}
      </Stack>
      <List title="Evaluation criteria" items={o.evaluation_criteria} />
      <List title="Risks" items={o.risks} />
      <Divider />
      <TaskPicker
        record={record}
        summary="Create proposal follow-ups for the mandatory items:"
        tasks={mandatory
          .slice(0, 15)
          .map((r) => ({ title: `Proposal: ${r.requirement}`.slice(0, 80), due_in_days: 5, priority: "high" as const, owner_hint: "" }))}
        onDone={onDone}
      />
    </Stack>
  );
}

function TaskPicker({
  record,
  summary,
  tasks,
  onDone,
}: {
  record: CopilotRecord;
  summary: string;
  tasks: Array<{ title: string; due_in_days: number; priority: "low" | "medium" | "high"; owner_hint: string }>;
  onDone: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<boolean[]>(tasks.map(() => true));
  const [busy, start] = useTransition();
  if (!tasks.length) return <Typography color="text.secondary">No follow-ups found in these notes.</Typography>;
  return (
    <Stack spacing={1}>
      <Typography>{summary}</Typography>
      {tasks.map((x, i) => (
        <FormControlLabel
          key={i}
          control={<Checkbox checked={picked[i]} onChange={(e) => setPicked((p) => p.map((v, j) => (j === i ? e.target.checked : v)))} />}
          label={
            <Typography variant="body2">
              {x.title}{" "}
              <Typography component="span" variant="caption">
                · due in {x.due_in_days}d · {x.priority}
                {x.owner_hint ? ` · ${x.owner_hint}` : ""}
              </Typography>
            </Typography>
          }
        />
      ))}
      <Button
        variant="contained"
        size="small"
        sx={{ alignSelf: "flex-start" }}
        disabled={busy || !picked.some(Boolean)}
        onClick={() =>
          start(async () => {
            const r = await createCopilotTasksAction(
              tasks.filter((_, i) => picked[i]),
              { type: record.type, id: record.id, accountId: record.accountId },
            );
            toast(r.ok ? `Created ${r.data.created} follow-up${r.data.created === 1 ? "" : "s"}` : r.error, r.ok ? "success" : "error");
            onDone();
          })
        }
      >
        Create {picked.filter(Boolean).length} follow-up{picked.filter(Boolean).length === 1 ? "" : "s"}
      </Button>
    </Stack>
  );
}

function EmailDraft({
  record,
  draft,
  recipients,
  onDone,
}: {
  record: CopilotRecord;
  draft: CopilotOutputs["followup_email"];
  recipients: Array<{ id: string; name: string; email: string }>;
  onDone: () => void;
}) {
  const toast = useToast();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, start] = useTransition();
  return (
    <Stack spacing={2}>
      <Typography variant="caption">{draft.rationale}</Typography>
      {recipients.length > 0 && <Typography variant="body2">Suggested recipients: {recipients.map((r) => r.name).join(", ")}</Typography>}
      <TextField size="small" label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <TextField label="Body" multiline minRows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          startIcon={<ContentCopy />}
          onClick={async () => {
            await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).catch(() => {});
            toast("Copied", "success");
          }}
        >
          Copy
        </Button>
        <EmailComposeSlot record={record} recipients={recipients} subject={subject} body={body} />
        <Button
          size="small"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await logActivityAction({
                type: "email",
                subject: `Draft: ${subject}`,
                body,
                related_type: record.type,
                related_id: record.id,
                account_id: record.accountId,
              });
              toast(r.ok ? "Logged to the timeline" : r.error, r.ok ? "success" : "error");
              onDone();
            })
          }
        >
          Log as email
        </Button>
      </Stack>
    </Stack>
  );
}

/** Replaced with the mail composer once a mailbox connection exists (Sprint 7). */
function EmailComposeSlot(_: {
  record: CopilotRecord;
  recipients: Array<{ id: string; name: string; email: string }>;
  subject: string;
  body: string;
}) {
  return null;
}
