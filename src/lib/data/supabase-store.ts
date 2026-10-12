import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewRow, Row, TableName } from "@/lib/domain/types";
import type { ListOptions, Store } from "./store";

/**
 * Supabase-backed store. Runs with the signed-in user's JWT so Postgres RLS
 * is the final authority on what each role can read or write.
 */
export class SupabaseStore implements Store {
  constructor(private client: SupabaseClient) {}

  async list<T extends TableName>(table: T, opts?: ListOptions<T>): Promise<Row<T>[]> {
    let q = this.client.from(table).select("*");
    if (!opts?.includeArchived) q = q.is("archived_at", null);
    for (const [k, v] of Object.entries(opts?.where ?? {})) {
      q = Array.isArray(v) ? q.in(k, v) : v === null ? q.is(k, null) : q.eq(k, v as string);
    }
    if (opts?.orderBy) q = q.order(opts.orderBy.column, { ascending: opts.orderBy.ascending ?? true });
    if (opts?.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as Row<T>[];
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const { data, error } = await this.client.from(table).select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as Row<T>) ?? null;
  }

  async insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>> {
    const { data, error } = await this.client
      .from(table)
      .insert(row as never)
      .select("*")
      .single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as Row<T>;
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>> {
    const { data, error } = await this.client
      .from(table)
      .update(patch as never)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as Row<T>;
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    const { error } = await this.client.from(table).delete().eq("id", id);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
