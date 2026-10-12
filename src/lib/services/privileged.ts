import { env } from "@/config/app";
import type { Store } from "@/lib/data/store";
import type { Ctx } from "./context-types";

/**
 * Store for tables whose secret columns `authenticated` may not read (api_keys.key_hash,
 * webhook_subscriptions.secret_enc): the service role in Supabase mode, the caller's store
 * otherwise. Callers MUST scope by c.user themselves — RLS does not apply to this store.
 */
export async function privilegedStore(c: Ctx): Promise<Store> {
  if (env.dataBackend !== "supabase") return c.store;
  const { systemStore } = await import("@/lib/server/system-store");
  return systemStore();
}
