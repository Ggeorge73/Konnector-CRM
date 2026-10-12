"use client";
import Autocomplete from "@mui/material/Autocomplete";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveEventAction } from "@/app/actions/bench";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, NumberField, Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import type { BdEvent } from "@/lib/domain/types";
import type { EventInputT } from "@/lib/services/events";

const KINDS = ["summit", "expo", "procurement_fair", "conference", "webinar"] as const;

export function EventFormDialog({
  event,
  users,
  defaultAttendee,
  onClose,
}: {
  event?: BdEvent;
  users: Array<{ id: string; name: string }>;
  defaultAttendee: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState<EventInputT>(
    event
      ? {
          name: event.name,
          kind: event.kind,
          starts_on: event.starts_on,
          ends_on: event.ends_on,
          location: event.location,
          budget: event.budget,
          currency: event.currency,
          attendee_ids: event.attendee_ids,
          notes: event.notes ?? "",
        }
      : {
          name: "",
          kind: "summit",
          starts_on: "",
          ends_on: "",
          location: "",
          budget: 0,
          currency: "USD",
          attendee_ids: [defaultAttendee],
          notes: "",
        },
  );
  const set = <K extends keyof EventInputT>(k: K, val: EventInputT[K]) => setV((x) => ({ ...x, [k]: val }));
  const save = useAction(saveEventAction, {
    success: event ? "Event updated" : "Event created",
    onSuccess: (row) => (event ? onClose() : router.push(`/events/${row.id}`)),
  });
  const e = save.fieldErrors;
  const attendees = users.filter((u) => (v.attendee_ids ?? []).includes(u.id));

  return (
    <FormDialog
      open
      title={event ? "Edit event" : "New event"}
      onClose={onClose}
      onSubmit={() => save.exec(v, event?.id)}
      pending={save.pending}
      submitLabel={event ? "Save" : "Create event"}
    >
      <Text label="Event name" required value={v.name} onChange={(x) => set("name", x)} error={e.name} autoFocus />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <Select label="Kind" value={v.kind} onChange={(x) => set("kind", x)} options={KINDS} error={e.kind} />
        <Text
          label="Location"
          required
          value={v.location}
          onChange={(x) => set("location", x)}
          error={e.location}
          placeholder="City, State"
        />
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <DateField
          label="Starts on"
          required
          value={v.starts_on}
          onChange={(x) => setV((s) => ({ ...s, starts_on: x ?? "", ends_on: s.ends_on || (x ?? "") }))}
          error={e.starts_on}
        />
        <DateField label="Ends on" required value={v.ends_on} onChange={(x) => set("ends_on", x ?? "")} error={e.ends_on} />
      </Stack>
      <NumberField label="Budget (USD)" value={v.budget} onChange={(x) => set("budget", x ?? 0)} error={e.budget} />
      <Autocomplete
        multiple
        options={users}
        value={attendees}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        onChange={(_, val) =>
          set(
            "attendee_ids",
            val.map((x) => x.id),
          )
        }
        renderInput={(params) => <TextField {...params} size="small" label="Attendees" />}
      />
      <Text label="Notes" multiline minRows={2} value={v.notes} onChange={(x) => set("notes", x)} error={e.notes} />
    </FormDialog>
  );
}
