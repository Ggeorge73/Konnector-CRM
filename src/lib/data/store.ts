import type { DedupeEntity, NewRow, Role, Row, TableName } from "@/lib/domain/types";

export interface ListOptions<T extends TableName> {
  /** Equality filters. Array values mean "column in (...)". */
  where?: { [K in keyof Row<T>]?: Row<T>[K] | Row<T>[K][] };
  orderBy?: { column: keyof Row<T> & string; ascending?: boolean };
  limit?: number;
  includeArchived?: boolean;
}

/**
 * The persistence port. Services depend on this, never on a concrete backend,
 * so the seeded demo store and Supabase are interchangeable.
 */
export interface Store {
  list<T extends TableName>(table: T, opts?: ListOptions<T>): Promise<Row<T>[]>;
  get<T extends TableName>(table: T, id: string): Promise<Row<T> | null>;
  insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>>;
  /** Inserts several rows of one table in a single statement (all or none in Supabase). */
  insertMany<T extends TableName>(table: T, rows: NewRow<T>[]): Promise<Row<T>[]>;
  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>>;
  /** Hard delete — only for join rows (record_tags). Everything else archives. */
  remove<T extends TableName>(table: T, id: string): Promise<void>;
  /**
   * Merge two accounts or contacts in one transaction (KCRM-77): survivor takes `patch`,
   * everything pointing at the loser is re-pointed, the loser is archived, and a timeline entry and
   * audit row are written. Supabase: merge_accounts() / merge_contacts(). Memory: src/lib/data/merge.ts.
   */
  merge<E extends DedupeEntity>(entity: E, args: MergeArgs): Promise<MergeResult<E>>;
}

export interface MergeArgs {
  survivorId: string;
  loserId: string;
  /** Fields the survivor takes from the loser (only whitelisted keys are applied). */
  patch: Record<string, unknown>;
  /** The caller. Supabase ignores this and uses auth.uid(); MemoryStore applies the same is_leader() check. */
  actor: { id: string; org_id: string; full_name: string; role: Role | null };
  now: Date;
}

export interface MergeResult<E extends DedupeEntity> {
  survivor: Row<E>;
  /** Rows re-pointed per table. */
  repointed: Record<string, number>;
}

export function matches<T extends TableName>(row: Row<T>, opts?: ListOptions<T>): boolean {
  if (!opts?.includeArchived && row.archived_at) return false;
  const where = opts?.where;
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    const actual = (row as unknown as Record<string, unknown>)[k];
    return Array.isArray(v) ? v.includes(actual) : actual === v;
  });
}
