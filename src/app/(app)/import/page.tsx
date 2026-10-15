import { ImportView } from "@/components/import/ImportView";
import { canImport, isLeader } from "@/lib/auth/permissions";
import { IMPORT_ENTITIES, type ImportEntity } from "@/lib/domain/types";
import { ctx } from "@/lib/services/context";
import { usersById } from "@/lib/services/core";
import { listImportBatches } from "@/lib/services/imports";
import { orgSettings } from "@/lib/services/pulse";

export const metadata = { title: "Import" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const c = await ctx("/import");
  const [{ type }, batches, users, settings] = await Promise.all([searchParams, listImportBatches(c), usersById(c), orgSettings(c)]);
  const entities = IMPORT_ENTITIES.filter((e) => canImport(c.user, e));
  const initial = entities.includes(type as ImportEntity) ? (type as ImportEntity) : entities[0];
  return (
    <ImportView
      entities={entities}
      initialEntity={initial}
      batches={batches}
      stages={settings.stages.map((s) => ({ key: s.key, label: s.label }))}
      me={{ id: c.user.id, name: c.user.full_name }}
      owners={isLeader(c.user) ? [...users.values()].map((u) => ({ id: u.id, name: u.full_name })) : null}
    />
  );
}
