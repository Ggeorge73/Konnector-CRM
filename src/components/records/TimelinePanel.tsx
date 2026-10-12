"use client";
import AlternateEmail from "@mui/icons-material/AlternateEmail";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";
import { logActivityAction, reactAction } from "@/app/actions/core";
import { useAction } from "@/components/common/useAction";
import { GlassCard, Timeline, type TimelineItem } from "@/components/kit";
import type { RelatedType } from "@/lib/domain/types";

const KINDS = [
  ["note", "Note"],
  ["call", "Call"],
  ["meeting", "Meeting"],
  ["email", "Email"],
] as const;

/** Composer (note/call/meeting/email with @mentions) + the record's timeline. */
export function TimelinePanel({
  items,
  relatedType,
  relatedId,
  accountId,
  people,
  currentUserId,
  readOnly,
}: {
  items: TimelineItem[];
  relatedType: RelatedType;
  relatedId: string;
  accountId: string | null;
  people: string[];
  currentUserId: string;
  readOnly?: boolean;
}) {
  const [type, setType] = useState<(typeof KINDS)[number][0]>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const log = useAction(logActivityAction, {
    success: "Logged to timeline",
    onSuccess: () => {
      setSubject("");
      setBody("");
    },
  });
  const react = useAction(reactAction);

  return (
    <GlassCard title="Timeline" subtitle="Notes, calls, meetings, emails, files and system events">
      {!readOnly && (
        <Stack
          component="form"
          spacing={2}
          sx={{ mb: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            log.exec({
              type,
              subject: subject || `${KINDS.find((k) => k[0] === type)![1]} logged`,
              body: body || null,
              related_type: relatedType,
              related_id: relatedId,
              account_id: accountId,
            });
          }}
        >
          <ToggleButtonGroup size="small" exclusive value={type} onChange={(_, v) => v && setType(v)} aria-label="Activity type">
            {KINDS.map(([k, l]) => (
              <ToggleButton key={k} value={k}>
                {l}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <TextField
            size="small"
            label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            error={!!log.fieldErrors.subject}
            helperText={log.fieldErrors.subject}
          />
          <TextField
            size="small"
            label="Details"
            multiline
            minRows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type @ and a teammate's name to mention them"
            slotProps={{
              input: {
                endAdornment: (
                  <Tooltip title="Mention a teammate">
                    <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label="Mention a teammate">
                      <AlternateEmail fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ),
              },
            }}
          />
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            {people.map((p) => (
              <MenuItem
                key={p}
                onClick={() => {
                  setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${p} `);
                  setAnchor(null);
                }}
              >
                {p}
              </MenuItem>
            ))}
          </Menu>
          <Button type="submit" variant="contained" disabled={log.pending} sx={{ alignSelf: "flex-start" }}>
            Log {type}
          </Button>
        </Stack>
      )}
      <Timeline items={items} currentUserId={currentUserId} onReact={(id, e) => react.exec(id, e)} />
    </GlassCard>
  );
}
