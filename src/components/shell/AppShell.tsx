"use client";
import Add from "@mui/icons-material/Add";
import DarkMode from "@mui/icons-material/DarkModeOutlined";
import LightMode from "@mui/icons-material/LightModeOutlined";
import Menu from "@mui/icons-material/Menu";
import NotificationsNone from "@mui/icons-material/NotificationsNone";
import Search from "@mui/icons-material/Search";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import MuiMenu from "@mui/material/Menu";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UserAvatar } from "@/components/kit/UserAvatar";
import { useColorMode } from "@/components/providers/ThemeRegistry";
import { ROLE_LABEL } from "@/lib/auth/permissions";
import type { Role } from "@/lib/domain/types";
import { CommandPalette } from "./CommandPalette";
import { NAV, navFor } from "./nav";
import { Brand, isActive, NavList } from "./SideNav";
import { SideNav } from "./SideNav";

export interface ShellUser {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  avatar_color: string;
}

function useScrolled() {
  const [s, setS] = useState(false);
  useEffect(() => {
    const on = () => setS(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return s;
}

export function AppShell({ user, unread, children }: { user: ShellUser; unread: number; children: React.ReactNode }) {
  const theme = useTheme();
  const t = theme.palette.kc;
  const mobile = useMediaQuery(theme.breakpoints.down("md"));
  const { mode, toggle } = useColorMode();
  const pathname = usePathname();
  const router = useRouter();
  const scrolled = useScrolled();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [createEl, setCreateEl] = useState<HTMLElement | null>(null);
  const [userEl, setUserEl] = useState<HTMLElement | null>(null);
  const items = navFor(user.role);
  const current = NAV.filter((n) => isActive(pathname, n.href)).sort((a, b) => b.href.length - a.href.length)[0];

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const offset = mobile ? 0 : collapsed ? 76 + 32 : 260 + 32;

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <a href="#main" className="kc-skip">
        Skip to content
      </a>
      <SideNav items={items} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <Drawer open={drawer} onClose={() => setDrawer(false)} PaperProps={{ sx: { width: 280, borderRadius: "0 20px 20px 0" } }}>
        <Brand />
        <NavList items={items} onNavigate={() => setDrawer(false)} />
      </Drawer>

      <Box sx={{ pl: `${offset}px`, transition: "padding-left 220ms cubic-bezier(0.2,0,0,1)" }}>
        <Box
          component="header"
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 1100,
            px: { xs: 4, md: 6 },
            py: 3,
            mx: { md: 0 },
            bgcolor: scrolled ? t.surfaceGlass : "transparent",
            backdropFilter: scrolled ? t.surfaceBlur : "none",
            borderBottom: `1px solid ${scrolled ? t.surfaceBorder : "transparent"}`,
            transition: "background-color 220ms",
          }}
        >
          <Stack direction="row" alignItems="center" spacing={2}>
            {mobile && (
              <IconButton onClick={() => setDrawer(true)} aria-label="Open navigation">
                <Menu />
              </IconButton>
            )}
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Breadcrumbs aria-label="Breadcrumb" sx={{ fontSize: 12, display: { xs: "none", sm: "block" } }}>
                <Link href="/" style={{ color: "inherit" }}>
                  Konnector
                </Link>
                <Typography variant="body2" color="text.primary">
                  {current?.label ?? "Page"}
                </Typography>
              </Breadcrumbs>
              <Typography variant="h5" component="p" noWrap>
                {current?.label ?? ""}
              </Typography>
            </Box>
            <Button
              onClick={() => setPalette(true)}
              variant="outlined"
              color="inherit"
              startIcon={<Search />}
              aria-label="Search (Ctrl+K)"
              sx={{
                borderColor: t.surfaceBorder,
                color: t.textSecondary,
                display: { xs: "none", sm: "inline-flex" },
                minWidth: 220,
                justifyContent: "flex-start",
              }}
            >
              Search…
              <Box component="span" sx={{ ml: "auto", fontSize: 11, border: `1px solid ${t.surfaceBorder}`, borderRadius: 1, px: 1 }}>
                ⌘K
              </Box>
            </Button>
            <IconButton sx={{ display: { sm: "none" } }} onClick={() => setPalette(true)} aria-label="Search">
              <Search />
            </IconButton>
            <Tooltip title="Quick create">
              <IconButton
                onClick={(e) => setCreateEl(e.currentTarget)}
                aria-label="Quick create"
                sx={{ bgcolor: t.primary, color: "#fff", "&:hover": { bgcolor: t.primary } }}
              >
                <Add />
              </IconButton>
            </Tooltip>
            <Tooltip title="Notifications">
              <IconButton component={Link} href="/notifications" aria-label={`Notifications, ${unread} unread`}>
                <Badge badgeContent={unread} color="error" max={9}>
                  <NotificationsNone />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
              <IconButton onClick={toggle} aria-label="Toggle theme">
                {mode === "dark" ? <LightMode /> : <DarkMode />}
              </IconButton>
            </Tooltip>
            <IconButton onClick={(e) => setUserEl(e.currentTarget)} aria-label="Account menu" sx={{ p: 0.5 }}>
              <UserAvatar name={user.full_name} color={user.avatar_color} size={34} />
            </IconButton>
          </Stack>
        </Box>

        <Box component="main" id="main" sx={{ px: { xs: 4, md: 6 }, pb: 10, pt: 2, maxWidth: 1600 }}>
          {children}
        </Box>
      </Box>

      <MuiMenu anchorEl={createEl} open={!!createEl} onClose={() => setCreateEl(null)}>
        {[
          ["New opportunity", "/opportunities?new=1"],
          ["New account", "/accounts?new=1"],
          ["New contact", "/contacts?new=1"],
          ["New task", "/my-work?new=1"],
        ].map(([label, href]) => (
          <MenuItem
            key={href}
            onClick={() => {
              setCreateEl(null);
              router.push(href);
            }}
          >
            {label}
          </MenuItem>
        ))}
      </MuiMenu>
      <MuiMenu anchorEl={userEl} open={!!userEl} onClose={() => setUserEl(null)}>
        <Box sx={{ px: 4, py: 2 }}>
          <ListItemText primary={user.full_name} secondary={`${user.email} · ${ROLE_LABEL[user.role]}`} />
        </Box>
        <Divider />
        <MenuItem component="a" href="/auth/signout">
          Sign out
        </MenuItem>
      </MuiMenu>
      <CommandPalette open={palette} onClose={() => setPalette(false)} nav={items} />
    </Box>
  );
}
