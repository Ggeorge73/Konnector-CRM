import { RegistrationsView } from "@/components/compliance/RegistrationsView";
import { registrationsData } from "@/lib/services/compliance";
import { ctx } from "@/lib/services/context";

export const metadata = { title: "Registrations" };

export default async function RegistrationsPage() {
  const c = await ctx("/registrations");
  const data = await registrationsData(c);
  return <RegistrationsView rows={data.rows} counts={data.counts} canManage={data.canManage} />;
}
