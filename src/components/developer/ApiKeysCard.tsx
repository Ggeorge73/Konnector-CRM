"use client";
import Add from "@mui/icons-material/Add";
import KeyOutlined from "@mui/icons-material/KeyOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/actions/developer";
import { FormDialog } from "@/components/common/FormDialog";
import { Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { EmptyState, GlassCard, RelTime, StatusChip } from "@/components/kit";
import { dateLabel } from "@/lib/format";
import type { ApiKeyView } from "@/lib/services/api-keys";
import { SecretDialog } from "./SecretDialog";

const EXPIRY = [
  { value: "never", label: "Never" },
  { value: "30", label: "In 30 days" },
  { value: "90", label: "In 90 days" },
  { value: "365", label: "In 1 year" },
] as const;
type Expiry = (typeof EXPIRY)[number]["value"];

function keyStatus(k: ApiKeyView, now: Date): "active" | "revoked" | "expired" {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && new Date(k.expires_at) <= now) return "expired";
  return "active";
}

export function ApiKeysCard({ keys, now }: { keys: ApiKeyView[]; now: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  const [expiry, setExpiry] = useState<Expiry>("90");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ApiKeyView | null>(null);
  const create = useAction(createApiKeyAction, {
    onSuccess: (d) => {
      setOpen(false);
      setName("");
      setWrite(false);
      setRevealed(d.key);
    },
  });
  const revoke = useAction(revokeApiKeyAction, { success: "Key revoked", onSuccess: () => setConfirm(null) });
  const nowD = new Date(now);
  const active = keys.filter((k) => keyStatus(k, nowD) === "active").length;

  const submit = () =>
    create.exec({
      name,
      scopes: write ? ["read", "write"] : ["read"],
      expires_at: expiry === "never" ? null : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString(),
    });

  return (
    <GlassCard
      title="Personal API keys"
      subtitle={`Keys act as you — same role, same visibility. ${active} active.`}
      action={
        <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)} sx={{ whiteSpace: "nowrap", flexShrink: 0 }}>
          New key
        </Button>
      }
    >
      {keys.length === 0 ? (
        <EmptyState icon={<KeyOutlined />} message="No API keys yet. Create one to read or update the CRM from scripts and other tools." />
      ) : (
        <Stack divider={<Divider flexItem />} component="ul" aria-label="API keys" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {keys.map((k) => {
            const status = keyStatus(k, nowD);
            return (
              <Box
                component="li"
                key={k.id}
                sx={{
                  py: 3,
                  display: "grid",
                  gap: 2,
                  alignItems: "center",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={700} noWrap>
                    {k.name}
                  </Typography>
                  <Typography variant="mono" color="text.secondary" component="div" noWrap>
                    kcrm_{k.prefix}_…
                  </Typography>
                </Box>
                <Box sx={{ justifySelf: "end" }}>
                  {status === "active" && (
                    <Button size="small" color="error" onClick={() => setConfirm(k)} aria-label={`Revoke ${k.name}`}>
                      Revoke
                    </Button>
                  )}
                </Box>
                <Stack direction="row" alignItems="center" sx={{ gridColumn: "1 / -1", flexWrap: "wrap", gap: 1 }}>
                  <StatusChip value={status} tone={status === "active" ? "success" : status === "expired" ? "warning" : "neutral"} />
                  {k.scopes.map((s) => (
                    <StatusChip key={s} label={s} tone={s === "write" ? "violet" : "primary"} />
                  ))}
                  <Typography variant="caption" component="span" sx={{ ml: 1 }}>
                    Created {dateLabel(k.created_at)} · Last used <RelTime value={k.last_used_at} /> ·{" "}
                    {k.revoked_at
                      ? `Revoked ${dateLabel(k.revoked_at)}`
                      : k.expires_at
                        ? `Expires ${dateLabel(k.expires_at)}`
                        : "No expiry"}
                  </Typography>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}

      <FormDialog
        open={open}
        title="New API key"
        subtitle="Requests made with this key run as you."
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel="Create key"
        pending={create.pending}
      >
        <Text
          label="Name"
          value={name}
          onChange={setName}
          error={create.fieldErrors.name}
          placeholder="e.g. Finance reconciliation script"
          autoFocus
          required
        />
        <Box>
          <FormLabel component="legend" sx={{ fontSize: 13, mb: 1 }}>
            Scopes
          </FormLabel>
          <FormGroup>
            <FormControlLabel control={<Checkbox checked disabled />} label="read — list and get records" />
            <FormControlLabel
              control={<Checkbox checked={write} onChange={(e) => setWrite(e.target.checked)} />}
              label="write — create and update records"
            />
          </FormGroup>
          <FormHelperText>Your role still decides what you can see and change.</FormHelperText>
        </Box>
        <Select
          label="Expires"
          value={expiry}
          onChange={setExpiry}
          options={EXPIRY as unknown as Array<{ value: Expiry; label: string }>}
        />
      </FormDialog>

      <FormDialog
        open={!!confirm}
        title={`Revoke "${confirm?.name ?? ""}"?`}
        subtitle="Anything using this key stops working immediately. This can't be undone."
        onClose={() => setConfirm(null)}
        onSubmit={() => confirm && revoke.exec(confirm.id)}
        submitLabel="Revoke key"
        pending={revoke.pending}
        danger
      >
        <Typography variant="mono" component="div">
          kcrm_{confirm?.prefix}_…
        </Typography>
      </FormDialog>

      <SecretDialog
        open={!!revealed}
        title="Your new API key"
        label="New API key"
        secret={revealed ?? ""}
        onClose={() => setRevealed(null)}
        hint={
          <>
            Send it as{" "}
            <Typography component="span" variant="mono">
              Authorization: Bearer &lt;key&gt;
            </Typography>
            .
          </>
        }
      />
    </GlassCard>
  );
}
