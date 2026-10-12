import { notFound } from "next/navigation";
import { ConsultantDetail } from "@/components/bench/ConsultantDetail";
import { ForbiddenError } from "@/lib/auth/errors";
import { canEditBench, canSeeConsultantCost } from "@/lib/auth/permissions";
import { getConsultant } from "@/lib/services/bench";
import { recordView } from "@/lib/services/core";
import { ctx } from "@/lib/services/context";
import { filesFor } from "@/lib/services/files";
import { peopleNames, timelineItems } from "@/lib/services/records";

export default async function ConsultantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ctx("/bench");
  const consultant = await getConsultant(c, id).catch((e) => {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  });
  await recordView(c, "consultant", id, consultant.full_name);
  const [timeline, files, people] = await Promise.all([timelineItems(c, "consultant", id), filesFor(c, "consultant", id), peopleNames(c)]);
  return (
    <ConsultantDetail
      consultant={consultant}
      timeline={timeline}
      files={files}
      people={people}
      currentUserId={c.user.id}
      canEdit={canEditBench(c.user)}
      canSeeCost={canSeeConsultantCost(c.user)}
    />
  );
}
