"use client";
import Add from "@mui/icons-material/Add";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { useState } from "react";
import { createTaskAction, setTaskStatusAction } from "@/app/actions/core";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { Countdown, EmptyState, GlassCard, StatusChip } from "@/components/kit";
import type { RelatedType, Task } from "@/lib/domain/types";

export type TaskRow = Task & { assignee_name: string; context?: string; href?: string | null };

export function TaskList({ tasks, showContext }: { tasks: TaskRow[]; showContext?: boolean }) {
  const set = useAction(setTaskStatusAction);
  // Optimistic status so the checkbox responds instantly; server refresh reconciles.
  const [local, setLocal] = useState<Record<string, Task["status"]>>({});
  const statusOf = (t: TaskRow) => local[t.id] ?? t.status;
  const toggle = async (t: TaskRow, next: Task["status"]) => {
    setLocal((m) => ({ ...m, [t.id]: next }));
    const r = await set.exec(t.id, next);
    if (!r.ok) setLocal((m) => ({ ...m, [t.id]: t.status }));
  };
  if (!tasks.length) return <EmptyState message="No follow-ups. Add one so nothing slips." />;
  return (
    <List dense disablePadding>
      {tasks.map((t) => (
        <ListItem
          key={t.id}
          disableGutters
          secondaryAction={statusOf(t) === "open" ? <Countdown date={t.due_at} /> : <StatusChip value="done" />}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>
            <Checkbox
              edge="start"
              checked={statusOf(t) === "done"}
              onChange={(e) => toggle(t, e.target.checked ? "done" : "open")}
              slotProps={{ input: { "aria-label": `Mark "${t.title}" ${statusOf(t) === "done" ? "open" : "done"}` } }}
            />
          </ListItemIcon>
          <ListItemText
            primary={t.title}
            primaryTypographyProps={{ sx: { textDecoration: statusOf(t) === "done" ? "line-through" : "none", pr: 12 } }}
            secondary={
              <>
                {t.assignee_name} · {t.priority} priority
                {showContext && t.context && (
                  <>
                    {" · "}
                    {t.href ? <a href={t.href}>{t.context}</a> : t.context}
                  </>
                )}
              </>
            }
          />
        </ListItem>
      ))}
    </List>
  );
}

export function NewTaskDialog({
  open,
  onClose,
  users,
  related,
}: {
  open: boolean;
  onClose: () => void;
  users: Array<{ id: string; name: string }>;
  related?: { type: RelatedType; id: string; accountId: string | null };
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const create = useAction(createTaskAction, {
    success: "Follow-up added",
    onSuccess: () => {
      setTitle("");
      onClose();
    },
  });
  return (
    <FormDialog
      open={open}
      title="New follow-up"
      onClose={onClose}
      pending={create.pending}
      onSubmit={() =>
        create.exec({
          title,
          due_at: due ? new Date(`${due}T17:00:00`).toISOString() : null,
          assignee_id: assignee || undefined,
          priority,
          related_type: related?.type ?? null,
          related_id: related?.id ?? null,
          account_id: related?.accountId ?? null,
        })
      }
    >
      <Text label="What needs to happen?" value={title} onChange={setTitle} error={create.fieldErrors.title} autoFocus required />
      <DateField label="Due" value={due} onChange={setDue} />
      <Select
        label="Assignee"
        value={assignee}
        onChange={setAssignee}
        options={users.map((u) => ({ value: u.id, label: u.name }))}
        allowEmpty="Me"
      />
      <Select label="Priority" value={priority} onChange={setPriority} options={["low", "medium", "high"] as const} />
    </FormDialog>
  );
}

export function TasksPanel({
  tasks,
  users,
  related,
}: {
  tasks: TaskRow[];
  users: Array<{ id: string; name: string }>;
  related: { type: RelatedType; id: string; accountId: string | null };
}) {
  const [open, setOpen] = useState(false);
  return (
    <GlassCard
      title="Follow-ups"
      subtitle="BD tasks only — project work lives in Konnect Hub"
      action={
        <Button size="small" startIcon={<Add />} onClick={() => setOpen(true)}>
          Add
        </Button>
      }
    >
      <TaskList tasks={tasks} />
      <NewTaskDialog open={open} onClose={() => setOpen(false)} users={users} related={related} />
    </GlassCard>
  );
}
