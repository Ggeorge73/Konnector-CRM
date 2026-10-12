"use client";
import Avatar from "@mui/material/Avatar";
import Tooltip from "@mui/material/Tooltip";
import { initials } from "@/lib/format";

export function UserAvatar({ name, color, size = 28 }: { name: string; color?: string; size?: number }) {
  return (
    <Tooltip title={name}>
      <Avatar sx={{ width: size, height: size, fontSize: size * 0.4, fontWeight: 700, bgcolor: color ?? "primary.main", color: "#fff" }}>
        {initials(name)}
      </Avatar>
    </Tooltip>
  );
}
