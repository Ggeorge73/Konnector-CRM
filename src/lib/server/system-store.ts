import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/config/app";
import type { Store } from "@/lib/data/store";
import { SupabaseStore } from "@/lib/data/supabase-store";
import { demoStore } from "./store";

/** Store for webhooks/cron: service role in Supabase mode (bypasses RLS), demo store otherwise. */
export function systemStore(): Store {
  if (env.dataBackend === "supabase") {
    return new SupabaseStore(
      createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
    );
  }
  return demoStore();
}
