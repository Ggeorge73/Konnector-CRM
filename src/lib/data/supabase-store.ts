import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewRow, Row, TableName } from "@/lib/domain/types";
import type { ListOptions, Store } from "./store";

/**
 * Supabase-backed store. Runs with the signed-in user's JWT so Postgres RLS
 * is the final authority on what each role can read or write.
 */
/** Columns readable on quote_lines without cost (unit_cost is never selectable on the table — see docs/DATABASE.md). */
const QUOTE_LINE_COLS =
  "id,created_at,updated_at,created_by,archived_at,quote_id,position,item,description,qty,unit_price,oem_partner_account_id";

export class SupabaseStore implements Store {
  constructor(private client: SupabaseClient) {}

  /**
   * quote_lines: read via quote_lines_client, then fill unit_cost from quote_lines_internal for
   * the rows this user may see cost on (leaders, quote owner). Others get unit_cost = null.
   */
  private async quoteLines(opts?: ListOptions<"quote_lines">) {
    let q = this.client.from("quote_lines_client").select(QUOTE_LINE_COLS);
    if (!opts?.includeArchived) q = q.is("archived_at", null);
    for (const [k, v] of Object.entries(opts?.where ?? {})) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v as string);
    const { data, error } = await q.order(opts?.orderBy?.column ?? "position", { ascending: opts?.orderBy?.ascending ?? true });
    if (error) throw new Error(`quote_lines: ${error.message}`);
    const ids = (data ?? []).map((r) => (r as unknown as { id: string }).id);
    const cost = new Map<string, number>();
    if (ids.length) {
      const { data: internal } = await this.client.from("quote_lines_internal").select("id,unit_cost").in("id", ids);
      for (const r of internal ?? []) cost.set(r.id as string, Number(r.unit_cost));
    }
    return (data ?? []).map((r) => {
      const row = r as unknown as Row<"quote_lines">;
      return { ...row, unit_cost: (cost.get(row.id) ?? null) as unknown as number };
    });
  }

  async list<T extends TableName>(table: T, opts?: ListOptions<T>): Promise<Row<T>[]> {
    if (table === "quote_lines") return (await this.quoteLines(opts as ListOptions<"quote_lines">)) as Row<T>[];
    const rows = await this.listFrom(table, table, opts).catch(async (e: Error) => {
      // Delivery leads read the bench through the cost-free view.
      if (table === "consultants" && /permission denied/.test(e.message)) return this.listFrom(table, "consultants_public", opts);
      throw e;
    });
    return rows;
  }

  private async listFrom<T extends TableName>(table: T, source: string, opts?: ListOptions<T>): Promise<Row<T>[]> {
    let q = this.client.from(source).select("*");
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
    if (table === "quote_lines" || table === "consultants") {
      const [row] = await this.list(table, { where: { id } as never, includeArchived: true });
      return row ?? null;
    }
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
    return (
      table === "quote_lines" ? { ...(data as object), unit_cost: (row as { unit_cost?: number }).unit_cost ?? null } : data
    ) as Row<T>;
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
