import { DuplicatesView } from "@/components/dedupe/DuplicatesView";
import { ctx } from "@/lib/services/context";
import { accountDuplicates, contactDuplicates, listDismissals } from "@/lib/services/dedupe";

export const metadata = { title: "Duplicates" };

export default async function DuplicatesPage() {
  const c = await ctx("/duplicates");
  const [accounts, contacts, dismissedAccounts, dismissedContacts, accountRows, contactRows] = await Promise.all([
    accountDuplicates(c),
    contactDuplicates(c),
    listDismissals(c, "accounts"),
    listDismissals(c, "contacts"),
    c.store.list("accounts", { includeArchived: true }),
    c.store.list("contacts", { includeArchived: true }),
  ]);
  const names = new Map<string, string>([
    ...accountRows.map((a) => [a.id, a.name] as [string, string]),
    ...contactRows.map((x) => [x.id, `${x.first_name} ${x.last_name}`] as [string, string]),
  ]);
  const dismissed = [...dismissedAccounts, ...dismissedContacts].map((d) => ({
    id: d.id,
    entity: d.entity,
    label: `${names.get(d.record_a) ?? "Unknown"} and ${names.get(d.record_b) ?? "Unknown"}`,
    created_at: d.created_at,
  }));
  return <DuplicatesView accounts={accounts} contacts={contacts} dismissed={dismissed} />;
}
