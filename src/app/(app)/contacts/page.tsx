import { ContactsView } from "@/components/contacts/ContactsView";
import { usersById, visibleAccounts, visibleContacts } from "@/lib/services/core";
import { canManageDataQuality } from "@/lib/auth/permissions";
import { ctx } from "@/lib/services/context";
import { contactDuplicates } from "@/lib/services/dedupe";

export const metadata = { title: "Contacts" };

export default async function ContactsPage() {
  const c = await ctx("/contacts");
  const [contacts, accounts, users, duplicates] = await Promise.all([
    visibleContacts(c),
    visibleAccounts(c),
    usersById(c),
    canManageDataQuality(c.user) ? contactDuplicates(c) : null,
  ]);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  return (
    <ContactsView
      rows={contacts.map((x) => ({
        ...x,
        account_name: acc.get(x.account_id)?.name ?? "",
        account_type: acc.get(x.account_id)?.type ?? "private",
        owner_name: users.get(x.owner_id)?.full_name ?? "—",
      }))}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      duplicates={duplicates?.length}
    />
  );
}
