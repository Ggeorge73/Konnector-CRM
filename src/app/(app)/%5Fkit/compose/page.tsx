import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isDemo } from "@/config/app";
import { ComposeEmailButton } from "@/components/mail/ComposeEmailButton";
import { ctx } from "@/lib/services/context";
import { visibleContacts } from "@/lib/services/core";
import { mailStatus } from "@/lib/services/mail";

export const metadata = { title: "Compose email (dev)" };

/** Dev-only harness for ComposeEmailButton: /_kit/compose?contact=<id>. Demo backend only. */
export default async function ComposeKitPage({ searchParams }: { searchParams: Promise<{ contact?: string }> }) {
  if (!isDemo()) notFound();
  const c = await ctx("/_kit");
  const { contact: id } = await searchParams;
  const contacts = await visibleContacts(c);
  const contact = contacts.find((x) => x.id === id) ?? contacts.find((x) => !!x.email);
  if (!contact) notFound();
  const colleagues = contacts.filter((x) => x.account_id === contact.account_id);
  const status = await mailStatus(c);
  return (
    <Stack spacing={3} alignItems="flex-start">
      <Typography variant="h2" component="h1">
        Compose harness
      </Typography>
      <Typography color="text.secondary">
        Emailing <Link href={`/contacts/${contact.id}`}>{`${contact.first_name} ${contact.last_name}`}</Link>
        {status.email ? ` from ${status.email}` : " — no mailbox connected"}
      </Typography>
      <ComposeEmailButton
        relatedType="contact"
        relatedId={contact.id}
        accountId={contact.account_id}
        recipients={colleagues.map((x) => ({ id: x.id, name: `${x.first_name} ${x.last_name}`, email: x.email }))}
        defaultTo={[contact.id]}
        hasConnection={status.hasConnection}
      />
    </Stack>
  );
}
