import Stack from "@mui/material/Stack";
import { SettingsView } from "@/components/settings/SettingsView";
import { TeamCard } from "@/components/settings/TeamCard";
import { orgSettings } from "@/lib/services/pulse";
import { ctx } from "@/lib/services/context";
import { teamMembers } from "@/lib/services/users";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const c = await ctx("/settings");
  const [settings, members] = await Promise.all([orgSettings(c), teamMembers(c)]);
  return (
    <Stack spacing={4}>
      <SettingsView settings={settings} />
      <TeamCard members={members} />
    </Stack>
  );
}
