import "server-only";
import { env } from "@/config/app";
import { MemoryStore } from "@/lib/data/memory-store";
import { buildSeed } from "@/lib/data/seed";
import type { Store } from "@/lib/data/store";
import { SupabaseStore } from "@/lib/data/supabase-store";
import { supabaseServer } from "@/lib/supabase/server";

const g = globalThis as unknown as { __kcrmStore?: MemoryStore };

/** The demo store lives for the life of the server process (reset with POST /api/dev/reset). */
export function demoStore(): MemoryStore {
  if (!g.__kcrmStore) g.__kcrmStore = new MemoryStore(buildSeed());
  return g.__kcrmStore;
}

export function resetDemoStore() {
  g.__kcrmStore = new MemoryStore(buildSeed());
}

export async function getStore(): Promise<Store> {
  if (env.dataBackend === "supabase") return new SupabaseStore(await supabaseServer());
  return demoStore();
}
