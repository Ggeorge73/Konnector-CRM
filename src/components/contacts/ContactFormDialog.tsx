"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createContactAction, updateContactAction } from "@/app/actions/core";
import { FormDialog } from "@/components/common/FormDialog";
import { Select, Text } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { BUYING_ROLES, type Contact } from "@/lib/domain/types";
import type { ContactInputT } from "@/lib/services/core";

export function ContactFormDialog({
  open,
  onClose,
  accounts,
  defaultAccountId,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  accounts: Array<{ id: string; name: string }>;
  defaultAccountId?: string;
  contact?: Contact;
}) {
  const router = useRouter();
  const [v, setV] = useState<ContactInputT>(
    contact
      ? {
          account_id: contact.account_id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          title: contact.title ?? "",
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          role_in_buying: contact.role_in_buying,
        }
      : { account_id: defaultAccountId ?? "", first_name: "", last_name: "", title: "", email: "", phone: "", role_in_buying: null },
  );
  const set = <K extends keyof ContactInputT>(k: K, val: ContactInputT[K]) => setV((x) => ({ ...x, [k]: val }));
  const create = useAction(createContactAction, {
    success: "Contact added",
    onSuccess: (ct) => (defaultAccountId ? onClose() : router.push(`/contacts/${ct.id}`)),
  });
  const update = useAction(updateContactAction, { success: "Contact updated", onSuccess: onClose });
  const act = contact ? update : create;
  const e = act.fieldErrors;
  return (
    <FormDialog
      open={open}
      title={contact ? "Edit contact" : "New contact"}
      onClose={onClose}
      pending={act.pending}
      onSubmit={() => (contact ? update.exec(contact.id, v) : create.exec(v))}
      submitLabel={contact ? "Save" : "Add contact"}
    >
      <Select
        label="Account"
        value={v.account_id}
        onChange={(x) => set("account_id", x)}
        options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        error={e.account_id}
        disabled={!!defaultAccountId || !!contact}
      />
      <Text label="First name" required value={v.first_name} onChange={(x) => set("first_name", x)} error={e.first_name} autoFocus />
      <Text label="Last name" required value={v.last_name} onChange={(x) => set("last_name", x)} error={e.last_name} />
      <Text label="Title" value={v.title} onChange={(x) => set("title", x)} />
      <Text label="Email" type="email" value={v.email as string} onChange={(x) => set("email", x)} error={e.email} />
      <Text label="Phone" value={v.phone} onChange={(x) => set("phone", x)} />
      <Select
        label="Role in buying"
        value={v.role_in_buying ?? ""}
        onChange={(x) => set("role_in_buying", (x || null) as ContactInputT["role_in_buying"])}
        options={BUYING_ROLES}
        allowEmpty="Unknown"
      />
    </FormDialog>
  );
}
