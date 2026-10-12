"use client";
import OpenInNew from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useEffect, useState } from "react";
import { GlassCard } from "@/components/kit";
import type { WebhookDelivery } from "@/lib/domain/types";
import type { ApiKeyView } from "@/lib/services/api-keys";
import type { SubscriptionView } from "@/lib/services/webhooks";
import { radius } from "@/theme/tokens";
import { ApiKeysCard } from "./ApiKeysCard";
import { WebhooksCard } from "./WebhooksCard";

const RESOURCES = ["accounts", "contacts", "opportunities", "activities", "tasks", "quotes"];

export function DeveloperView({
  keys,
  webhooks,
  now,
}: {
  keys: ApiKeyView[];
  webhooks: { subscriptions: SubscriptionView[]; deliveries: WebhookDelivery[] } | null;
  now: string;
}) {
  const t = useTheme().palette.kc;
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h2" component="h1">
          API &amp; webhooks
        </Typography>
        <Typography color="text.secondary">
          Connect scripts and internal tools to the CRM. The REST API runs as the key&apos;s owner, with the same access as the app — and
          never returns cost-side fields.
        </Typography>
      </Box>

      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.6fr) minmax(0, 1fr)" }, alignItems: "start" }}>
        <ApiKeysCard keys={keys} now={now} />
        <GlassCard
          title="REST API v1"
          subtitle="JSON over HTTPS · cursor pagination · 120 requests/min per key"
          action={
            <Button
              size="small"
              endIcon={<OpenInNew />}
              href="/api/v1/openapi.json"
              target="_blank"
              rel="noopener"
              sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
            >
              API docs
            </Button>
          }
        >
          <Stack spacing={3}>
            <Typography variant="body2" color="text.secondary">
              Resources:{" "}
              {RESOURCES.map((r, i) => (
                <Typography key={r} component="span" variant="mono" sx={{ color: "text.primary" }}>
                  /{r}
                  {i < RESOURCES.length - 1 ? ", " : ""}
                </Typography>
              ))}
              . GET needs the <b>read</b> scope; POST and PATCH need <b>write</b>.
            </Typography>
            <Box
              component="pre"
              aria-label="Example request"
              sx={{
                m: 0,
                p: 3,
                borderRadius: `${radius.input}px`,
                border: `1px solid ${t.surfaceBorder}`,
                bgcolor: t.surfaceHover,
                typography: "mono",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {`curl ${origin || "https://crm.example.com"}/api/v1/opportunities?stage=proposal&limit=20 \\\n  -H "Authorization: Bearer kcrm_…"`}
            </Box>
            <Typography variant="caption" component="p">
              Full reference: OpenAPI 3.1 at /api/v1/openapi.json and docs/API.md in the repository.
            </Typography>
          </Stack>
        </GlassCard>
      </Box>

      {webhooks && <WebhooksCard subscriptions={webhooks.subscriptions} deliveries={webhooks.deliveries} />}
    </Stack>
  );
}
