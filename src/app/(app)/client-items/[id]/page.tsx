import { notFound } from "next/navigation";
import { ClientItemDetail } from "@/components/client-items/ClientItemDetail";
import { env, isDemo } from "@/config/app";
import { ForbiddenError } from "@/lib/auth/errors";
import { isLeader } from "@/lib/auth/permissions";
import { clientPayload, getClientItem } from "@/lib/services/client-items";
import { usersById } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { timelineItems } from "@/lib/services/records";

export default async function ClientItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx("/client-items");
  const { item, versions } = await getClientItem(c, id).catch((e) => {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  });
  const [account, users, timeline] = await Promise.all([
    c.store.get("accounts", item.account_id),
    usersById(c),
    timelineItems(c, "client_item", id),
  ]);
  const previous = versions.find((v) => v.version < item.version && v.status !== "draft") ?? null;
  const preview = item.konnect_hub_client_id ? await clientPayload(c, item, previous) : null;
  return (
    <ClientItemDetail
      item={item}
      versions={versions.map((v) => ({ id: v.id, version: v.version, status: v.status, published_at: v.published_at }))}
      accountName={account?.name ?? ""}
      ownerName={users.get(item.owner_id)?.full_name ?? "—"}
      preview={preview}
      timeline={timeline}
      canManage={isLeader(c.user) || item.owner_id === c.user.id}
      simulate={env.mockKonnectHub && (isDemo() || process.env.NODE_ENV !== "production")}
    />
  );
}
