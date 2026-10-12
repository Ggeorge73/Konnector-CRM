import type { Store } from "@/lib/data/store";
import type { User } from "@/lib/domain/types";

export interface Ctx {
  user: User;
  store: Store;
  now: Date;
}
