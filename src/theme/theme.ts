import { alpha, createTheme, type Theme } from "@mui/material/styles";
import { elevation, fontStack, motion, radius, tokens, type Mode } from "./tokens";

type KcTokens = (typeof tokens)[Mode];

declare module "@mui/material/styles" {
  interface Palette {
    kc: KcTokens;
    gold: Palette["primary"];
  }
  interface PaletteOptions {
    kc?: KcTokens;
    gold?: PaletteOptions["primary"];
  }
  interface TypographyVariants {
    mono: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    mono?: React.CSSProperties;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    mono: true;
  }
}

declare module "@mui/material/Button" {
  interface ButtonPropsColorOverrides {
    gold: true;
  }
}

declare module "@mui/material/Chip" {
  interface ChipPropsColorOverrides {
    gold: true;
  }
}

export function buildTheme(mode: Mode): Theme {
  const t = tokens[mode];
  const glass = {
    backgroundColor: t.surfaceGlass,
    backdropFilter: t.surfaceBlur,
    WebkitBackdropFilter: t.surfaceBlur,
    border: `1px solid ${t.surfaceBorder}`,
  };

  return createTheme({
    palette: {
      mode,
      kc: t,
      primary: { main: t.primary, contrastText: "#FFFFFF" },
      secondary: { main: t.accent },
      gold: { main: t.gold, contrastText: "#0F123B", light: t.gold, dark: t.gold },
      success: { main: t.success },
      warning: { main: t.warning },
      error: { main: t.danger },
      info: { main: t.accent },
      background: { default: t.bgBase, paper: t.surfaceGlassStrong },
      text: { primary: t.textPrimary, secondary: t.textSecondary },
      divider: t.surfaceBorder,
    },
    shape: { borderRadius: radius.input },
    spacing: 4,
    typography: {
      fontFamily: fontStack.ui,
      fontSize: 14,
      h1: { fontSize: 40, fontWeight: 700, letterSpacing: -0.5 },
      h2: { fontSize: 32, fontWeight: 700, letterSpacing: -0.25 },
      h3: { fontSize: 24, fontWeight: 700 },
      h4: { fontSize: 20, fontWeight: 700 },
      h5: { fontSize: 16, fontWeight: 700 },
      h6: { fontSize: 14, fontWeight: 700 },
      body1: { fontSize: 14 },
      body2: { fontSize: 12 },
      subtitle1: { fontSize: 16, fontWeight: 600 },
      subtitle2: { fontSize: 12, fontWeight: 600, color: t.textSecondary },
      caption: { fontSize: 12, color: t.textSecondary },
      button: { textTransform: "none", fontWeight: 700 },
      mono: { fontFamily: fontStack.mono, fontSize: 13 },
    },
    transitions: {
      duration: { shortest: motion.fast, shorter: motion.fast, short: motion.base, standard: motion.base },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { colorScheme: mode },
          body: {
            background: t.bgGradient,
            backgroundColor: t.bgBase,
            backgroundAttachment: "fixed",
            minHeight: "100vh",
          },
          "*:focus-visible": { outline: `2px solid ${t.accent}`, outlineOffset: 2 },
          ".kc-skip": {
            position: "absolute",
            left: -9999,
            top: 8,
            zIndex: 2000,
            padding: "8px 16px",
            borderRadius: 12,
            background: t.primary,
            color: "#fff",
          },
          ".kc-skip:focus": { left: 16 },
          ".mono": { fontFamily: fontStack.mono },
          a: { color: t.accent },
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": {
              animationDuration: "0.01ms !important",
              transitionDuration: "0.01ms !important",
            },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: "none", ...glass, borderRadius: radius.card } },
      },
      MuiCard: { styleOverrides: { root: { ...glass, borderRadius: radius.card, boxShadow: elevation } } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: radius.input, paddingInline: 16, minHeight: 36 },
          containedPrimary: { boxShadow: `0 4px 16px ${alpha(t.primary, 0.35)}` },
        },
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: radius.input } } },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: radius.chip, fontWeight: 600 },
          sizeSmall: { height: 22, fontSize: 12 },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: radius.input,
            backgroundColor: alpha(t.textPrimary, mode === "dark" ? 0.03 : 0.02),
            "& .MuiOutlinedInput-notchedOutline": { borderColor: t.surfaceBorder },
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { ...glass, backgroundColor: t.surfaceGlassStrong, color: t.textPrimary, fontSize: 12 },
        },
      },
      MuiDialog: { styleOverrides: { paper: { ...glass, backgroundColor: t.surfaceGlassStrong } } },
      MuiMenu: { styleOverrides: { paper: { ...glass, backgroundColor: t.surfaceGlassStrong } } },
      MuiPopover: { styleOverrides: { paper: { ...glass, backgroundColor: t.surfaceGlassStrong } } },
      MuiDrawer: { styleOverrides: { paper: { ...glass, backgroundColor: t.surfaceGlassStrong } } },
      MuiTableCell: { styleOverrides: { root: { borderColor: t.surfaceBorder } } },
      MuiTab: { styleOverrides: { root: { textTransform: "none", fontWeight: 600, minHeight: 40 } } },
      MuiTabs: { styleOverrides: { root: { minHeight: 40 } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 999, height: 6 } } },
    },
  });
}
