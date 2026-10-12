"use client";
import AttachFile from "@mui/icons-material/AttachFile";
import UploadFile from "@mui/icons-material/UploadFileOutlined";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/common/Toast";
import { EmptyState, GlassCard, RelTime } from "@/components/kit";
import type { FileRow, RelatedType } from "@/lib/domain/types";

export function FilesPanel({ files, related }: { files: FileRow[]; related: { type: RelatedType; id: string; accountId: string | null } }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("related_type", related.type);
    fd.set("related_id", related.id);
    if (related.accountId) fd.set("account_id", related.accountId);
    const res = await fetch("/api/files", { method: "POST", body: fd });
    setBusy(false);
    if (res.ok) {
      toast("File uploaded", "success");
      router.refresh();
    } else toast((await res.json()).error ?? "Upload failed", "error");
  };
  return (
    <GlassCard
      title="Files"
      action={
        <Button size="small" component="label" startIcon={<UploadFile />} disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
          <input hidden type="file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </Button>
      }
    >
      {files.length ? (
        <List dense disablePadding>
          {files.map((f) => (
            <ListItemButton key={f.id} component="a" href={`/api/files/${f.id}`}>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <AttachFile fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={f.name}
                secondary={
                  <>
                    {(f.size / 1024).toFixed(0)} KB · <RelTime value={f.created_at} />
                  </>
                }
              />
            </ListItemButton>
          ))}
        </List>
      ) : (
        <EmptyState message="No files yet. Upload capability statements, RFPs or notes." />
      )}
    </GlassCard>
  );
}
