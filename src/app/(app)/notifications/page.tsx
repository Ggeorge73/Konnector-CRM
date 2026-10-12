import { NotificationsView } from "@/components/work/NotificationsView";
import { myNotifications } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const c = await ctx("/notifications");
  return <NotificationsView items={await myNotifications(c)} />;
}
