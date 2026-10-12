"use client";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Hub from "@mui/icons-material/Hub";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/config/app";
import { NAV_ICONS } from "./icons";
import type { NavItem } from "./nav";

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavList({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed?: boolean; onNavigate?: () => void }) {
  const t = useTheme().palette.kc;
  const pathname = usePathname();
  const sections = [...new Set(items.map((i) => i.section))];
  return (
    <Box component="nav" aria-label="Main" sx={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
      {sections.map((s) => (
        <List
          key={s}
          dense
          subheader={
            collapsed ? undefined : (
              <ListSubheader
                disableSticky
                sx={{
                  bgcolor: "transparent",
                  lineHeight: "32px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  color: t.textSecondary,
                }}
              >
                {s.toUpperCase()}
              </ListSubheader>
            )
          }
        >
          {items
            .filter((i) => i.section === s)
            .map((i) => {
              const active = isActive(pathname, i.href);
              const btn = (
                <ListItemButton
                  key={i.href}
                  component={Link}
                  href={i.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  sx={{
                    mx: 2,
                    my: 0.5,
                    borderRadius: "12px",
                    minHeight: 40,
                    px: collapsed ? 2.5 : 3,
                    justifyContent: collapsed ? "center" : "flex-start",
                    color: active ? "#fff" : t.textPrimary,
                    bgcolor: active ? t.primary : "transparent",
                    boxShadow: active ? `0 0 20px ${alpha(t.primary, 0.55)}` : "none",
                    "&:hover": { bgcolor: active ? t.primary : t.surfaceHover },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36, color: active ? "#fff" : t.accent }}>{NAV_ICONS[i.icon]}</ListItemIcon>
                  {!collapsed && <ListItemText primary={i.label} primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }} />}
                </ListItemButton>
              );
              return collapsed ? (
                <Tooltip key={i.href} title={i.label} placement="right">
                  {btn}
                </Tooltip>
              ) : (
                btn
              );
            })}
        </List>
      ))}
    </Box>
  );
}

export function Brand({ collapsed }: { collapsed?: boolean }) {
  const t = useTheme().palette.kc;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: collapsed ? 0 : 5,
        py: 5,
        justifyContent: collapsed ? "center" : "flex-start",
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: "10px",
          display: "grid",
          placeItems: "center",
          background: `linear-gradient(135deg, ${t.primary}, ${t.accent})`,
          color: "#fff",
        }}
        aria-hidden
      >
        <Hub fontSize="small" />
      </Box>
      {!collapsed && (
        <Typography variant="subtitle1" component="span" sx={{ fontWeight: 800, letterSpacing: 0.4 }}>
          {APP_NAME}
        </Typography>
      )}
    </Box>
  );
}

/** Floating glass sidenav: 260px, collapses to a 76px icon rail. */
export function SideNav({ items, collapsed, onToggle }: { items: NavItem[]; collapsed: boolean; onToggle: () => void }) {
  const t = useTheme().palette.kc;
  return (
    <Box
      sx={{
        display: { xs: "none", md: "flex" },
        flexDirection: "column",
        position: "fixed",
        top: 16,
        bottom: 16,
        left: 16,
        width: collapsed ? 76 : 260,
        transition: "width 220ms cubic-bezier(0.2,0,0,1)",
        bgcolor: t.surfaceGlass,
        backdropFilter: t.surfaceBlur,
        border: `1px solid ${t.surfaceBorder}`,
        borderRadius: "20px",
        zIndex: 1200,
      }}
    >
      <Brand collapsed={collapsed} />
      <NavList items={items} collapsed={collapsed} />
      <Box sx={{ p: 2, display: "flex", justifyContent: collapsed ? "center" : "flex-end" }}>
        <IconButton onClick={onToggle} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} size="small">
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </IconButton>
      </Box>
    </Box>
  );
}
