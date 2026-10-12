"use client";
import Edit from "@mui/icons-material/EditOutlined";
import Email from "@mui/icons-material/EmailOutlined";
import Phone from "@mui/icons-material/PhoneOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Link from "next/link";
import { useState } from "react";
import { CopilotButton } from "@/components/copilot/CopilotPanel";
import { EmptyState, GlassCard, Money, RecordHeader, StatusChip, type TimelineItem } from "@/components/kit";
import { TasksPanel, type TaskRow } from "@/components/records/TasksPanel";
import { TimelinePanel } from "@/components/records/TimelinePanel";
import type { Contact, Stage } from "@/lib/domain/types";
import { dateLabel, humanize } from "@/lib/format";
import { ContactFormDialog } from "./ContactFormDialog";

export function ContactDetail(props: {
  contact: Contact;
  account: { id: string; name: string };
  ownerName: string;
  opportunities: Array<{ id: string; name: string; stage: Stage; value: number }>;
  events: Array<{ id: string; name: string; starts_on: string }>;
  timeline: TimelineItem[];
  tasks: TaskRow[];
  people: string[];
  users: Array<{ id: string; name: string }>;
  currentUserId: string;
}) {
  const { contact: ct, account } = props;
  const [editing, setEditing] = useState(false);
  return (
    <Stack spacing={4}>
      <RecordHeader
        name={`${ct.first_name} ${ct.last_name}`}
        subtitle={
          <>
            {ct.title ?? "—"} · <Link href={`/accounts/${account.id}`}>{account.name}</Link>
          </>
        }
        chips={ct.role_in_buying ? <StatusChip tone="accent" label={humanize(ct.role_in_buying)} /> : undefined}
        metrics={[
          { label: "Email", value: ct.email ?? "—" },
          { label: "Phone", value: ct.phone ?? "—" },
          { label: "Owner", value: props.ownerName },
        ]}
        actions={
          <>
            <CopilotButton record={{ type: "contact", id: ct.id, name: `${ct.first_name} ${ct.last_name}`, accountId: account.id }} />
            {ct.email && (
              <Button variant="outlined" startIcon={<Email />} href={`mailto:${ct.email}`}>
                Email
              </Button>
            )}
            {ct.phone && (
              <Button variant="outlined" startIcon={<Phone />} href={`tel:${ct.phone}`}>
                Call
              </Button>
            )}
            <Button variant="outlined" startIcon={<Edit />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        }
      />
      <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" } }}>
        <TimelinePanel
          items={props.timeline}
          relatedType="contact"
          relatedId={ct.id}
          accountId={account.id}
          people={props.people}
          currentUserId={props.currentUserId}
        />
        <Stack spacing={4}>
          <TasksPanel tasks={props.tasks} users={props.users} related={{ type: "contact", id: ct.id, accountId: account.id }} />
          <GlassCard title="Opportunities at this account" flush>
            {props.opportunities.length ? (
              <List dense>
                {props.opportunities.map((o) => (
                  <ListItemButton key={o.id} component={Link} href={`/opportunities/${o.id}`}>
                    <ListItemText primary={o.name} secondary={humanize(o.stage)} />
                    <Money value={o.value} />
                  </ListItemButton>
                ))}
              </List>
            ) : (
              <EmptyState message="No opportunities you can see at this account." />
            )}
          </GlassCard>
          {props.events.length > 0 && (
            <GlassCard title="Met at" flush>
              <List dense>
                {props.events.map((e) => (
                  <ListItemButton key={e.id} component={Link} href={`/events/${e.id}`}>
                    <ListItemText primary={e.name} secondary={dateLabel(e.starts_on)} />
                  </ListItemButton>
                ))}
              </List>
            </GlassCard>
          )}
        </Stack>
      </Box>
      {editing && <ContactFormDialog open onClose={() => setEditing(false)} accounts={[account]} contact={ct} />}
    </Stack>
  );
}
