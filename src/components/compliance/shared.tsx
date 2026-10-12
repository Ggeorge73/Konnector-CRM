"use client";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { StatusChip } from "@/components/kit";
import type { Registration } from "@/lib/domain/types";
import type { RegistrationStatus } from "@/lib/services/compliance";

/** Desktop on the server render (no shift on wide screens); phones switch to cards after hydration. */
export function useDesktop() {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.up("md"), { defaultMatches: true });
}

export const REGISTRATION_KINDS: Registration["kind"][] = ["sam_uei", "cage", "georgia_supplier", "certification", "insurance", "license"];

export const KIND_LABEL: Record<Registration["kind"], string> = {
  sam_uei: "SAM UEI",
  cage: "CAGE code",
  georgia_supplier: "Georgia supplier",
  certification: "Certification",
  insurance: "Insurance",
  license: "Licence",
};

export function RegistrationStatusChip({ status }: { status: RegistrationStatus }) {
  const map = {
    expired: { tone: "danger", label: "Expired" },
    expiring: { tone: "warning", label: "Expiring ≤30d" },
    current: { tone: "success", label: "Current" },
    no_expiry: { tone: "neutral", label: "No expiry" },
  } as const;
  return <StatusChip tone={map[status].tone} label={map[status].label} />;
}
