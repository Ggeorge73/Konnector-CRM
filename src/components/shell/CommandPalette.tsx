"use client";
import Add from "@mui/icons-material/Add";
import Business from "@mui/icons-material/BusinessOutlined";
import DarkMode from "@mui/icons-material/DarkModeOutlined";
import Logout from "@mui/icons-material/Logout";
import Person from "@mui/icons-material/PersonOutline";
import Search from "@mui/icons-material/Search";
import ViewKanban from "@mui/icons-material/ViewKanbanOutlined";
import Badge from "@mui/icons-material/BadgeOutlined";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import InputBase from "@mui/material/InputBase";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useColorMode } from "@/components/providers/ThemeRegistry";
import { NAV_ICONS } from "./icons";
import type { NavItem } from "./nav";

export interface SearchHit {
  kind: "account" | "contact" | "opportunity" | "consultant";
  id: string;
  label: string;
  sub: string;
  href: string;
}

interface Entry {
  key: string;
  group: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  run: () => void;
}

const KIND_ICON = {
  account: <Business fontSize="small" />,
  contact: <Person fontSize="small" />,
  opportunity: <ViewKanban fontSize="small" />,
  consultant: <Badge fontSize="small" />,
};

export function CommandPalette({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: NavItem[] }) {
  const t = useTheme().palette.kc;
  const router = useRouter();
  const { toggle } = useColorMode();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  const { data: hits = [] } = useQuery<SearchHit[]>({
    queryKey: ["search", q],
    queryFn: async () => (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json(),
    enabled: open && q.trim().length >= 2,
  });

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const needle = q.trim().toLowerCase();
    const records: Entry[] = hits.map((h) => ({
      key: `${h.kind}:${h.id}`,
      group: "Records",
      label: h.label,
      sub: h.sub,
      icon: KIND_ICON[h.kind],
      run: go(h.href),
    }));
    const pages: Entry[] = nav.map((n) => ({ key: n.href, group: "Go to", label: n.label, icon: NAV_ICONS[n.icon], run: go(n.href) }));
    const actions: Entry[] = [
      { key: "new-opp", group: "Actions", label: "New opportunity", icon: <Add fontSize="small" />, run: go("/opportunities?new=1") },
      { key: "new-account", group: "Actions", label: "New account", icon: <Add fontSize="small" />, run: go("/accounts?new=1") },
      { key: "new-contact", group: "Actions", label: "New contact", icon: <Add fontSize="small" />, run: go("/contacts?new=1") },
      {
        key: "theme",
        group: "Actions",
        label: "Toggle dark / light theme",
        icon: <DarkMode fontSize="small" />,
        run: () => {
          toggle();
          onClose();
        },
      },
      {
        key: "logout",
        group: "Actions",
        label: "Sign out",
        icon: <Logout fontSize="small" />,
        run: () => {
          window.location.href = "/auth/signout";
        },
      },
    ];
    const f = (e: Entry) => !needle || e.label.toLowerCase().includes(needle);
    return [...records, ...pages.filter(f), ...actions.filter(f)];
  }, [hits, nav, q, router, onClose, toggle]);

  useEffect(() => setSel(0), [q, open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, entries.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      entries[sel]?.run();
    }
  };

  const groups = [...new Set(entries.map((e) => e.group))];
  let idx = -1;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-label="Command palette"
      PaperProps={{ sx: { alignSelf: "flex-start", mt: "12vh" } }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, px: 4, py: 3, borderBottom: `1px solid ${t.surfaceBorder}` }}>
        <Search sx={{ color: t.textSecondary }} aria-hidden />
        <InputBase
          autoFocus
          fullWidth
          placeholder="Search accounts, contacts, deals… or type a command"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          inputProps={{ "aria-label": "Search", role: "combobox", "aria-expanded": true, "aria-controls": "kc-palette-list" }}
        />
        <Typography variant="caption" sx={{ border: `1px solid ${t.surfaceBorder}`, borderRadius: 1, px: 1 }}>
          Esc
        </Typography>
      </Box>
      <List id="kc-palette-list" role="listbox" dense sx={{ maxHeight: 420, overflowY: "auto", py: 2 }}>
        {groups.map((g) => (
          <Box key={g}>
            <ListSubheader
              disableSticky
              sx={{ bgcolor: "transparent", lineHeight: "28px", fontSize: 11, fontWeight: 700, color: t.textSecondary }}
            >
              {g.toUpperCase()}
            </ListSubheader>
            {entries
              .filter((e) => e.group === g)
              .map((e) => {
                idx += 1;
                const i = idx;
                return (
                  <ListItemButton
                    key={e.key}
                    role="option"
                    aria-selected={sel === i}
                    selected={sel === i}
                    onMouseEnter={() => setSel(i)}
                    onClick={e.run}
                    sx={{ mx: 2, borderRadius: "10px" }}
                  >
                    <ListItemIcon sx={{ minWidth: 36, color: t.accent }}>{e.icon}</ListItemIcon>
                    <ListItemText primary={e.label} secondary={e.sub} />
                  </ListItemButton>
                );
              })}
          </Box>
        ))}
        {entries.length === 0 && (
          <Typography sx={{ px: 5, py: 4 }} color="text.secondary">
            No matches.
          </Typography>
        )}
      </List>
    </Dialog>
  );
}
