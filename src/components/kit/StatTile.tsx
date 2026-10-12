"use client";
import ArrowDropDown from "@mui/icons-material/ArrowDropDown";
import ArrowDropUp from "@mui/icons-material/ArrowDropUp";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { animate, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { GlassCard } from "./GlassCard";

export interface StatTileProps {
  label: string;
  value: number;
  format?: (v: number) => string;
  delta?: { value: number; label?: string; goodWhen?: "up" | "down" };
  spark?: number[];
  icon?: React.ReactNode;
  href?: string;
  /** Count up from zero on first render (dashboards only). */
  countUp?: boolean;
}

export function StatTile({ label, value, format = (v) => v.toLocaleString("en-US"), delta, spark, icon, countUp }: StatTileProps) {
  const t = useTheme().palette.kc;
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(countUp && !reduce ? 0 : value);
  const did = useRef(false);
  useEffect(() => {
    if (!countUp || reduce || did.current) {
      setShown(value);
      return;
    }
    did.current = true;
    const c = animate(0, value, { duration: 0.9, ease: "easeOut", onUpdate: setShown });
    return () => c.stop();
  }, [value, countUp, reduce]);

  const up = (delta?.value ?? 0) >= 0;
  const good = delta ? (delta.goodWhen === "down" ? !up : up) : true;
  const gradId = `spark-${label.replace(/\W/g, "")}`;

  return (
    <GlassCard sx={{ p: { xs: 4, md: 5 }, height: "100%" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" component="p">
            {label}
          </Typography>
          <Typography variant="h3" component="p" sx={{ mt: 1, fontVariantNumeric: "tabular-nums" }}>
            {format(Math.round(shown))}
          </Typography>
          {delta && (
            <Stack direction="row" alignItems="center" sx={{ color: good ? t.success : t.danger, mt: 0.5 }}>
              {up ? <ArrowDropUp fontSize="small" aria-hidden /> : <ArrowDropDown fontSize="small" aria-hidden />}
              <Typography variant="body2" fontWeight={700}>
                {up ? "▲" : "▼"} {Math.abs(delta.value)}%{" "}
                <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>
                  {delta.label}
                </Box>
              </Typography>
            </Stack>
          )}
        </Box>
        {icon && (
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: "12px",
              display: "grid",
              placeItems: "center",
              bgcolor: t.primary,
              color: "#fff",
              flexShrink: 0,
            }}
            aria-hidden
          >
            {icon}
          </Box>
        )}
      </Stack>
      {spark && spark.length > 1 && (
        <Box sx={{ height: 40, mt: 2 }} aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark.map((v, i) => ({ i, v }))} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.accent} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={t.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={t.accent} strokeWidth={2} fill={`url(#${gradId})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      )}
    </GlassCard>
  );
}
