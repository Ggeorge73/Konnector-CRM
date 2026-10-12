import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/config/app";
import type { Store } from "@/lib/data/store";
import { SupabaseStore } from "@/lib/data/supabase-store";
import { demoStore } from "@/lib/server/store";

/**
 * Store for REST API v1 requests.
 *
 * - Demo backend: the shared in-memory demo store.
 * - Supabase: a SERVICE-ROLE client. API keys aren't Supabase sessions, so there is no user JWT
 *   for RLS to check. Every read and write therefore goes through the service layer
 *   (src/lib/api/resources.ts → src/lib/services/*), which scopes and redacts for the key's
 *   user exactly as the UI does. Never query this store directly from a route handler.
 */
export function apiStore(): Store {
  if (env.dataBackend === "supabase") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the REST API in Supabase mode");
    return new SupabaseStore(createClient(url, key, { auth: { persistSession: false } }));
  }
  return demoStore();
}
