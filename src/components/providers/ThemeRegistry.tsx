"use client";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Mode } from "@/theme/tokens";
import { buildTheme } from "@/theme/theme";

const ModeContext = createContext<{ mode: Mode; toggle: () => void }>({ mode: "dark", toggle: () => {} });
export const useColorMode = () => useContext(ModeContext);

export function ThemeRegistry({ initialMode, children }: { initialMode: Mode; children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000 } } }));
  const theme = useMemo(() => buildTheme(mode), [mode]);
  const toggle = useCallback(() => {
    setMode((m) => {
      const next = m === "dark" ? "light" : "dark";
      document.cookie = `kcrm_theme=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.dataset.theme = next;
      return next;
    });
  }, []);

  return (
    <AppRouterCacheProvider options={{ key: "kc" }}>
      <ModeContext.Provider value={{ mode, toggle }}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </ThemeProvider>
      </ModeContext.Provider>
    </AppRouterCacheProvider>
  );
}
