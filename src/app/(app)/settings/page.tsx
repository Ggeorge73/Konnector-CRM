import { SettingsView } from "@/components/settings/SettingsView";
import { orgSettings } from "@/lib/services/pulse";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const c = await ctx("/settings");
  return <SettingsView settings={await orgSettings(c)} />;
}
