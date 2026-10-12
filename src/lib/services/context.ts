import "server-only";
import { requireUser } from "@/lib/auth/session";
import type { Ctx } from "./context-types";
import { getStore } from "@/lib/server/store";

export async function ctx(pathname?: string): Promise<Ctx> {
  const user = await requireUser(pathname);
  return { user, store: await getStore(), now: new Date() };
}

export type { Ctx };
