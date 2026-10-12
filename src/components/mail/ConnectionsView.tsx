"use client";
import EmailOutlined from "@mui/icons-material/EmailOutlined";
import GoogleIcon from "@mui/icons-material/Google";
import Groups from "@mui/icons-material/Groups";
import LockOutlined from "@mui/icons-material/LockOutlined";
import MicrosoftIcon from "@mui/icons-material/Microsoft";
import Sync from "@mui/icons-material/Sync";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useState } from "react";
import { disconnectMailAction, syncNowAction } from "@/app/actions/mail";
import { FormDialog } from "@/components/common/FormDialog";
import { useToast } from "@/components/common/Toast";
import { useAction } from "@/components/common/useAction";
import { EmptyState, GlassCard, RelTime, StatusChip, type Tone } from "@/components/kit";
import type { MailProvider } from "@/lib/domain/types";

type Mode = "live" | "mock" | "off";

export interface ConnectionCard {
  id: string;
  provider: MailProvider;
  email: string;
  status: "active" | "revoked" | "error";
  scopes: string[];
  last_synced_at: string | null;
  last_error: string | null;
}

export interface RecentItem {
  id: string;
  kind: "email" | "event";
  direction: "inbound" | "outbound";
  subject: string;
  occurred_at: string;
  contact: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
}

const LABEL: Record<MailProvider, string> = { google: "Google Workspace", microsoft: "Microsoft 365" };
const ICON: Record<MailProvider, React.ReactNode> = { google: <GoogleIcon />, microsoft: <MicrosoftIcon /> };
const STATUS_TONE: Record<ConnectionCard["status"], Tone> = { active: "success", error: "danger", revoked: "neutral" };

/** Short, human scope names (Google returns full URLs). */
function scopeLabel(s: string) {
  return s.replace("https://www.googleapis.com/auth/", "");
}

export function ConnectionsView({
  connections,
  recent,
  modes,
  flash,
}: {
  connections: ConnectionCard[];
  recent: RecentItem[];
  modes: Record<MailProvider, Mode>;
  flash: { kind: "success"; provider: string } | { kind: "error"; message: string } | null;
}) {
  const [confirm, setConfirm] = useState<ConnectionCard | null>(null);
  const toast = useToast();
  const sync = useAction(syncNowAction, {
    onSuccess: (d) =>
      d.ok
        ? toast(d.stored ? `Synced — ${d.stored} new item${d.stored === 1 ? "" : "s"} logged` : "Synced — nothing new", "success")
        : toast(`Sync failed: ${d.error ?? "unknown error"}`, "error"),
  });
  const disconnect = useAction(disconnectMailAction, { success: "Mailbox disconnected", onSuccess: () => setConfirm(null) });
  const connected = new Set(connections.map((c) => c.provider));

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          Email & calendar
        </Typography>
        <Typography color="text.secondary">
          Connect your own mailbox to log email and meetings with your contacts automatically, and send email from any record.
        </Typography>
      </Box>

      {flash?.kind === "success" && (
        <Alert severity="success" variant="outlined">
          {LABEL[flash.provider as MailProvider] ?? "Mailbox"} connected. Run a sync to pull in recent email and meetings.
        </Alert>
      )}
      {flash?.kind === "error" && (
        <Alert severity="error" variant="outlined">
          {flash.message}
        </Alert>
      )}

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" }, alignItems: "start" }}>
        <Stack spacing={4} sx={{ minWidth: 0 }}>
          <GlassCard title="Your connections" subtitle="Only you can see or use your mailbox connection">
            {connections.length === 0 ? (
              <EmptyState
                icon={<EmailOutlined />}
                message="No mailbox connected yet. Connect Google Workspace or Microsoft 365 to start."
              />
            ) : (
              <Stack spacing={3}>
                {connections.map((c) => (
                  <Box
                    key={c.id}
                    data-testid={`connection-${c.provider}`}
                    sx={{ border: 1, borderColor: "divider", borderRadius: 3, p: { xs: 3, md: 4 }, minWidth: 0 }}
                  >
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={3}
                      justifyContent="space-between"
                      alignItems={{ xs: "flex-start", sm: "center" }}
                    >
                      <Stack direction="row" spacing={2} alignItems="center" sx={{ minWidth: 0 }}>
                        <Box sx={{ color: "text.secondary", display: "flex" }} aria-hidden>
                          {ICON[c.provider]}
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography fontWeight={700}>{LABEL[c.provider]}</Typography>
                          <Typography variant="mono" component="p" sx={{ overflowWrap: "anywhere" }}>
                            {c.email}
                          </Typography>
                        </Box>
                      </Stack>
                      <StatusChip
                        tone={STATUS_TONE[c.status]}
                        label={c.status === "active" ? "Active" : c.status === "error" ? "Error" : "Revoked"}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
                      Last synced: <RelTime value={c.last_synced_at} />
                    </Typography>
                    {c.last_error && (
                      <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                        {c.last_error}
                      </Typography>
                    )}
                    <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 2 }} aria-label="Granted scopes">
                      {c.scopes.map((s) => (
                        <Chip key={s} size="small" variant="outlined" label={scopeLabel(s)} />
                      ))}
                    </Stack>
                    <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
                      <Button variant="contained" startIcon={<Sync />} disabled={sync.pending} onClick={() => sync.exec(c.id)}>
                        {sync.pending ? "Syncing…" : "Sync now"}
                      </Button>
                      <Button color="error" onClick={() => setConfirm(c)}>
                        Disconnect
                      </Button>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </GlassCard>

          <GlassCard title="Recently synced" subtitle="Email and meetings with known contacts, newest first" flush>
            {recent.length === 0 ? (
              <EmptyState message="Nothing synced yet. Items appear here after your first sync." />
            ) : (
              <List dense aria-label="Recently synced items" sx={{ pb: 2 }}>
                {recent.map((r) => {
                  const href = r.contact ? `/contacts/${r.contact.id}` : r.account ? `/accounts/${r.account.id}` : "/connections";
                  const who = r.contact?.name ?? "Unknown contact";
                  return (
                    <ListItemButton key={r.id} component={Link} href={href} sx={{ px: { xs: 4, md: 6 } }}>
                      <ListItemIcon sx={{ minWidth: 36, color: "text.secondary" }}>
                        {r.kind === "event" ? <Groups fontSize="small" /> : <EmailOutlined fontSize="small" />}
                      </ListItemIcon>
                      <ListItemText
                        primary={r.subject}
                        primaryTypographyProps={{ noWrap: true }}
                        secondary={
                          <>
                            {r.kind === "event" ? "Meeting with " : r.direction === "inbound" ? "From " : "To "}
                            {who}
                            {r.account ? ` · ${r.account.name}` : ""} · <RelTime value={r.occurred_at} />
                          </>
                        }
                        sx={{ minWidth: 0 }}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            )}
          </GlassCard>
        </Stack>

        <Stack spacing={4} sx={{ minWidth: 0 }}>
          <GlassCard title="Connect a mailbox">
            <Stack spacing={3}>
              {(["google", "microsoft"] as const).map((p) => (
                <Stack key={p} spacing={1}>
                  <Button
                    variant={connected.has(p) ? "outlined" : "contained"}
                    startIcon={ICON[p]}
                    href={modes[p] === "off" ? undefined : `/api/oauth/${p}/start`}
                    disabled={modes[p] === "off"}
                    fullWidth
                  >
                    {connected.has(p) ? `Reconnect ${LABEL[p]}` : `Connect ${LABEL[p]}`}
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    {modes[p] === "mock"
                      ? "Demo mode: connects a sample mailbox — no real account is used."
                      : modes[p] === "off"
                        ? "Not configured. An admin needs to add the OAuth client (docs/MAIL.md)."
                        : "You'll be asked to sign in and approve read + send access."}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </GlassCard>
          <GlassCard title="What gets stored">
            <Stack direction="row" spacing={2} alignItems="flex-start">
              <Box sx={{ color: "text.secondary", display: "flex", pt: 0.25 }} aria-hidden>
                <LockOutlined fontSize="small" />
              </Box>
              <Stack spacing={1.5}>
                <Typography variant="body2">
                  Only email and meetings that involve one of the CRM&apos;s contacts are logged. Everything else in your mailbox is skipped
                  and never stored.
                </Typography>
                <Typography variant="body2">
                  We keep the subject and a short snippet (up to 500 characters) — never full message bodies or attachments.
                </Typography>
                <Typography variant="body2">
                  Access tokens are encrypted at rest. Disconnecting revokes access at the provider (where supported) and deletes them.
                </Typography>
              </Stack>
            </Stack>
          </GlassCard>
        </Stack>
      </Box>

      <FormDialog
        open={!!confirm}
        title="Disconnect mailbox?"
        subtitle={confirm ? `${LABEL[confirm.provider]} · ${confirm.email}` : undefined}
        onClose={() => setConfirm(null)}
        onSubmit={() => confirm && disconnect.exec(confirm.id)}
        submitLabel="Disconnect"
        pending={disconnect.pending}
        danger
        maxWidth="xs"
      >
        <Typography variant="body2">
          Sync stops and your tokens are deleted. Email and meetings already on the timeline stay where they are.
        </Typography>
      </FormDialog>
    </Stack>
  );
}
