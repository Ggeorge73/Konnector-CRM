# Konnector CRM — design system

Direction: **dark glassmorphic navy "mission control"** — a floating sidenav, translucent
cards over a deep gradient, a spinning dot-matrix globe on the home screen, crisp data.
Inspired by premium admin dashboards (e.g. the Vision UI look), but built from scratch:
do not copy any commercial template's code, images or assets.

## Tokens (define once in `src/theme/tokens.ts`, consume via MUI theme)

| Token | Dark (default) | Light |
|---|---|---|
| bg.base | `#060B26` | `#F4F6FB` |
| bg.gradient | `linear-gradient(159deg, #0F123B 14%, #090D2E 57%, #020515 86%)` | `linear-gradient(159deg,#FFFFFF,#EEF2FA)` |
| surface.glass | `rgba(6, 11, 40, 0.74)` + `backdrop-filter: blur(42px)` | `rgba(255,255,255,0.72)` + blur(24px) |
| surface.border | `rgba(255,255,255,0.08)` | `rgba(15,18,59,0.08)` |
| brand.primary | `#0075FF` (Konnector blue) | same |
| brand.accent | `#21D4FD` (cyan, links/highlights) | `#0094C6` |
| brand.gold | `#F5B841` (awards, wins, "won") | `#C98A00` |
| success / warning / danger | `#01B574` / `#FFB547` / `#E31A1A` | darker by ~15% |
| text.primary / secondary | `#FFFFFF` / `#A0AEC0` | `#0F123B` / `#5A6478` |

- Radius: cards 20px, inputs 12px, chips 999px.
- Font: **Plus Jakarta Sans** (UI) + **JetBrains Mono** (IDs, solicitation numbers, money
  in tables). Scale: 12 / 14 / 16 / 20 / 24 / 32 / 40.
- Spacing: 4px base grid. Card padding 24px desktop, 16px mobile.
- Elevation is light + blur, not heavy shadows: `0 8px 32px rgba(0,0,0,0.25)`.

## Layout

- **Floating sidenav** (260px, collapses to 76px icon rail): detached 16px from the edges,
  glass surface, rounded 20px, active item = blue pill with soft glow.
- **Top bar**: breadcrumb + page title left; global search (Cmd/Ctrl-K), quick-create (+),
  notifications bell, theme toggle, avatar right. Transparent until scroll, then glass.
- Content max width 1600px; 12-column grid; 24px gutters.
- Mobile (<900px): sidenav becomes a drawer, tables become cards, kanban scrolls sideways.
- Share tokens with Konnect Hub (same colours, fonts, radius) so the two apps feel like
  one product family. If Konnect Hub already has a theme, import or mirror its tokens.

## Signature components

- **GlassCard** – the base surface. Optional header (title, subtitle, action slot).
- **StatTile** – label, big number, delta chip (▲/▼ with colour), sparkline.
- **PulseGlobe** – dot-matrix globe (react-globe.gl with a hex-polygon/dots layer),
  slow auto-rotation, glowing points per account location, arcs from Atlanta HQ to accounts with
  live projects. Pauses on hover; respects `prefers-reduced-motion`.
- **KanbanBoard** – pipeline columns with total value + count in each header, draggable
  cards (dnd-kit), WIP warnings, stage-gate dialog when a move needs fields filled.
- **DataTable** – MUI X DataGrid styled to glass: saved views, column chooser, inline
  edit, bulk actions, CSV export.
- **RecordHeader** – avatar/logo, name, type chips, owner, key metrics, primary actions.
- **Timeline** – vertical activity feed with icons per type, @mentions, reactions.
- **HealthRing** – read-only three-segment ring (Schedule / Budget / Acceptance) fed by
  Konnect Hub, with an "Open in Konnect Hub" link.
- **ScoreCard** – Bid/No-Bid scoring grid with weighted totals and a verdict chip.
- **CommandPalette** – search all records, jump to pages, run actions.
- **EmptyState** – illustration-free: icon in a glowing circle, one sentence, one button.

## Motion

- 150–220ms ease-out for hovers and panels; 300ms for page transitions (framer-motion).
- Numbers count up on first load of a dashboard only.
- Kanban drop = small spring; won deal = brief gold shimmer on the card.
- Everything respects `prefers-reduced-motion`.

## Charts (Recharts)

- Area/line with gradient fills fading to transparent, no gridlines on Y, faint X grid.
- Series colours in order: primary, accent, gold, success, `#7551FF` (violet).
- Tooltips are GlassCards. Always label units and currency.

## Accessibility

- Text on glass must hit 4.5:1; if blur weakens contrast, raise surface opacity.
- Visible focus ring: 2px `brand.accent` outline, 2px offset.
- All icons-only buttons have `aria-label`; colour is never the only signal (add text/icon).
