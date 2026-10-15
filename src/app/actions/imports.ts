"use server";
import { run } from "@/lib/services/action";
import { commitImport, previewImport, undoImport, type ImportRequestT } from "@/lib/services/imports";

const PATHS = ["/import", "/accounts", "/contacts", "/opportunities"];

/** Dry run: per-row preview, nothing written. */
export async function previewImportAction(req: ImportRequestT) {
  return run((c) => previewImport(c, req));
}

export async function commitImportAction(req: ImportRequestT) {
  return run(async (c) => {
    const { batch, preview } = await commitImport(c, req);
    return { batch, totals: preview.totals };
  }, PATHS);
}

export async function undoImportAction(batchId: string) {
  return run((c) => undoImport(c, batchId), PATHS);
}
