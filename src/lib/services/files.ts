import "server-only";
import { env } from "@/config/app";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import type { RelatedType } from "@/lib/domain/types";
import { supabaseServer } from "@/lib/supabase/server";
import type { Ctx } from "./context-types";
import { logActivity } from "./core";

const MAX_BYTES = 15 * 1024 * 1024;
const g = globalThis as unknown as { __kcrmBlobs?: Map<string, Uint8Array> };
const blobs = () => (g.__kcrmBlobs ??= new Map());

/** Upload to Supabase Storage (bucket "files") or the in-memory demo blob store. */
export async function uploadFile(c: Ctx, file: File, related_type: RelatedType, related_id: string, account_id: string | null) {
  if (file.size === 0) throw new ValidationError("The file is empty.");
  if (file.size > MAX_BYTES) throw new ValidationError("Files must be 15 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `${c.user.org_id}/${related_type}/${related_id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  if (env.dataBackend === "supabase") {
    const { error } = await (
      await supabaseServer()
    ).storage
      .from("files")
      .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
    if (error) throw new Error(error.message);
  } else {
    blobs().set(path, bytes);
  }
  const row = await c.store.insert("files", {
    org_id: c.user.org_id,
    storage_path: path,
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    related_type,
    related_id,
    created_by: c.user.id,
  });
  await logActivity(c, { type: "file", subject: `Uploaded ${file.name}`, related_type, related_id, account_id });
  return row;
}

export async function readFile(c: Ctx, id: string) {
  const f = await c.store.get("files", id);
  if (!f || f.archived_at) throw new ForbiddenError("File not found.");
  if (env.dataBackend === "supabase") {
    const { data, error } = await (await supabaseServer()).storage.from("files").download(f.storage_path);
    if (error || !data) throw new ForbiddenError("File not found.");
    return { file: f, bytes: new Uint8Array(await data.arrayBuffer()) };
  }
  const bytes = blobs().get(f.storage_path);
  return { file: f, bytes: bytes ?? new TextEncoder().encode(`Demo placeholder for ${f.name}`) };
}

export async function filesFor(c: Ctx, related_type: RelatedType, related_id: string) {
  return c.store.list("files", { where: { related_type, related_id }, orderBy: { column: "created_at", ascending: false } });
}
