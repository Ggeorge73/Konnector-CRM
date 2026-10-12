import { MemoryStore } from "@/lib/data/memory-store";
import { buildSeed, SEED_USERS } from "@/lib/data/seed";
import type { Ctx } from "@/lib/services/context-types";

export const NOW = new Date("2026-10-12T15:00:00Z");

/** Fresh seeded store + a context for the given seed user. */
export async function asUser(key: keyof typeof SEED_USERS, store = new MemoryStore(buildSeed(NOW))): Promise<Ctx & { store: MemoryStore }> {
  const user = (await store.get("users", SEED_USERS[key]))!;
  return { user, store, now: NOW };
}

export async function switchUser(c: Ctx & { store: MemoryStore }, key: keyof typeof SEED_USERS) {
  return asUser(key, c.store);
}
