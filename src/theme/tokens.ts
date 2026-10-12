/**
 * Design tokens — the only place raw colour values live.
 * Shared with Konnect Hub so both apps read as one product family.
 */
export type Mode = "dark" | "light";

export const tokens = {
  dark: {
    bgBase: "#060B26",
    bgGradient: "linear-gradient(159deg, #0F123B 14%, #090D2E 57%, #020515 86%)",
    surfaceGlass: "rgba(6, 11, 40, 0.74)",
    surfaceGlassStrong: "rgba(10, 16, 52, 0.92)",
    surfaceBlur: "blur(42px)",
    surfaceBorder: "rgba(255,255,255,0.08)",
    surfaceHover: "rgba(255,255,255,0.04)",
    primary: "#0075FF",
    accent: "#21D4FD",
    gold: "#F5B841",
    success: "#01B574",
    warning: "#FFB547",
    danger: "#E31A1A",
    violet: "#7551FF",
    textPrimary: "#FFFFFF",
    textSecondary: "#A0AEC0",
    globeDot: "rgba(160,174,192,0.55)",
    globeBase: "#0B1240",
  },
  light: {
    bgBase: "#F4F6FB",
    bgGradient: "linear-gradient(159deg,#FFFFFF,#EEF2FA)",
    surfaceGlass: "rgba(255,255,255,0.72)",
    surfaceGlassStrong: "rgba(255,255,255,0.94)",
    surfaceBlur: "blur(24px)",
    surfaceBorder: "rgba(15,18,59,0.08)",
    surfaceHover: "rgba(15,18,59,0.04)",
    primary: "#0075FF",
    accent: "#0094C6",
    gold: "#C98A00",
    success: "#01995F",
    warning: "#D9932F",
    danger: "#C11515",
    violet: "#5E3FE0",
    textPrimary: "#0F123B",
    textSecondary: "#5A6478",
    globeDot: "rgba(15,18,59,0.45)",
    globeBase: "#DCE4F5",
  },
} as const;

export const radius = { card: 20, input: 12, chip: 999 } as const;
export const fontStack = {
  ui: "var(--font-jakarta), 'Plus Jakarta Sans', system-ui, sans-serif",
  mono: "var(--font-mono), 'JetBrains Mono', ui-monospace, monospace",
} as const;
export const elevation = "0 8px 32px rgba(0,0,0,0.25)";
export const motion = { fast: 150, base: 220, page: 300, easing: "cubic-bezier(0.2, 0, 0, 1)" } as const;

/** Chart series colours, in order. */
export function seriesColors(mode: Mode) {
  const t = tokens[mode];
  return [t.primary, t.accent, t.gold, t.success, t.violet];
}
