"use client";
import Add from "@mui/icons-material/Add";
import SendOutlined from "@mui/icons-material/SendOutlined";
import WebhookOutlined from "@mui/icons-material/WebhookOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import { useMemo, useState } from "react";
import {
  createWebhookAction,
  deleteWebhookAction,
  retryDeliveryAction,
  sendTestEventAction,
  setWebhookActiveAction,
} from "@/app/actions/developer";
import { FormDialog } from "@/components/common/FormDialog";
import { Text } from "@/components/common/fields";
import { useToast } from "@/components/common/Toast";
import { useAction } from "@/components/common/useAction";
import { DataTable, EmptyState, GlassCard, RelTime, StatusChip } from "@/components/kit";
import { WEBHOOK_EVENTS, type WebhookDelivery, type WebhookEvent } from "@/lib/domain/types";
import { dateTimeLabel } from "@/lib/format";
import type { SubscriptionView } from "@/lib/services/webhooks";
import { SecretDialog } from "./SecretDialog";

const EVENT_HELP: Record<WebhookEvent, string> = {
  "account.created": "A new account is added",
  "account.updated": "Account fields change",
  "opportunity.created": "A new opportunity is added",
  "opportunity.stage_changed": "A deal moves stage (incl. won / lost)",
  "quote.status_changed": "A quote is approved, sent, accepted or declined",
  "client_item.decided": "A client accepts, declines or requests changes in Konnect Hub",
  "handoff.acknowledged": "Konnect Hub confirms the project for a won deal",
};

export function WebhooksCard({ subscriptions, deliveries }: { subscriptions: SubscriptionView[]; deliveries: WebhookDelivery[] }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SubscriptionView | null>(null);

  const create = useAction(createWebhookAction, {
    success: "Webhook created",
    onSuccess: (d) => {
      setOpen(false);
      setUrl("");
      setDescription("");
      setEvents([]);
      setSecret(d.secret);
    },
  });
  const toggle = useAction(setWebhookActiveAction);
  const remove = useAction(deleteWebhookAction, { success: "Webhook deleted", onSuccess: () => setRemoving(null) });
  const toast = useToast();
  const test = useAction(sendTestEventAction, {
    onSuccess: (d) =>
      d.status === "delivered"
        ? toast(`Test event delivered (HTTP ${d.response_status})`, "success")
        : toast(`Test event failed — ${d.last_error ?? "no response"}`, "error"),
  });
  const retry = useAction(retryDeliveryAction, { success: "Retry attempted" });

  const urlById = useMemo(() => new Map(subscriptions.map((s) => [s.id, s.url])), [subscriptions]);

  const cols: GridColDef<WebhookDelivery>[] = [
    { field: "created_at", headerName: "When", width: 180, valueFormatter: (v: string) => dateTimeLabel(v) },
    { field: "event", headerName: "Event", width: 210, cellClassName: "mono" },
    {
      field: "subscription_id",
      headerName: "Endpoint",
      flex: 1,
      minWidth: 200,
      valueGetter: (v: string) => urlById.get(v) ?? "(deleted)",
      cellClassName: "mono",
    },
    {
      field: "status",
      headerName: "Status",
      width: 120,
      renderCell: (p) => <StatusChip value={p.row.status} tone={p.row.status === "delivered" ? "success" : undefined} />,
    },
    { field: "attempts", headerName: "Attempts", type: "number", width: 90 },
    { field: "response_status", headerName: "HTTP", width: 80, cellClassName: "mono" },
    { field: "last_error", headerName: "Last error", flex: 1, minWidth: 200 },
    {
      field: "next_attempt_at",
      headerName: "Next retry",
      width: 130,
      renderCell: (p) => (p.row.status === "pending" ? <RelTime value={p.row.next_attempt_at} /> : "—"),
    },
    {
      field: "actions",
      headerName: "",
      width: 90,
      sortable: false,
      filterable: false,
      renderCell: (p) =>
        p.row.status !== "delivered" ? (
          <Button size="small" disabled={retry.pending} onClick={() => retry.exec(p.row.id)}>
            Retry
          </Button>
        ) : null,
    },
  ];

  const toggleEvent = (e: WebhookEvent, on: boolean) => setEvents((xs) => (on ? [...xs, e] : xs.filter((x) => x !== e)));

  return (
    <Stack spacing={4}>
      <GlassCard
        title="Webhook subscriptions"
        subtitle="Signed POSTs to your other tools when things change. Admins only."
        action={
          <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)} sx={{ whiteSpace: "nowrap", flexShrink: 0 }}>
            New webhook
          </Button>
        }
      >
        {subscriptions.length === 0 ? (
          <EmptyState
            icon={<WebhookOutlined />}
            message="No webhooks yet. Add an endpoint to push CRM events to accounting, e-signature or BI tools."
          />
        ) : (
          <Stack divider={<Divider flexItem />} component="ul" aria-label="Webhook subscriptions" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {subscriptions.map((s) => (
              <Box
                component="li"
                key={s.id}
                sx={{
                  py: 3,
                  display: "grid",
                  gap: 2,
                  alignItems: "center",
                  gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) auto" },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="mono" component="div" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                    {s.url}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {s.description ?? "No description"} · added {dateTimeLabel(s.created_at)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ justifySelf: { md: "end" }, flexWrap: "wrap" }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={s.active}
                        disabled={toggle.pending}
                        onChange={(e) => toggle.exec(s.id, e.target.checked)}
                        inputProps={{ "aria-label": `${s.active ? "Disable" : "Enable"} ${s.url}` }}
                      />
                    }
                    label={s.active ? "Active" : "Paused"}
                  />
                  <Button size="small" startIcon={<SendOutlined />} disabled={test.pending} onClick={() => test.exec(s.id)}>
                    Send test event
                  </Button>
                  <Button size="small" color="error" onClick={() => setRemoving(s)} aria-label={`Delete ${s.url}`}>
                    Delete
                  </Button>
                </Stack>
                <Stack direction="row" sx={{ gridColumn: "1 / -1", flexWrap: "wrap", gap: 1 }}>
                  {s.events.map((e) => (
                    <StatusChip key={e} label={e} tone="primary" />
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </GlassCard>

      <Box>
        <Typography variant="h5" component="h2">
          Recent deliveries
        </Typography>
        <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
          Failed deliveries retry automatically (1, 2, 4, 8, 16 minutes; 6 attempts). 4xx responses fail fast.
        </Typography>
      </Box>
      {deliveries.length === 0 ? (
        <GlassCard>
          <EmptyState icon={<SendOutlined />} message="No deliveries yet. Send a test event to check an endpoint." />
        </GlassCard>
      ) : (
        <DataTable rows={deliveries} columns={cols} exportName="webhook-deliveries" aria-label="Webhook deliveries" />
      )}

      <FormDialog
        open={open}
        title="New webhook"
        subtitle="We'll sign every request with a secret you can verify."
        onClose={() => setOpen(false)}
        onSubmit={() => create.exec({ url, description, events })}
        submitLabel="Create webhook"
        pending={create.pending}
      >
        <Text
          label="Endpoint URL"
          value={url}
          onChange={setUrl}
          error={create.fieldErrors.url}
          placeholder="https://accounting.example.com/hooks/konnector"
          autoFocus
          required
        />
        <Text
          label="Description"
          value={description}
          onChange={setDescription}
          error={create.fieldErrors.description}
          placeholder="Optional"
        />
        <Box>
          <FormLabel component="legend" sx={{ fontSize: 13, mb: 1 }}>
            Events
          </FormLabel>
          <FormGroup>
            {WEBHOOK_EVENTS.map((e) => (
              <FormControlLabel
                key={e}
                control={<Checkbox checked={events.includes(e)} onChange={(x) => toggleEvent(e, x.target.checked)} />}
                label={
                  <Box>
                    <Typography variant="mono" component="span">
                      {e}
                    </Typography>
                    <Typography variant="caption" component="span" color="text.secondary" sx={{ display: "block" }}>
                      {EVENT_HELP[e]}
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", "& .MuiCheckbox-root": { pt: 0.5 } }}
              />
            ))}
          </FormGroup>
          {create.fieldErrors.events && <FormHelperText error>{create.fieldErrors.events}</FormHelperText>}
        </Box>
      </FormDialog>

      <FormDialog
        open={!!removing}
        title="Delete webhook?"
        subtitle="Deliveries stop immediately. Past deliveries stay in the log."
        onClose={() => setRemoving(null)}
        onSubmit={() => removing && remove.exec(removing.id)}
        submitLabel="Delete webhook"
        pending={remove.pending}
        danger
      >
        <Typography variant="mono" component="div" sx={{ wordBreak: "break-all" }}>
          {removing?.url}
        </Typography>
      </FormDialog>

      <SecretDialog
        open={!!secret}
        title="Webhook signing secret"
        label="Webhook signing secret"
        secret={secret ?? ""}
        onClose={() => setSecret(null)}
        hint={
          <>
            Verify{" "}
            <Typography component="span" variant="mono">
              X-Konnector-Signature: t=&lt;ms&gt;,v1=&lt;hex&gt;
            </Typography>{" "}
            as HMAC-SHA256(secret, &quot;&lt;t&gt;.&lt;raw body&gt;&quot;) and reject timestamps older than 5 minutes.
          </>
        }
      />
    </Stack>
  );
}
