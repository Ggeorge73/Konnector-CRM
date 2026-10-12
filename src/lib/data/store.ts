import type { NewRow, Row, TableName } from "@/lib/domain/types";

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
  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>>;
  /** Hard delete — only for join rows (record_tags). Everything else archives. */
  remove<T extends TableName>(table: T, id: string): Promise<void>;
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
