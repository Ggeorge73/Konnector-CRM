"use server";
import { run } from "@/lib/services/action";
import {
  dismissDuplicate,
  mergeAccounts,
  mergeContacts,
  undoDismissal,
  type DismissInputT,
  type MergeAccountsInputT,
  type MergeContactsInputT,
} from "@/lib/services/dedupe";

const PATHS = ["/duplicates", "/data-quality", "/accounts", "/contacts"];

export async function mergeAccountsAction(input: MergeAccountsInputT) {
  return run(
    async (c) => {
      const r = await mergeAccounts(c, input);
      return { survivor_id: r.survivor.id, repointed: r.repointed };
    },
    [...PATHS, `/accounts/${input.survivor_id}`],
  );
}
export async function mergeContactsAction(input: MergeContactsInputT) {
  return run(
    async (c) => {
      const r = await mergeContacts(c, input);
      return { survivor_id: r.survivor.id, repointed: r.repointed };
    },
    [...PATHS, `/contacts/${input.survivor_id}`],
  );
}
export async function dismissDuplicateAction(input: DismissInputT) {
  return run((c) => dismissDuplicate(c, input), PATHS);
}
export async function undoDismissalAction(id: string) {
  return run((c) => undoDismissal(c, id), PATHS);
}
