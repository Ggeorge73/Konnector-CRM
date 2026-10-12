"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createAccountAction, updateAccountAction } from "@/app/actions/core";
import { FormDialog } from "@/components/common/FormDialog";
import { Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { ACCOUNT_STATUSES, ACCOUNT_TYPES, type Account } from "@/lib/domain/types";
import type { AccountInputT } from "@/lib/services/core";

const EMPTY: AccountInputT = {
  name: "",
  type: "government_state",
  sector: "",
  country: "US",
  state_region: "GA",
  city: "",
  website: "",
  tier: "B",
  status: "prospect",
  description: "",
};

export function AccountFormDialog({
  open,
  onClose,
  account,
  owners,
  canAssign,
}: {
  open: boolean;
  onClose: () => void;
  account?: Account;
  owners: Array<{ id: string; name: string }>;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<AccountInputT>(
    account
      ? {
          name: account.name,
          type: account.type,
          sector: account.sector,
          country: account.country,
          state_region: account.state_region ?? "",
          city: account.city ?? "",
          website: account.website ?? "",
          tier: account.tier,
          status: account.status,
          owner_id: account.owner_id,
          description: account.description ?? "",
        }
      : EMPTY,
  );
  const set = <K extends keyof AccountInputT>(k: K, val: AccountInputT[K]) => setV((x) => ({ ...x, [k]: val }));
  const create = useAction(createAccountAction, { success: "Account created", onSuccess: (a) => router.push(`/accounts/${a.id}`) });
  const update = useAction(updateAccountAction, { success: "Account updated", onSuccess: onClose });
  const act = account ? update : create;
  const e = act.fieldErrors;

  return (
    <FormDialog
      open={open}
      title={account ? "Edit account" : "New account"}
      onClose={onClose}
      onSubmit={() => (account ? update.exec(account.id, v) : create.exec(v))}
      pending={act.pending}
      submitLabel={account ? "Save" : "Create account"}
    >
      <Text label="Name" required value={v.name} onChange={(x) => set("name", x)} error={e.name} autoFocus />
      <Select label="Type" value={v.type} onChange={(x) => set("type", x)} options={ACCOUNT_TYPES} error={e.type} />
      <Text
        label="Sector"
        required
        value={v.sector}
        onChange={(x) => set("sector", x)}
        error={e.sector}
        placeholder="e.g. Public sector IT"
      />
      <Text label="Country (2-letter)" value={v.country} onChange={(x) => set("country", x)} error={e.country} />
      <Text label="State / region" value={v.state_region} onChange={(x) => set("state_region", x)} />
      <Text label="City" value={v.city} onChange={(x) => set("city", x)} />
      <Text label="Website" value={v.website as string} onChange={(x) => set("website", x)} error={e.website} placeholder="https://" />
      <Select label="Tier" value={v.tier} onChange={(x) => set("tier", x)} options={["A", "B", "C"] as const} />
      <Select label="Status" value={v.status} onChange={(x) => set("status", x)} options={ACCOUNT_STATUSES} />
      {canAssign && (
        <Select
          label="Owner"
          value={v.owner_id ?? ""}
          onChange={(x) => set("owner_id", x)}
          options={owners.map((o) => ({ value: o.id, label: o.name }))}
          allowEmpty="Me"
        />
      )}
      <Text label="Description" multiline minRows={2} value={v.description} onChange={(x) => set("description", x)} />
    </FormDialog>
  );
}
