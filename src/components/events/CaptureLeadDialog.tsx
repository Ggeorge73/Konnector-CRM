"use client";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useState } from "react";
import { captureLeadAction } from "@/app/actions/bench";
import { FormDialog } from "@/components/common/FormDialog";
import { Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/domain/types";
import { dateLabel } from "@/lib/format";

export interface ContactOption {
  id: string;
  name: string;
  title: string | null;
  account: string;
}

export function CaptureLeadDialog({
  eventId,
  eventName,
  dueHint,
  contacts,
  accounts,
  onClose,
}: {
  eventId: string;
  eventName: string;
  /** ISO due date the follow-up will get, shown as a hint. */
  dueHint: string;
  contacts: ContactOption[];
  accounts: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [contact, setContact] = useState<ContactOption | null>(null);
  const [account, setAccount] = useState<{ id: string; name: string } | null>(null);
  const [newOrg, setNewOrg] = useState(false);
  const [org, setOrg] = useState<{ name: string; type: AccountType }>({ name: "", type: "government_state" });
  const [p, setP] = useState({ first_name: "", last_name: "", title: "", email: "" });
  const [interest, setInterest] = useState("");
  const capture = useAction(captureLeadAction, { success: "Lead captured — follow-up added to My Work", onSuccess: onClose });
  const e = capture.fieldErrors;

  const submit = () =>
    mode === "existing"
      ? capture.exec(eventId, { mode: "existing", contact_id: contact?.id ?? "", interest })
      : capture.exec(eventId, {
          mode: "new",
          contact: {
            ...p,
            account_id: newOrg ? null : (account?.id ?? null),
            new_account: newOrg ? org : null,
          },
          interest,
        });

  return (
    <FormDialog
      open
      title="Capture lead"
      subtitle={`Met at ${eventName}`}
      onClose={onClose}
      onSubmit={submit}
      pending={capture.pending}
      submitLabel="Capture lead"
    >
      <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)} aria-label="Contact source">
        <ToggleButton value="new">New contact</ToggleButton>
        <ToggleButton value="existing">Existing contact</ToggleButton>
      </ToggleButtonGroup>

      {mode === "existing" ? (
        <Autocomplete
          options={contacts}
          value={contact}
          onChange={(_, v) => setContact(v)}
          getOptionLabel={(o) => `${o.name} · ${o.account}`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => (
            <TextField {...params} size="small" label="Search contacts" error={!!e.contact_id} helperText={e.contact_id} autoFocus />
          )}
          noOptionsText="No matching contacts you can see"
        />
      ) : (
        <>
          <FormControlLabel
            control={<Switch checked={newOrg} onChange={(ev) => setNewOrg(ev.target.checked)} />}
            label="New organisation"
          />
          {newOrg ? (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <Text
                label="Organisation name"
                required
                value={org.name}
                onChange={(x) => setOrg((o) => ({ ...o, name: x }))}
                error={e["contact.new_account.name"]}
              />
              <Select
                label="Organisation type"
                value={org.type}
                onChange={(x) => setOrg((o) => ({ ...o, type: x }))}
                options={ACCOUNT_TYPES}
              />
            </Stack>
          ) : (
            <Autocomplete
              options={accounts}
              value={account}
              onChange={(_, v) => setAccount(v)}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  label="Account"
                  error={!!e["contact.account_id"]}
                  helperText={e["contact.account_id"] ?? "Turn on “New organisation” if they're not in the CRM yet"}
                />
              )}
            />
          )}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Text
              label="First name"
              required
              value={p.first_name}
              onChange={(x) => setP((s) => ({ ...s, first_name: x }))}
              error={e["contact.first_name"]}
            />
            <Text
              label="Last name"
              required
              value={p.last_name}
              onChange={(x) => setP((s) => ({ ...s, last_name: x }))}
              error={e["contact.last_name"]}
            />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Text label="Job title" value={p.title} onChange={(x) => setP((s) => ({ ...s, title: x }))} error={e["contact.title"]} />
            <Text
              label="Email"
              type="email"
              value={p.email}
              onChange={(x) => setP((s) => ({ ...s, email: x }))}
              error={e["contact.email"]}
            />
          </Stack>
        </>
      )}
      <Text label="Interest" value={interest} onChange={setInterest} error={e.interest} placeholder="What did they want to talk about?" />
      <Alert severity="info" icon={false}>
        A follow-up task is added to your My Work, due {dateLabel(dueHint)}.
      </Alert>
    </FormDialog>
  );
}
