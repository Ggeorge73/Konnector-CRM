import type { NewRow, Row, TableName, Tables } from "@/lib/domain/types";
import { matches, type ListOptions, type Store } from "./store";

export type Dataset = { [T in TableName]: Row<T>[] };

export function emptyDataset(): Dataset {
  const names: TableName[] = [
    "organizations",
    "users",
    "accounts",
    "contacts",
    "activities",
    "tasks",
    "files",
    "tags",
    "record_tags",
    "saved_views",
    "notifications",
    "mentions",
    "recent_views",
    "audit_log",
    "opportunities",
    "bid_decisions",
    "quotes",
    "quote_lines",
    "registrations",
    "partner_vetting",
    "consultants",
    "events",
    "event_leads",
    "handoffs",
    "project_health",
    "client_items",
    "integration_events",
    "copilot_runs",
    "mail_connections",
    "synced_messages",
    "api_keys",
    "webhook_subscriptions",
    "webhook_deliveries",
  ];
  return Object.fromEntries(names.map((n) => [n, []])) as unknown as Dataset;
}

const clone = <V>(v: V): V => structuredClone(v);

/** In-memory store used for the demo backend, unit tests and Playwright. */
export class MemoryStore implements Store {
  /** Bumped on every write; the demo "live updates" poller compares it. */
  version = 0;
  constructor(private data: Dataset = emptyDataset()) {}

  async list<T extends TableName>(table: T, opts?: ListOptions<T>): Promise<Row<T>[]> {
    let rows = (this.data[table] as Row<T>[]).filter((r) => matches(r, opts));
    if (opts?.orderBy) {
      const { column, ascending = true } = opts.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a[column] as unknown as string | number | null;
        const bv = b[column] as unknown as string | number | null;
        if (av === bv) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (opts?.limit) rows = rows.slice(0, opts.limit);
    return clone(rows);
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const row = (this.data[table] as Row<T>[]).find((r) => r.id === id);
    return row ? clone(row) : null;
  }

  async insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>> {
    const now = new Date().toISOString();
    const full = {
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      created_by: null,
      archived_at: null,
      ...row,
    } as Row<T>;
    (this.data[table] as Row<T>[]).push(clone(full));
    this.version++;
    return clone(full);
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>> {
    const rows = this.data[table] as Row<T>[];
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`${table} ${id} not found`);
    rows[idx] = { ...rows[idx], ...clone(patch), id, updated_at: new Date().toISOString() };
    this.version++;
    return clone(rows[idx]);
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    const rows = this.data[table] as Row<T>[];
    const idx = rows.findIndex((r) => r.id === id);
    if (idx >= 0) rows.splice(idx, 1);
    this.version++;
  }

  /** Test helper: direct access to a table. */
  raw<T extends TableName>(table: T): Tables[T][] {
    return this.data[table] as Tables[T][];
  }
}
