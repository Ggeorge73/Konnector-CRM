"use server";
import { run } from "@/lib/services/action";
import { draftFromQuote, draftItem, publishItem, reviseItem, withdrawItem, type ItemInputT } from "@/lib/services/client-items";
import type { ClientItem } from "@/lib/domain/types";

export async function draftFromQuoteAction(quoteId: string, input: { respond_by?: string | null; summary?: string | null }) {
  return run((c) => draftFromQuote(c, quoteId, input), ["/client-items", `/quotes/${quoteId}`]);
}
export async function draftItemAction(input: ItemInputT) {
  return run((c) => draftItem(c, input), ["/client-items"]);
}
export async function publishItemAction(id: string) {
  return run((c) => publishItem(c, id), ["/client-items", `/client-items/${id}`, "/"]);
}
export async function withdrawItemAction(id: string, reason: string | null) {
  return run((c) => withdrawItem(c, id, reason), ["/client-items", `/client-items/${id}`]);
}
export async function reviseItemAction(
  id: string,
  patch: Partial<Pick<ClientItem, "title" | "summary" | "amount" | "lines" | "terms" | "respond_by" | "new_end_date">>,
) {
  return run((c) => reviseItem(c, id, patch), ["/client-items"]);
}
