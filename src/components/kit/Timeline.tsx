"use client";
import AttachFile from "@mui/icons-material/AttachFile";
import Call from "@mui/icons-material/Call";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutline";
import EmailOutlined from "@mui/icons-material/EmailOutlined";
import Groups from "@mui/icons-material/Groups";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import RocketLaunch from "@mui/icons-material/RocketLaunch";
import StickyNote2Outlined from "@mui/icons-material/StickyNote2Outlined";
import SwapHoriz from "@mui/icons-material/SwapHoriz";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import type { ActivityType } from "@/lib/domain/types";
import { dateTimeLabel, relative } from "@/lib/format";
import { EmptyState } from "./EmptyState";

export interface TimelineItem {
  id: string;
  type: ActivityType;
  subject: string;
  body: string | null;
  occurred_at: string;
  actorName: string | null;
  contextLabel?: string;
  contextHref?: string;
  reactions?: Record<string, string[]>;
}

const ICONS: Record<ActivityType, React.ReactNode> = {
  note: <StickyNote2Outlined fontSize="small" />,
  email: <EmailOutlined fontSize="small" />,
  call: <Call fontSize="small" />,
  meeting: <Groups fontSize="small" />,
  task: <CheckCircleOutline fontSize="small" />,
  stage_change: <SwapHoriz fontSize="small" />,
  file: <AttachFile fontSize="small" />,
  handoff: <RocketLaunch fontSize="small" />,
  system: <InfoOutlined fontSize="small" />,
};

export const REACTIONS = ["👍", "🎉", "👀"] as const;

/** Highlights @Full Name mentions in a note body. */
function Body({ text }: { text: string }) {
  const t = useTheme().palette.kc;
  const parts = text.split(/(@[A-Z][\w'-]+(?: [A-Z][\w'-]+)?)/g);
  return (
    <Typography variant="body1" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
      {parts.map((p, i) =>
        p.startsWith("@") ? (
          <Box key={i} component="span" sx={{ color: t.accent, fontWeight: 600 }}>
            {p}
          </Box>
        ) : (
          p
        ),
      )}
    </Typography>
  );
}

export function Timeline({
  items,
  currentUserId,
  onReact,
}: {
  items: TimelineItem[];
  currentUserId?: string;
  onReact?: (id: string, emoji: string) => void;
}) {
  const t = useTheme().palette.kc;
  if (items.length === 0) return <EmptyState message="No activity yet. Log a call, note or meeting to start the timeline." />;
  return (
    <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, position: "relative" }} aria-label="Activity timeline">
      {items.map((a, i) => (
        <Box component="li" key={a.id} sx={{ display: "flex", gap: 3, pb: i === items.length - 1 ? 0 : 5, position: "relative" }}>
          {i < items.length - 1 && (
            <Box aria-hidden sx={{ position: "absolute", left: 17, top: 36, bottom: 0, width: 2, bgcolor: t.surfaceBorder }} />
          )}
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              color: a.type === "handoff" ? t.gold : t.accent,
              bgcolor: alpha(a.type === "handoff" ? t.gold : t.primary, 0.16),
              border: `1px solid ${t.surfaceBorder}`,
            }}
            aria-hidden
          >
            {ICONS[a.type]}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle1" component="p" sx={{ fontSize: 14 }}>
                {a.subject}
              </Typography>
              <Tooltip title={dateTimeLabel(a.occurred_at)}>
                <Typography variant="caption" component="time" dateTime={a.occurred_at} suppressHydrationWarning>
                  {relative(a.occurred_at)}
                </Typography>
              </Tooltip>
            </Stack>
            <Typography variant="caption" component="p">
              {a.actorName ?? "System"} · {a.type.replace("_", " ")}
              {a.contextLabel && (
                <>
                  {" · "}
                  {a.contextHref ? (
                    <a href={a.contextHref} style={{ color: "inherit" }}>
                      {a.contextLabel}
                    </a>
                  ) : (
                    a.contextLabel
                  )}
                </>
              )}
            </Typography>
            {a.body && <Body text={a.body} />}
            {onReact && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                {REACTIONS.map((e) => {
                  const who = a.reactions?.[e] ?? [];
                  const mine = currentUserId ? who.includes(currentUserId) : false;
                  return (
                    <Chip
                      key={e}
                      size="small"
                      variant={mine ? "filled" : "outlined"}
                      label={`${e}${who.length ? ` ${who.length}` : ""}`}
                      onClick={() => onReact(a.id, e)}
                      aria-pressed={mine}
                      aria-label={`React ${e}`}
                      sx={{ borderColor: t.surfaceBorder }}
                    />
                  );
                })}
              </Stack>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
