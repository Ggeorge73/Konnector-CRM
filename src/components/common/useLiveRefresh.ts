"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

const TABLES = ["activities", "opportunities", "notifications", "tasks", "project_health", "client_items", "handoffs"];

/**
 * Keeps server-rendered data fresh when teammates change it:
 * Supabase Realtime in production, a lightweight version poll on the demo backend.
 */
export function useLiveRefresh(enabled = true, intervalMs = 8000) {
  const router = useRouter();
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const backend = process.env.NEXT_PUBLIC_DATA_BACKEND ?? "demo";
    if (backend === "supabase") {
      const sb = supabaseBrowser();
      const ch = sb.channel("kcrm-live");
      for (const table of TABLES) ch.on("postgres_changes", { event: "*", schema: "public", table }, () => router.refresh());
      ch.subscribe();
      return () => {
        void sb.removeChannel(ch);
      };
    }
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/changes", { cache: "no-store" });
        const { version } = (await r.json()) as { version: number | null };
        if (version === null) return;
        if (last.current !== null && version !== last.current) router.refresh();
        last.current = version;
      } catch {
        // offline or signed out — try again next tick
      }
    };
    void tick();
    const id = window.setInterval(tick, intervalMs);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [enabled, intervalMs, router]);
}
