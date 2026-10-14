import type { Store } from "@/lib/data/store";
import type { ActiveUser } from "@/lib/domain/types";

export interface Ctx {
  /** Always a user with a role: pending users are stopped in requireUser() / authenticateApiKey(). */
  user: ActiveUser;
  store: Store;
  now: Date;
}
