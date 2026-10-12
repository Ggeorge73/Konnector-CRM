import { headers } from "next/headers";
import { AppShell } from "@/components/shell/AppShell";
import { unreadCount } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const c = await ctx((await headers()).get("x-pathname") ?? undefined);
  const { id, full_name, email, role, avatar_color } = c.user;
  return (
    <AppShell user={{ id, full_name, email, role, avatar_color }} unread={await unreadCount(c)}>
      {children}
    </AppShell>
  );
}
