"use client";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { mergeAccountsAction, mergeContactsAction } from "@/app/actions/dedupe";
import { FormDialog } from "@/components/common/FormDialog";
import { useAction } from "@/components/common/useAction";
import { ACCOUNT_MERGE_FIELDS, CONTACT_MERGE_FIELDS } from "@/lib/domain/dedupe";
import type { DedupeEntity } from "@/lib/domain/types";
import { dateLabel, humanize } from "@/lib/format";
import type { AccountSide, ContactSide, DuplicatePair } from "@/lib/services/dedupe";

type Side = "a" | "b";
type AnyRow = AccountSide | ContactSide;

const LABELS: Record<string, string> = {
  name: "Name",
  type: "Type",
  sector: "Sector",
  status: "Status",
  tier: "Tier",
  owner_id: "Owner",
  website: "Website",
  country: "Country",
  state_region: "State / region",
  city: "City",
  description: "Description",
  first_name: "First name",
  last_name: "Last name",
  title: "Title",
  email: "Email",
  phone: "Phone",
  role_in_buying: "Buying role",
  account_id: "Account",
};

const HUMANIZED = new Set(["type", "status", "role_in_buying"]);

function display(entity: DedupeEntity, row: AnyRow, field: string): string {
  if (field === "owner_id") return row.owner_name;
  if (entity === "contacts" && field === "account_id") return (row as ContactSide).account_name;
  const v = (row as unknown as Record<string, unknown>)[field];
  if (v === null || v === undefined || v === "") return "";
  return HUMANIZED.has(field) ? humanize(String(v)) : String(v);
}

export const recordName = (entity: DedupeEntity, r: AnyRow) =>
  entity === "accounts" ? (r as AccountSide).name : `${(r as ContactSide).first_name} ${(r as ContactSide).last_name}`;

/** Default survivor: the record already linked to Konnect Hub, else the older one. */
function defaultSurvivor(entity: DedupeEntity, pair: DuplicatePair<AnyRow>): Side {
  if (entity === "accounts") {
    const a = pair.a as AccountSide;
    const b = pair.b as AccountSide;
    if (!!a.konnect_hub_client_id !== !!b.konnect_hub_client_id) return a.konnect_hub_client_id ? "a" : "b";
  }
  return pair.a.created_at <= pair.b.created_at ? "a" : "b";
}

/**
 * Side-by-side merge: pick which record survives (it keeps its id and history), then pick each
 * field from the left or right record. Everything linked to the other record moves to the survivor.
 */
export function MergeDialog({ entity, pair, onClose }: { entity: DedupeEntity; pair: DuplicatePair<AnyRow>; onClose: () => void }) {
  const t = useTheme().palette.kc;
  const router = useRouter();
  const fields: readonly string[] = entity === "accounts" ? ACCOUNT_MERGE_FIELDS : CONTACT_MERGE_FIELDS;
  const [survivor, setSurvivor] = useState<Side>(() => defaultSurvivor(entity, pair));
  // Each field starts on the survivor's value, unless only the other side has one.
  const initialPicks = (s: Side) =>
    Object.fromEntries(
      fields.map((f) => {
        const other: Side = s === "a" ? "b" : "a";
        return [f, !display(entity, pair[s], f) && display(entity, pair[other], f) ? other : s];
      }),
    ) as Record<string, Side>;
  const [picks, setPicks] = useState<Record<string, Side>>(() => initialPicks(survivor));

  const hubA = entity === "accounts" ? (pair.a as AccountSide).konnect_hub_client_id : null;
  const hubB = entity === "accounts" ? (pair.b as AccountSide).konnect_hub_client_id : null;
  const hubConflict = !!hubA && !!hubB && hubA !== hubB;

  const onSuccess = (d: { survivor_id: string }) => {
    onClose();
    router.push(`/${entity}/${d.survivor_id}`);
  };
  const mergeAcc = useAction(mergeAccountsAction, { success: "Records merged", onSuccess });
  const mergeCon = useAction(mergeContactsAction, { success: "Records merged", onSuccess });
  const pending = mergeAcc.pending || mergeCon.pending;
  const error = mergeAcc.error ?? mergeCon.error;

  const differing = useMemo(() => fields.filter((f) => display(entity, pair.a, f) !== display(entity, pair.b, f)), [fields, entity, pair]);
  const loser: Side = survivor === "a" ? "b" : "a";

  const submit = () => {
    if (hubConflict) return;
    const pick = Object.fromEntries(fields.map((f) => [f, picks[f] === survivor ? "survivor" : "loser"]));
    const input = { survivor_id: pair[survivor].id, loser_id: pair[loser].id, pick };
    if (entity === "accounts") void mergeAcc.exec(input);
    else void mergeCon.exec(input);
  };

  const cell = { py: 1.5, px: 2, borderTop: `1px solid ${t.surfaceBorder}`, minWidth: 0 } as const;
  const sideHeader = (s: Side) => (
    <Box sx={{ ...cell, borderTop: 0 }}>
      <Typography variant="subtitle2" component="p" sx={{ overflowWrap: "anywhere" }}>
        {recordName(entity, pair[s])}
      </Typography>
      <Typography variant="caption" component="p">
        Created {dateLabel(pair[s].created_at)}
        {entity === "accounts" &&
          ` · ${(pair[s] as AccountSide).contact_count} contacts · ${(pair[s] as AccountSide).opportunity_count} deals`}
      </Typography>
    </Box>
  );

  return (
    <FormDialog
      open
      maxWidth="md"
      title={entity === "accounts" ? "Merge accounts" : "Merge contacts"}
      subtitle="Contacts, deals, timeline, tasks, files and tags of the other record move to the survivor. The other record is archived, not deleted."
      onClose={onClose}
      onSubmit={submit}
      pending={pending}
      submitDisabled={hubConflict}
      submitLabel={entity === "accounts" ? "Merge accounts" : "Merge contacts"}
    >
      {hubConflict && (
        <Alert severity="error">
          These accounts are linked to different Konnect Hub clients ({hubA} and {hubB}). Resolve the duplicate client in Konnect Hub first,
          then merge here.
        </Alert>
      )}
      {error && !hubConflict && <Alert severity="error">{error}</Alert>}

      <Box>
        <Typography variant="subtitle2" component="p" id="survivor-label">
          Which record survives? It keeps its id, links and history.
        </Typography>
        <RadioGroup
          row
          aria-labelledby="survivor-label"
          value={survivor}
          onChange={(e) => {
            const s = e.target.value as Side;
            setSurvivor(s);
            setPicks(initialPicks(s));
          }}
        >
          {(["a", "b"] as const).map((s) => (
            <FormControlLabel key={s} value={s} control={<Radio />} label={`Keep ${recordName(entity, pair[s])}`} />
          ))}
        </RadioGroup>
      </Box>

      <Box
        role="table"
        aria-label="Pick each field"
        sx={{ display: "grid", gridTemplateColumns: { xs: "88px 1fr 1fr", sm: "140px 1fr 1fr" }, alignItems: "stretch" }}
      >
        <Box role="row" sx={{ display: "contents" }}>
          <Box role="columnheader" sx={{ ...cell, borderTop: 0 }}>
            <Typography variant="caption">Field</Typography>
          </Box>
          <Box role="columnheader" sx={{ display: "contents" }}>
            {sideHeader("a")}
          </Box>
          <Box role="columnheader" sx={{ display: "contents" }}>
            {sideHeader("b")}
          </Box>
        </Box>
        {fields.map((f) => {
          const same = !differing.includes(f);
          return (
            <Box role="row" key={f} sx={{ display: "contents" }}>
              <Box role="rowheader" sx={{ ...cell, display: "flex", alignItems: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  {LABELS[f] ?? humanize(f)}
                </Typography>
              </Box>
              {(["a", "b"] as const).map((s) => {
                const value = display(entity, pair[s], f);
                return (
                  <Box role="cell" key={s} sx={{ ...cell, bgcolor: picks[f] === s ? t.surfaceHover : "transparent" }}>
                    {same ? (
                      <Typography variant="body2" sx={{ overflowWrap: "anywhere", color: value ? "text.primary" : "text.disabled" }}>
                        {value || "—"}
                      </Typography>
                    ) : (
                      <FormControlLabel
                        sx={{ m: 0, alignItems: "flex-start", "& .MuiFormControlLabel-label": { overflowWrap: "anywhere", pt: 1 } }}
                        control={
                          <Radio
                            size="small"
                            checked={picks[f] === s}
                            onChange={() => setPicks((p) => ({ ...p, [f]: s }))}
                            inputProps={{ "aria-label": `${LABELS[f] ?? f}: use ${value || "empty"} from ${recordName(entity, pair[s])}` }}
                          />
                        }
                        label={<Typography variant="body2">{value || "—"}</Typography>}
                      />
                    )}
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>
      {hubConflict && <Typography variant="caption">Merging is disabled until the Hub link conflict is resolved.</Typography>}
    </FormDialog>
  );
}
