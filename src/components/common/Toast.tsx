"use client";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import { createContext, useCallback, useContext, useState } from "react";

type Severity = "success" | "error" | "info" | "warning";
const ToastContext = createContext<(msg: string, severity?: Severity) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ msg: string; severity: Severity; key: number } | null>(null);
  const show = useCallback((msg: string, severity: Severity = "info") => setState({ msg, severity, key: Date.now() }), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar
        key={state?.key}
        open={!!state}
        autoHideDuration={4000}
        onClose={() => setState(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {state ? (
          <Alert
            severity={state.severity}
            variant="filled"
            onClose={() => setState(null)}
            role={state.severity === "error" ? "alert" : "status"}
          >
            {state.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}
