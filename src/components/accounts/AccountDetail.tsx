"use client";
import Add from "@mui/icons-material/Add";
import Edit from "@mui/icons-material/EditOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import type { GridColDef } from "@mui/x-data-grid";
import Link from "next/link";
import { useState } from "react";
import { ContactFormDialog } from "@/components/contacts/ContactFormDialog";
import { CopilotButton } from "@/components/copilot/CopilotPanel";
import { DataTable, EmptyState, GlassCard, HealthRing, Money, RecordHeader, StatusChip, type TimelineItem } from "@/components/kit";
import { Countdown } from "@/components/kit/Countdown";
import { FilesPanel } from "@/components/records/FilesPanel";
import { TasksPanel, type TaskRow } from "@/components/records/TasksPanel";
import { TimelinePanel } from "@/components/records/TimelinePanel";
import type { Account, ClientItemStatus, ClientItemType, Contact, FileRow, Opportunity, ProjectHealth } from "@/lib/domain/types";
import { dateLabel, humanize } from "@/lib/format";
import { AccountFormDialog } from "./AccountFormDialog";

type OppRow = Opportunity & { owner_name: string };

export function AccountDetail(props: {
  account: Account;
  ownerName: string;
  contacts: Contact[];
  opportunities: OppRow[];
  health: Array<ProjectHealth & { hub_url: string | null }>;
  clientItems: Array<{
    id: string;
    title: string;
    type: ClientItemType;
    status: ClientItemStatus;
    respond_by: string | null;
    version: number;
  }>;
  timeline: TimelineItem[];
  tasks: TaskRow[];
  files: FileRow[];
  people: string[];
  users: Array<{ id: string; name: string }>;
  owners: Array<{ id: string; name: string }>;
  currentUserId: string;
  canEdit: boolean;
  canAssign: boolean;
}) {
  const { account: a, opportunities: opps } = props;
  const [tab, setTab] = useState(0);
  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const open = opps.filter((o) => !["won", "lost", "no_bid"].includes(o.stage));
  const won = opps.filter((o) => o.stage === "won");
  const related = { type: "account" as const, id: a.id, accountId: a.id };

  const oppCols: GridColDef<OppRow>[] = [
    {
      field: "name",
      headerName: "Opportunity",
      flex: 1.5,
      minWidth: 220,
      renderCell: (p) => (
        <Link href={`/opportunities/${p.row.id}`} style={{ color: "inherit", fontWeight: 600 }}>
          {p.row.name}
        </Link>
      ),
    },
    { field: "stage", headerName: "Stage", width: 130, renderCell: (p) => <StatusChip value={p.row.stage} /> },
    {
      field: "value",
      headerName: "Value",
      width: 140,
      type: "number",
      cellClassName: "mono",
      renderCell: (p) => <Money value={p.row.value} currency={p.row.currency} />,
    },
    {
      field: "proposal_due",
      headerName: "Proposal due",
      width: 150,
      renderCell: (p) => (p.row.proposal_due ? <Countdown date={p.row.proposal_due} /> : "—"),
    },
    { field: "owner_name", headerName: "Owner", width: 140 },
  ];
  const contactCols: GridColDef<Contact>[] = [
    {
      field: "name",
      headerName: "Name",
      flex: 1,
      minWidth: 180,
      valueGetter: (_v, r) => `${r.first_name} ${r.last_name}`,
      renderCell: (p) => (
        <Link href={`/contacts/${p.row.id}`} style={{ color: "inherit", fontWeight: 600 }}>
          {p.value as string}
        </Link>
      ),
    },
    { field: "title", headerName: "Title", flex: 1, minWidth: 180 },
    { field: "role_in_buying", headerName: "Buying role", width: 170, valueFormatter: (v: string | null) => humanize(v) },
    { field: "email", headerName: "Email", flex: 1, minWidth: 200 },
    { field: "phone", headerName: "Phone", width: 150 },
  ];

  return (
    <Stack spacing={4}>
      <RecordHeader
        name={a.name}
        subtitle={`${a.sector} · ${[a.city, a.state_region, a.country].filter(Boolean).join(", ")}`}
        chips={
          <>
            <StatusChip value={a.type} />
            <StatusChip value={a.status} />
            <StatusChip tone="gold" label={`Tier ${a.tier}`} />
            {a.konnect_hub_client_id && <StatusChip tone="accent" label="Konnect Hub client" />}
          </>
        }
        metrics={[
          { label: "Open pipeline", value: <Money value={open.reduce((s, o) => s + o.value, 0)} /> },
          { label: "Open deals", value: open.length },
          { label: "Won", value: <Money value={won.reduce((s, o) => s + o.value, 0)} /> },
          { label: "Owner", value: props.ownerName },
          { label: "Client survey", value: a.survey_score === null ? "—" : `${a.survey_score}/10` },
        ]}
        actions={
          <>
            <CopilotButton record={{ type: "account", id: a.id, name: a.name, accountId: a.id }} />
            {props.canEdit && (
              <Button variant="outlined" startIcon={<Edit />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            <Button variant="contained" startIcon={<Add />} component={Link} href={`/opportunities?new=1&account=${a.id}`}>
              New opportunity
            </Button>
          </>
        }
      />

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile aria-label="Account sections">
        <Tab label="Overview" />
        <Tab label={`Timeline (${props.timeline.length})`} />
        <Tab label={`Contacts (${props.contacts.length})`} />
        <Tab label={`Opportunities (${opps.length})`} />
        <Tab label={`Follow-ups (${props.tasks.filter((t) => t.status === "open").length})`} />
        <Tab label={`Files (${props.files.length})`} />
      </Tabs>

      {tab === 0 && (
        <Box sx={{ display: "grid", gap: 4, gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" } }}>
          <Stack spacing={4}>
            <GlassCard title="Open opportunities" flush>
              {open.length ? (
                <List dense>
                  {open.map((o) => (
                    <ListItemButton key={o.id} component={Link} href={`/opportunities/${o.id}`}>
                      <ListItemText primary={o.name} secondary={`${humanize(o.stage)} · ${o.owner_name}`} />
                      <Stack direction="row" spacing={2} alignItems="center">
                        {o.proposal_due && <Countdown date={o.proposal_due} label="Due" />}
                        <Money value={o.value} />
                      </Stack>
                    </ListItemButton>
                  ))}
                </List>
              ) : (
                <EmptyState message="No open opportunities on this account." />
              )}
            </GlassCard>
            {props.clientItems.length > 0 && (
              <GlassCard title="Shared with the client" subtitle="Published to the Konnect Hub portal" flush>
                <List dense>
                  {props.clientItems.map((i) => (
                    <ListItemButton key={i.id} component={Link} href={`/client-items/${i.id}`}>
                      <ListItemText
                        primary={`${i.title} · v${i.version}`}
                        secondary={`${humanize(i.type)}${i.respond_by ? ` · respond by ${dateLabel(i.respond_by)}` : ""}`}
                      />
                      <StatusChip value={i.status} />
                    </ListItemButton>
                  ))}
                </List>
              </GlassCard>
            )}
            <GlassCard title="About">
              <Typography color="text.secondary">{a.description ?? "No description yet."}</Typography>
              {a.website && (
                <Typography sx={{ mt: 2 }}>
                  <a href={a.website} target="_blank" rel="noopener">
                    {a.website}
                  </a>
                </Typography>
              )}
            </GlassCard>
          </Stack>
          <Stack spacing={4}>
            <GlassCard title="Delivery health" subtitle="Read-only from Konnect Hub">
              {props.health.length ? (
                <Stack spacing={5}>
                  {props.health.map((h) => (
                    <HealthRing
                      key={h.id}
                      title={h.project_name}
                      schedule={h.health_schedule}
                      budget={h.health_budget}
                      acceptance={h.health_acceptance}
                      percentComplete={h.percent_complete}
                      updatedAt={h.hub_updated_at}
                      hubUrl={h.hub_url}
                      size={96}
                    />
                  ))}
                </Stack>
              ) : (
                <EmptyState message="No live projects. Health appears here after a won deal is handed off." />
              )}
            </GlassCard>
            <GlassCard title="Key contacts" flush>
              {props.contacts.length ? (
                <List dense>
                  {props.contacts.slice(0, 5).map((ct) => (
                    <ListItemButton key={ct.id} component={Link} href={`/contacts/${ct.id}`}>
                      <ListItemText
                        primary={`${ct.first_name} ${ct.last_name}`}
                        secondary={[ct.title, humanize(ct.role_in_buying)].filter(Boolean).join(" · ")}
                      />
                    </ListItemButton>
                  ))}
                </List>
              ) : (
                <EmptyState message="No contacts yet." action={<Button onClick={() => setAddingContact(true)}>Add contact</Button>} />
              )}
            </GlassCard>
          </Stack>
        </Box>
      )}

      {tab === 1 && (
        <TimelinePanel
          items={props.timeline}
          relatedType="account"
          relatedId={a.id}
          accountId={a.id}
          people={props.people}
          currentUserId={props.currentUserId}
        />
      )}

      {tab === 2 && (
        <Stack spacing={2}>
          <Button startIcon={<Add />} variant="outlined" sx={{ alignSelf: "flex-end" }} onClick={() => setAddingContact(true)}>
            Add contact
          </Button>
          {props.contacts.length ? (
            <DataTable rows={props.contacts} columns={contactCols} exportName={`${a.name}-contacts`} />
          ) : (
            <EmptyState message="No contacts yet." />
          )}
        </Stack>
      )}

      {tab === 3 &&
        (opps.length ? (
          <DataTable rows={opps} columns={oppCols} exportName={`${a.name}-opportunities`} />
        ) : (
          <EmptyState message="No opportunities yet." />
        ))}
      {tab === 4 && <TasksPanel tasks={props.tasks} users={props.users} related={related} />}
      {tab === 5 && <FilesPanel files={props.files} related={related} />}

      {editing && (
        <AccountFormDialog open onClose={() => setEditing(false)} account={a} owners={props.owners} canAssign={props.canAssign} />
      )}
      {addingContact && (
        <ContactFormDialog open onClose={() => setAddingContact(false)} accounts={[{ id: a.id, name: a.name }]} defaultAccountId={a.id} />
      )}
    </Stack>
  );
}
