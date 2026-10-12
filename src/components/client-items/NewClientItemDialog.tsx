"use client";
import Alert from "@mui/material/Alert";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { draftItemAction } from "@/app/actions/client-items";
import { FormDialog } from "@/components/common/FormDialog";
import { DateField, NumberField, Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";

export interface HubAccount {
  id: string;
  name: string;
  projects: Array<{ id: string; name: string; end_date: string | null }>;
}

export function NewClientItemDialog({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: HubAccount[] }) {
  const router = useRouter();
  const [type, setType] = useState<"renewal_offer" | "contract_amendment" | "survey">("renewal_offer");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [terms, setTerms] = useState("");
  const [newEnd, setNewEnd] = useState<string | null>(null);
  const [respondBy, setRespondBy] = useState<string | null>(new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
  const act = useAction(draftItemAction, {
    success: "Draft created — preview it before publishing",
    onSuccess: (i) => router.push(`/client-items/${i.id}`),
  });
  const projects = accounts.find((a) => a.id === accountId)?.projects ?? [];
  const e = act.fieldErrors;
  return (
    <FormDialog
      open={open}
      title="New client item"
      subtitle="Drafts stay internal until someone clicks Publish."
      onClose={onClose}
      pending={act.pending}
      submitLabel="Create draft"
      onSubmit={() =>
        act.exec({
          type,
          account_id: accountId,
          konnect_hub_project_id: projectId || null,
          title,
          summary: summary || null,
          amount: type === "survey" ? null : amount,
          terms: terms || null,
          new_end_date: newEnd,
          respond_by: respondBy,
          lines: [],
        })
      }
    >
      {accounts.length === 0 && (
        <Alert severity="info">Client items can be sent once an account is a Konnect Hub client (after its first handoff).</Alert>
      )}
      <Select
        label="Type"
        value={type}
        onChange={setType}
        options={[
          { value: "renewal_offer", label: "Renewal offer" },
          { value: "contract_amendment", label: "Contract amendment" },
          { value: "survey", label: "Satisfaction survey" },
        ]}
      />
      <Select
        label="Client"
        value={accountId}
        onChange={(v) => {
          setAccountId(v);
          setProjectId("");
        }}
        options={accounts.map((a) => ({ value: a.id, label: a.name }))}
      />
      <Select
        label="Project"
        value={projectId}
        onChange={setProjectId}
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
        allowEmpty={type === "survey" ? "Account-level" : "—"}
        error={e.konnect_hub_project_id}
      />
      <Text label="Title" value={title} onChange={setTitle} required error={e.title} />
      <Text label={type === "survey" ? "Question" : "Summary for the client"} value={summary} onChange={setSummary} multiline minRows={2} />
      {type !== "survey" && (
        <>
          <NumberField label="Amount (USD)" value={amount} onChange={setAmount} error={e.amount} />
          <DateField label="New end date" value={newEnd} onChange={setNewEnd} />
          <Text label="Terms" value={terms} onChange={setTerms} multiline minRows={2} />
        </>
      )}
      <DateField label="Respond by" value={respondBy} onChange={setRespondBy} />
    </FormDialog>
  );
}
