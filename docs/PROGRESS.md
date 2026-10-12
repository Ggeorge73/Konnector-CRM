# Progress

## Sprint 1 — Foundation (KCRM-1)

Delivered:

- Next.js 15 (App Router, strict TS, pnpm), MUI v6 theme from tokens (dark default + light, cookie-persisted).
- Component kit with `/_kit` showcase: GlassCard, StatTile (count-up, sparkline), PulseGlobe (dot-matrix,
  arcs from Atlanta HQ, pauses on hover, reduced-motion aware, flat fallback without WebGL),
  KanbanBoard (dnd-kit, WIP warnings, gold shimmer on won), DataTable (glass DataGrid, CSV export),
  RecordHeader, Timeline (@mentions, reactions), HealthRing, ScoreCard, EmptyState, StatusChip, Countdown.
- App shell: floating collapsible sidenav, mobile drawer, top bar (breadcrumb, search, quick create,
  notifications, theme toggle, account menu), Cmd/Ctrl-K palette (records, pages, actions).
- Auth: Supabase Google + magic link restricted to the internal domain; demo sign-in per role;
  role route guards in the app layout; middleware session check.
- Data layer: Store port with MemoryStore (demo/tests) and SupabaseStore (RLS); realistic seed.
- Pulse home v1 with KPIs, charts and globe from seed.
- CI: typecheck, lint, format, unit, build, Playwright (desktop 1440 + mobile 390).

Notes / inspect & adapt:

- `react-globe.gl` hex layer can't tessellate one country polygon at our resolution; it is skipped.
- Compact money is formatted by our own helper so server and browser render identically.
