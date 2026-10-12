import { notFound } from "next/navigation";
import { QuoteDetail } from "@/components/quotes/QuoteDetail";
import { ForbiddenError } from "@/lib/auth/errors";
import { canApprove, canEditOpportunity } from "@/lib/auth/permissions";
import { getOpportunity, getQuote } from "@/lib/services/capture";
import { recordView, usersById, visibleAccounts } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { orgSettings } from "@/lib/services/pulse";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx("/quotes");
  const q = await getQuote(c, id).catch((e) => {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  });
  const [o, settings, users, accounts] = await Promise.all([
    getOpportunity(c, q.opportunity_id),
    orgSettings(c),
    usersById(c),
    visibleAccounts(c),
  ]);
  await recordView(c, "quote", id, `${q.number} ${q.title}`);
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  return (
    <QuoteDetail
      quote={q}
      opportunity={{ id: o.id, name: o.name }}
      accountName={acc.get(q.account_id) ?? ""}
      partnerNames={Object.fromEntries(accounts.map((a) => [a.id, a.name]))}
      partners={accounts
        .filter((a) => a.type === "oem_vendor" || a.type === "partner_subcontractor")
        .map((a) => ({ id: a.id, name: a.name }))}
      ownerName={users.get(q.owner_id)?.full_name ?? "—"}
      approverName={q.approved_by ? (users.get(q.approved_by)?.full_name ?? null) : null}
      marginFloor={settings.margin_floor_pct}
      canEdit={canEditOpportunity(c.user, o) && q.canSeeCost}
      canApprove={canApprove(c.user)}
    />
  );
}
