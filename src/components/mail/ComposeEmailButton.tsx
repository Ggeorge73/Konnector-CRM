"use client";
import SendOutlined from "@mui/icons-material/SendOutlined";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button, { type ButtonProps } from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useEffect, useState } from "react";
import { mailStatusAction, sendEmailAction } from "@/app/actions/mail";
import { FormDialog } from "@/components/common/FormDialog";
import { Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";

export interface ComposeRecipient {
  id: string;
  name: string;
  email: string | null;
}

export interface ComposeEmailButtonProps {
  relatedType: "account" | "contact" | "opportunity";
  relatedId: string;
  /** The record's account (for display only — the server derives it from the record). */
  accountId?: string | null;
  /** Contacts that may be addressed. Those without an email are hidden. */
  recipients: ComposeRecipient[];
  /** Pre-selected "To" contact ids. Defaults to the only recipient when there is exactly one. */
  defaultTo?: string[];
  defaultSubject?: string;
  /** e.g. a Copilot-drafted follow-up. */
  defaultBody?: string;
  /** Pass when known server-side; otherwise the button asks the server. */
  hasConnection?: boolean;
  /** Opens the dialog immediately (e.g. after Copilot drafts a follow-up). */
  defaultOpen?: boolean;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  onSent?: () => void;
}

/** "Email" from a record: sends from the user's own connected mailbox and logs it to the timeline. */
export function ComposeEmailButton({
  relatedType,
  relatedId,
  recipients,
  defaultTo,
  defaultSubject = "",
  defaultBody = "",
  hasConnection,
  defaultOpen = false,
  label = "Send email",
  variant = "outlined",
  size,
  onSent,
}: ComposeEmailButtonProps) {
  const [connected, setConnected] = useState<boolean | undefined>(hasConnection);
  const [open, setOpen] = useState(false);
  const options = recipients.filter((r): r is ComposeRecipient & { email: string } => !!r.email);
  const initialTo = () => defaultTo ?? (options.length === 1 ? [options[0]!.id] : []);
  const [to, setTo] = useState<string[]>(initialTo);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);

  useEffect(() => setConnected(hasConnection), [hasConnection]);
  useEffect(() => {
    if (hasConnection !== undefined) return;
    let live = true;
    mailStatusAction().then((r) => live && setConnected(r.ok ? r.data.hasConnection : false));
    return () => {
      live = false;
    };
  }, [hasConnection]);

  const show = () => {
    setTo(initialTo());
    setCc([]);
    setSubject(defaultSubject);
    setBody(defaultBody);
    setOpen(true);
  };
  useEffect(() => {
    if (defaultOpen && connected) show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpen, connected]);

  const send = useAction(sendEmailAction, {
    success: "Email sent and logged to the timeline",
    onSuccess: () => {
      setOpen(false);
      onSent?.();
    },
  });

  const picker = (id: string, lbl: string, value: string[], onChange: (v: string[]) => void, error?: string) => (
    <Autocomplete
      multiple
      id={id}
      options={options}
      value={options.filter((o) => value.includes(o.id))}
      onChange={(_, v) => onChange(v.map((o) => o.id))}
      getOptionLabel={(o) => `${o.name} <${o.email}>`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterSelectedOptions
      sx={id === "compose-to" ? { pt: 1 } : undefined}
      size="small"
      renderInput={(p) => <TextField {...p} label={lbl} error={!!error} helperText={error} />}
    />
  );

  const button = (
    <Button variant={variant} size={size} startIcon={<SendOutlined />} onClick={show} disabled={!connected}>
      {label}
    </Button>
  );

  return (
    <>
      {connected === false ? (
        <Tooltip
          title={
            <Box>
              Connect your mailbox to send from the CRM.{" "}
              <Typography component={Link} href="/connections" variant="inherit" sx={{ color: "inherit", fontWeight: 700 }}>
                Email & calendar →
              </Typography>
            </Box>
          }
          disableInteractive={false}
        >
          {/* A disabled button doesn't fire pointer events; the wrapper keeps the tooltip reachable. */}
          <Box component="span" tabIndex={0} sx={{ display: "inline-flex" }} aria-label="Send email (connect your mailbox first)">
            {button}
          </Box>
        </Tooltip>
      ) : (
        button
      )}
      <FormDialog
        open={open}
        title="Send email"
        subtitle="Sent from your connected mailbox and logged to this record's timeline"
        onClose={() => setOpen(false)}
        onSubmit={() => send.exec({ to, cc, subject, body, related_type: relatedType, related_id: relatedId })}
        submitLabel="Send"
        pending={send.pending}
        maxWidth="md"
      >
        {picker("compose-to", "To", to, setTo, send.fieldErrors.to)}
        {picker("compose-cc", "Cc", cc, (v) => setCc(v.filter((x) => !to.includes(x))))}
        <Text label="Subject" value={subject} onChange={setSubject} error={send.fieldErrors.subject} required />
        <Text label="Message" value={body} onChange={setBody} error={send.fieldErrors.body} multiline minRows={8} required />
      </FormDialog>
    </>
  );
}
