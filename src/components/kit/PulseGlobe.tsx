"use client";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import { useTheme } from "@mui/material/styles";
import { useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { MeshPhongMaterial } from "three";
import { feature } from "topojson-client";
import type { GlobeMethods } from "react-globe.gl";
import countries from "world-atlas/countries-110m.json";
import { HQ } from "@/config/app";

const Globe = dynamic(() => import("react-globe.gl"), {
  ssr: false,
  loading: () => <Skeleton variant="circular" width={320} height={320} />,
});

export interface GlobePoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  live?: boolean;
  weight?: number;
}

/** Dot-matrix globe: account points, arcs from Atlanta HQ to live projects. Pauses on hover. */
export function PulseGlobe({ points, height = 420 }: { points: GlobePoint[]; height?: number }) {
  const t = useTheme().palette.kc;
  const reduce = useReducedMotion();
  const ref = useRef<GlobeMethods | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const cv = document.createElement("canvas");
      setWebgl(!!(cv.getContext("webgl2") ?? cv.getContext("webgl")));
    } catch {
      setWebgl(false);
    }
  }, []);

  const land = useMemo(() => {
    const topo = countries as unknown as Parameters<typeof feature>[0];
    const fc = feature(topo, (topo as unknown as { objects: { countries: Parameters<typeof feature>[1] } }).objects.countries);
    // h3 can't tessellate this polygon at our resolution; skipping it avoids a runtime error.
    const H3_UNSAFE = new Set(["408"]);
    return (fc as unknown as { features: Array<{ id?: string }> }).features.filter((f) => !H3_UNSAFE.has(String(f.id)));
  }, []);
  const material = useMemo(
    () =>
      new MeshPhongMaterial({
        color: t.globeBase,
        emissive: t.globeBase,
        emissiveIntensity: 0.35,
        shininess: 4,
        transparent: true,
        opacity: 0.95,
      }),
    [t.globeBase],
  );
  const arcs = useMemo(
    () => points.filter((p) => p.live).map((p) => ({ startLat: HQ.lat, startLng: HQ.lng, endLat: p.lat, endLng: p.lng, name: p.name })),
    [points],
  );

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const setRotate = (on: boolean) => {
    const c = ref.current?.controls() as { autoRotate: boolean; autoRotateSpeed: number; enableZoom: boolean } | undefined;
    if (!c) return;
    c.autoRotate = on && !reduce;
    c.autoRotateSpeed = 0.45;
    c.enableZoom = false;
  };

  return (
    <Box
      ref={wrap}
      sx={{ width: "100%", height, display: "grid", placeItems: "center", overflow: "hidden", cursor: "grab" }}
      onMouseEnter={() => setRotate(false)}
      onMouseLeave={() => setRotate(true)}
      role="img"
      aria-label={`Globe showing ${points.length} account locations and ${arcs.length} live projects connected to Atlanta HQ`}
    >
      {webgl === false && <FlatMap points={points} height={height} />}
      {width > 0 && webgl && (
        <Globe
          ref={ref}
          width={width}
          height={height}
          backgroundColor="rgba(0,0,0,0)"
          showGlobe
          globeMaterial={material}
          showAtmosphere
          atmosphereColor={t.accent}
          atmosphereAltitude={0.18}
          hexPolygonsData={land}
          hexPolygonResolution={3}
          hexPolygonMargin={0.55}
          hexPolygonUseDots
          hexPolygonColor={() => t.globeDot}
          pointsData={[{ id: "hq", name: `${HQ.city} HQ`, lat: HQ.lat, lng: HQ.lng, live: true, weight: 2 }, ...points]}
          pointLat="lat"
          pointLng="lng"
          pointColor={(p: object) => ((p as GlobePoint).id === "hq" ? t.gold : (p as GlobePoint).live ? t.accent : t.primary)}
          pointAltitude={(p: object) => 0.01 + ((p as GlobePoint).weight ?? 1) * 0.02}
          pointRadius={0.45}
          pointLabel={(p: object) => (p as GlobePoint).name}
          arcsData={arcs}
          arcColor={() => [t.gold, t.accent]}
          arcStroke={0.6}
          arcDashLength={0.5}
          arcDashGap={0.25}
          arcDashAnimateTime={reduce ? 0 : 2400}
          arcAltitudeAutoScale={0.4}
          onGlobeReady={() => {
            ref.current?.pointOfView({ lat: 25, lng: -50, altitude: 2.3 }, 0);
            setRotate(true);
          }}
        />
      )}
    </Box>
  );
}

/** Fallback when WebGL is unavailable: equirectangular dot map with the same points and arcs. */
function FlatMap({ points, height }: { points: GlobePoint[]; height: number }) {
  const t = useTheme().palette.kc;
  const W = 360;
  const H = 180;
  const x = (lng: number) => lng + 180;
  const y = (lat: number) => 90 - lat;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} aria-hidden>
      {Array.from({ length: 36 }, (_, i) =>
        Array.from({ length: 18 }, (_, j) => <circle key={`${i}-${j}`} cx={i * 10 + 5} cy={j * 10 + 5} r={0.8} fill={t.globeDot} />),
      )}
      {points
        .filter((p) => p.live)
        .map((p) => (
          <path
            key={`arc-${p.id}`}
            d={`M ${x(HQ.lng)} ${y(HQ.lat)} Q ${(x(HQ.lng) + x(p.lng)) / 2} ${Math.min(y(HQ.lat), y(p.lat)) - 20} ${x(p.lng)} ${y(p.lat)}`}
            stroke={t.accent}
            strokeWidth={0.6}
            fill="none"
          />
        ))}
      {points.map((p) => (
        <circle key={p.id} cx={x(p.lng)} cy={y(p.lat)} r={p.live ? 2.4 : 1.8} fill={p.live ? t.accent : t.primary} />
      ))}
      <circle cx={x(HQ.lng)} cy={y(HQ.lat)} r={3} fill={t.gold} />
    </svg>
  );
}
