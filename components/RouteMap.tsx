"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Polyline,
  Marker,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LAGOS_STOPS, LAGOS_CENTER, haversineKm, type LatLng } from "../lib/lagos-stops";
import { formatMinutes, formatNaira, type Itinerary, type TripLeg } from "../lib/route-planner";
import { useTheme } from "../lib/useTheme";
import { MODE_ICON } from "./TripCard";

interface Props {
  /** Itineraries to choose between, best first (may be empty). */
  itineraries: Itinerary[];
  /** Stops mentioned in chat, highlighted when there's no itinerary. */
  stops: string[];
  onPosition?: (pos: LatLng, accuracy?: number) => void;
  /** Start with GPS on (rider preference; defaults to on). */
  liveLocation?: boolean;
  /** Start following the rider's position. */
  followMe?: boolean;
  /** Force map colours instead of following the app theme. */
  mapStyle?: "auto" | "light" | "dark";
  /** Base map the rider chose in settings. */
  basemap?: Basemap;
  /** Remember a change made from the map's own switcher. */
  onBasemapChange?: (basemap: Basemap) => void;
}

interface Fix {
  pos: LatLng;
  /** Radius in metres the true position lies within, as the browser reports it. */
  accuracy: number;
  heading: number | null;
  source: "gps" | "sim";
  /** When this fix arrived, for preferring a fresh sharp fix over a vague one. */
  at?: number;
}

const MODE_COLOR: Record<string, string> = {
  walk: "#6b7280",
  danfo: "#e0b000",
  brt: "#0050b3",
  lamata: "#7c3aed",
  ferry: "#0e9f9a",
  keke: "#16a34a",
};
// Typical Lagos speeds, for ETA on legs without a published journey time.
const MODE_KMH: Record<string, number> = { walk: 4.5, danfo: 14, brt: 20, lamata: 18, rail: 40, ferry: 25, keke: 12 };
// Further than this from the line counts as off route.
const OFF_ROUTE_M = 300;

/** "80 m" / "2.1 km" — how precise the fix actually is. */
const formatAccuracy = (m: number) =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

/**
 * Base maps. All three need no API key.
 *
 * Riders said the map "doesn't look real — no place or figure, no road
 * terrain", so there is now a choice: the street map, real satellite imagery,
 * and a terrain map. Satellite carries a transparent labels overlay, otherwise
 * imagery alone names nothing.
 */
export type Basemap = "streets" | "satellite" | "terrain";

interface BasemapDef {
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  /**
   * A mirror on a different network. Some riders' connections reach one tile
   * host and not another — an ISP block, a captive network, or a link slow
   * enough that requests time out — and the map then draws the route over
   * nothing at all. When tiles keep failing, the map moves to this.
   */
  fallbackUrl?: string;
  fallbackAttribution?: string;
  /** Transparent overlay drawn on top, for imagery that carries no names. */
  overlays?: string[];
  /** Dark UI inverts this layer's colours (street maps only — imagery must not). */
  invertible?: boolean;
}

const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

export const BASEMAPS: Record<Basemap, BasemapDef> = {
  streets: {
    label: "Streets",
    url: process.env.NEXT_PUBLIC_MAP_TILE_URL || OSM_TILE_URL,
    attribution:
      process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ||
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    invertible: true,
    fallbackUrl: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
    fallbackAttribution: "&copy; Esri, HERE, Garmin, OpenStreetMap contributors",
  },
  satellite: {
    label: "Satellite",
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    // Esri's terms require the source credit to stay visible.
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
    overlays: [
      `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
      `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    ],
  },
  terrain: {
    label: "Terrain",
    url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: "&copy; Esri, HERE, Garmin, FAO, NOAA, USGS",
    maxZoom: 19,
    fallbackUrl: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    fallbackAttribution:
      '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), OpenStreetMap contributors',
  },
};

/** Failed tiles before the map gives up on a host and tries its mirror. */
const TILE_FAILURES_BEFORE_FALLBACK = 4;

const DARK_TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL_DARK || "";

function legColor(leg: TripLeg): string {
  if (leg.mode === "rail") return /blue/i.test(leg.line ?? "") ? "#1d4ed8" : "#d92626";
  return MODE_COLOR[leg.mode] ?? "#6b7280";
}

const metres = (a: LatLng, b: LatLng) => haversineKm(a, b) * 1000;

/** A leg's points: named stops, or the coordinates carried by access legs. */
function legPoints(leg: TripLeg): LatLng[] {
  const middle = leg.path.slice(1, -1).map((n) => LAGOS_STOPS[n]);
  return [leg.fromPos ?? LAGOS_STOPS[leg.from], ...middle, leg.toPos ?? LAGOS_STOPS[leg.to]].filter(
    Boolean
  ) as LatLng[];
}

function bearing(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLng = (b[1] - a[1]) * rad;
  const y = Math.sin(dLng) * Math.cos(b[0] * rad);
  const x =
    Math.cos(a[0] * rad) * Math.sin(b[0] * rad) -
    Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
}

// ---------------------------------------------------------------------------
// Route geometry
// ---------------------------------------------------------------------------

interface RouteLine {
  points: LatLng[];
  /** Cumulative distance in metres at each point. */
  cum: number[];
  /** [first, last] point index of each leg. */
  legRanges: Array<[number, number]>;
  total: number;
}

function buildLine(geoms: LatLng[][]): RouteLine | null {
  const points: LatLng[] = [];
  const legRanges: Array<[number, number]> = [];
  for (const g of geoms) {
    const first = Math.max(points.length - 1, 0);
    for (const p of g) {
      const last = points[points.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) points.push(p);
    }
    legRanges.push([first, Math.max(points.length - 1, first)]);
  }
  if (points.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + metres(points[i - 1], points[i]));
  return { points, cum, legRanges, total: cum[cum.length - 1] };
}

/** Closest point on the line (optionally within a point range) to `pos`. */
function project(
  line: RouteLine,
  pos: LatLng,
  range: [number, number] = [0, line.points.length - 1]
): { along: number; offset: number } {
  const kx = 111_320 * Math.cos((pos[0] * Math.PI) / 180);
  const ky = 110_540;
  let best = { along: line.cum[range[0]], offset: Infinity };
  for (let i = range[0] + 1; i <= range[1]; i++) {
    const a = line.points[i - 1];
    const b = line.points[i];
    const ax = (a[1] - pos[1]) * kx;
    const ay = (a[0] - pos[0]) * ky;
    const dx = (b[1] - a[1]) * kx;
    const dy = (b[0] - a[0]) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const offset = Math.hypot(ax + t * dx, ay + t * dy);
    if (offset < best.offset) {
      best = { along: line.cum[i - 1] + t * (line.cum[i] - line.cum[i - 1]), offset };
    }
  }
  return best;
}

function pointAt(line: RouteLine, along: number): { pos: LatLng; heading: number } {
  const d = Math.min(Math.max(along, 0), line.total);
  let i = 1;
  while (i < line.cum.length - 1 && line.cum[i] < d) i++;
  const a = line.points[i - 1];
  const b = line.points[i];
  const seg = line.cum[i] - line.cum[i - 1];
  const t = seg ? (d - line.cum[i - 1]) / seg : 0;
  return { pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: bearing(a, b) };
}

interface Progress {
  legIndex: number;
  nextStop: string | null;
  remaining: number;
  etaMin: number;
  offset: number;
  offRoute: boolean;
  arrived: boolean;
}

function computeProgress(line: RouteLine, legs: TripLeg[], pos: LatLng): Progress {
  const { along, offset } = project(line, pos);

  let legIndex = legs.length - 1;
  for (let i = 0; i < line.legRanges.length; i++) {
    if (along < line.cum[line.legRanges[i][1]] - 1) {
      legIndex = i;
      break;
    }
  }

  // ETA: what's left of each leg, at that leg's own pace.
  let eta = 0;
  legs.forEach((leg, i) => {
    const r = line.legRanges[i];
    if (!r) return;
    const start = line.cum[r[0]];
    const end = line.cum[r[1]];
    const len = end - start;
    if (len <= 0) return;
    const left = Math.min(len, Math.max(0, end - Math.max(along, start)));
    const legMinutes = leg.duration
      ? (leg.duration[0] + leg.duration[1]) / 2
      : (len / 1000 / (MODE_KMH[leg.mode] ?? 15)) * 60;
    eta += legMinutes * (left / len);
  });

  let nextStop: string | null = null;
  const leg = legs[legIndex];
  for (const name of leg?.path.slice(1) ?? []) {
    const p = LAGOS_STOPS[name];
    if (p && project(line, p, line.legRanges[legIndex]).along > along + 40) {
      nextStop = name;
      break;
    }
  }

  const remaining = Math.max(0, line.total - along);
  return {
    legIndex,
    nextStop,
    remaining,
    etaMin: Math.max(0, Math.round(eta)),
    offset,
    offRoute: offset > OFF_ROUTE_M,
    arrived: remaining < 80 && offset <= OFF_ROUTE_M,
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Road-following geometry per leg (trains and ferries go stop to stop). */
function useLegGeometries(legs: TripLeg[]): LatLng[][] {
  const key = legs.map((l) => `${l.mode}:${l.path.join(">")}`).join("|");
  const [geoms, setGeoms] = useState<LatLng[][]>([]);

  useEffect(() => {
    const straight = legs.map(legPoints);
    setGeoms(straight);
    const ctrl = new AbortController();
    legs.forEach((leg, i) => {
      // Trains and boats don't follow roads; walking legs are short and direct.
      if (leg.mode === "rail" || leg.mode === "ferry" || leg.mode === "walk" || straight[i].length < 2) return;
      const points = straight[i].map((p) => p.join(",")).join(";");
      fetch(`/api/directions?points=${encodeURIComponent(points)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (Array.isArray(d?.coordinates) && d.coordinates.length > 1) {
            setGeoms((prev) => prev.map((g, j) => (j === i ? d.coordinates : g)));
          }
        })
        .catch(() => {
          /* keep the straight line */
        });
    });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return geoms;
}

/**
 * Beyond this, a fix is a neighbourhood rather than a position — typically a
 * Wi-Fi or IP lookup when precise location is off, or a laptop indoors. Riders
 * told us the map "misrepresented my position", and this is why: a ±2 km fix
 * was drawn as a confident blue dot. Now it is shown, and used, as the rough
 * area it is.
 */
const COARSE_ACCURACY_M = 500;
/** A good recent fix isn't thrown away for a much vaguer one. */
const FIX_FRESH_MS = 30_000;

function useGeolocation(enabled: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setFix(null);
      setError(null);
      return;
    }
    if (!("geolocation" in navigator)) {
      setError("Location isn't available in this browser.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setFix((prev) => {
          const pos: LatLng = [p.coords.latitude, p.coords.longitude];
          const accuracy = p.coords.accuracy;
          // Browsers interleave a coarse network fix with good GPS ones; a
          // fresh, sharper fix is kept rather than replaced by the vague one.
          if (
            prev &&
            prev.source === "gps" &&
            Date.now() - (prev.at ?? 0) < FIX_FRESH_MS &&
            accuracy > prev.accuracy * 3 &&
            accuracy > COARSE_ACCURACY_M
          ) {
            return prev;
          }
          const moving = (p.coords.speed ?? 0) > 0.5;
          let heading =
            moving && p.coords.heading != null && Number.isFinite(p.coords.heading)
              ? p.coords.heading
              : null;
          // No compass heading: derive it from movement. A coarse fix "moves"
          // when nothing moved, so its drift is never read as a direction.
          if (heading === null && prev && accuracy <= COARSE_ACCURACY_M) {
            heading = metres(prev.pos, pos) > 4 ? bearing(prev.pos, pos) : prev.heading;
          }
          return { pos, accuracy, heading, source: "gps", at: Date.now() };
        });
      },
      (e) =>
        setError(
          e.code === e.PERMISSION_DENIED
            ? "Location permission denied — allow it in your browser to see yourself on the map."
            : "Waiting for your location…"
        ),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { fix, error };
}

/** Animate a rider along the route — a demo when you're not on the road. */
function useSimulation(line: RouteLine | null, running: boolean): Fix | null {
  const [fix, setFix] = useState<Fix | null>(null);

  useEffect(() => {
    if (!running || !line) {
      setFix(null);
      return;
    }
    // Replay the whole trip in about a minute so the demo stays watchable.
    const speed = Math.max(60, line.total / 60); // metres per second
    const started = performance.now();
    let lastPaint = 0;
    let raf = 0;
    const frame = (now: number) => {
      const along = ((now - started) / 1000) * speed;
      if (now - lastPaint > 50 || along >= line.total) {
        lastPaint = now;
        const { pos, heading } = pointAt(line, along);
        setFix({ pos, accuracy: 5, heading, source: "sim", at: Date.now() });
      }
      if (along < line.total) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [line, running]);

  return fix;
}

// ---------------------------------------------------------------------------
// Map helpers
// ---------------------------------------------------------------------------

/** Leaflet measures its container on mount; re-measure once the overlay has laid out. */
function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

function FitView({ points, disabled }: { points: LatLng[]; disabled: boolean }) {
  const map = useMap();
  const key = points.length ? `${points.length}:${points[0].join()}:${points[points.length - 1].join()}` : "";
  useEffect(() => {
    if (disabled || !points.length) return;
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(L.latLngBounds(points), { padding: [48, 48] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function FollowFix({ fix, follow, onUserMove }: { fix: Fix | null; follow: boolean; onUserMove: () => void }) {
  const map = useMap();
  const onUserMoveRef = useRef(onUserMove);
  useEffect(() => {
    onUserMoveRef.current = onUserMove;
  });
  useMapEvents({ dragstart: () => onUserMoveRef.current() });

  const zoomedIn = useRef(false);
  useEffect(() => {
    if (!follow || !fix) {
      zoomedIn.current = false;
      return;
    }
    if (!zoomedIn.current) {
      map.setView(fix.pos, Math.max(map.getZoom(), 15), { animate: true });
      zoomedIn.current = true;
    } else {
      map.panTo(fix.pos, { animate: fix.source === "gps", duration: 0.5 });
    }
  }, [fix, follow, map]);
  return null;
}

function riderIcon(heading: number | null, simulated: boolean, coarse = false): L.DivIcon {
  const cone = heading === null || coarse ? "" : `<span class="rm-me-cone" style="transform:rotate(${heading}deg)"></span>`;
  const dot = `rm-me-dot${simulated ? " sim" : ""}${coarse ? " coarse" : ""}`;
  return L.divIcon({
    className: "rm-me",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `${coarse ? "" : '<span class="rm-me-pulse"></span>'}<span class="${dot}"></span>`,
  });
}

function badgeIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "rm-badge",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<span style="background:${color}">${label}</span>`,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RouteMap({
  itineraries,
  stops,
  onPosition,
  liveLocation = true,
  followMe = false,
  mapStyle = "auto",
  basemap = "streets",
  onBasemapChange,
}: Props) {
  const { resolved } = useTheme();

  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [itineraries]);
  const itinerary = itineraries[selected] ?? itineraries[0] ?? null;
  const legs = useMemo(() => itinerary?.legs ?? [], [itinerary]);

  const geoms = useLegGeometries(legs);
  const line = useMemo(() => (legs.length ? buildLine(geoms) : null), [geoms, legs.length]);

  const [tracking, setTracking] = useState(liveLocation);
  const [follow, setFollow] = useState(followMe);
  const [simulating, setSimulating] = useState(false);
  const gps = useGeolocation(tracking);
  const sim = useSimulation(line, simulating);
  const fix = sim ?? gps.fix;

  const onPositionRef = useRef(onPosition);
  useEffect(() => {
    onPositionRef.current = onPosition;
  });
  useEffect(() => {
    if (gps.fix) onPositionRef.current?.(gps.fix.pos, gps.fix.accuracy);
  }, [gps.fix]);

  const progress = useMemo(
    () => (fix && line && legs.length ? computeProgress(line, legs, fix.pos) : null),
    [fix, line, legs]
  );

  // Round the heading so the icon isn't rebuilt on every tiny change.
  const heading = fix?.heading == null ? null : Math.round(fix.heading / 10) * 10;
  const coarse = !!fix && fix.source === "gps" && fix.accuracy > COARSE_ACCURACY_M;
  const meIcon = useMemo(
    () => riderIcon(heading, fix?.source === "sim", coarse),
    [heading, fix?.source, coarse]
  );
  const boardIcons = useMemo(() => legs.map((leg, i) => badgeIcon(String(i + 1), legColor(leg))), [legs]);
  const finishIcon = useMemo(() => badgeIcon("🏁", "#111111"), []);

  const routeStops = useMemo(() => Array.from(new Set(legs.flatMap((l) => l.path))), [legs]);
  const mentioned = useMemo(() => new Set(stops), [stops]);
  const fitPoints = useMemo(
    () => line?.points ?? (stops.map((n) => LAGOS_STOPS[n]).filter(Boolean) as LatLng[]),
    [line, stops]
  );

  const dark = mapStyle === "auto" ? resolved === "dark" : mapStyle === "dark";
  const lastLeg = legs[legs.length - 1];

  const [base, setBase] = useState<Basemap>(basemap);
  useEffect(() => setBase(basemap), [basemap]);
  const chosen = BASEMAPS[base] ?? BASEMAPS.streets;
  // Street maps are inverted for the dark theme; imagery and terrain never are
  // — an inverted photograph of Lagos is exactly what "doesn't look real".
  const invert = dark && !DARK_TILE_URL && !!chosen.invertible;
  const [tilesReady, setTilesReady] = useState(false);
  // Tiles that never arrived, and whether we've moved to the mirror host.
  const failures = useRef(0);
  const [onFallback, setOnFallback] = useState(false);
  const [tileProblem, setTileProblem] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setTilesReady(false);
    setOnFallback(false);
    setTileProblem(false);
    failures.current = 0;
    // If the layer never reports a load (no tiles in view, a host that
    // stalls), the notice must not sit there for ever.
    const giveUp = setTimeout(() => setTilesReady(true), 8000);
    return () => clearTimeout(giveUp);
  }, [base, attempt]);

  function onTileError() {
    failures.current += 1;
    if (failures.current < TILE_FAILURES_BEFORE_FALLBACK) return;
    if (!onFallback && chosen.fallbackUrl) {
      // This host isn't reachable from here; try the one on another network.
      failures.current = 0;
      setOnFallback(true);
      setTilesReady(false);
    } else {
      setTileProblem(true);
      setTilesReady(true);
    }
  }

  function retryTiles() {
    failures.current = 0;
    setAttempt((n) => n + 1);
  }

  const tileUrl =
    invert && DARK_TILE_URL
      ? DARK_TILE_URL
      : onFallback && chosen.fallbackUrl
        ? chosen.fallbackUrl
        : chosen.url;

  function pickBasemap(next: Basemap) {
    setBase(next);
    onBasemapChange?.(next);
  }

  return (
    <div className="rm">
      <MapContainer center={LAGOS_CENTER} zoom={11} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          key={`${base}-${invert ? "dark" : "light"}-${onFallback ? "mirror" : "main"}-${attempt}`}
          className={invert ? "rm-tiles-dark" : undefined}
          url={tileUrl}
          attribution={onFallback ? chosen.fallbackAttribution ?? chosen.attribution : chosen.attribution}
          maxZoom={chosen.maxZoom}
          // Keep drawing while the map moves, and hold a ring of tiles around
          // the view, so panning doesn't leave blank squares.
          updateWhenIdle={false}
          keepBuffer={3}
          eventHandlers={{
            // Leaflet counts a tile that failed as "ready", so `load` fires
            // even when every tile errored — it only means the map has
            // finished trying, which is why the failures are counted too.
            load: () => {
              setTilesReady(true);
              if (failures.current === 0) setTileProblem(false);
            },
            tileerror: onTileError,
          }}
        />
        {chosen.overlays?.map((url) => (
          <TileLayer key={url} url={url} maxZoom={chosen.maxZoom} updateWhenIdle={false} keepBuffer={2} />
        ))}
        <InvalidateOnMount />
        <FitView points={fitPoints} disabled={follow} />
        <FollowFix fix={fix} follow={follow} onUserMove={() => setFollow(false)} />

        {legs.length > 0 ? (
          <>
            {geoms.map(
              (coords, i) =>
                coords.length > 1 && (
                  <Polyline
                    key={`casing-${i}`}
                    positions={coords}
                    pathOptions={{ color: dark ? "#000000" : "#1f2937", weight: 10, opacity: 0.5 }}
                  />
                )
            )}
            {geoms.map(
              (coords, i) =>
                coords.length > 1 &&
                legs[i] && (
                  <Polyline
                    key={`leg-${i}`}
                    positions={coords}
                    pathOptions={{
                      color: legColor(legs[i]),
                      weight: 6,
                      opacity: progress && !progress.offRoute && progress.legIndex > i ? 0.4 : 0.95,
                      dashArray:
                        legs[i].mode === "ferry" || legs[i].mode === "keke" || legs[i].mode === "walk"
                          ? "10 8"
                          : undefined,
                    }}
                  >
                    <Tooltip sticky>
                      {MODE_ICON[legs[i].mode]} {legs[i].line ?? legs[i].mode} · {formatNaira(legs[i].fare)}
                    </Tooltip>
                  </Polyline>
                )
            )}
            {routeStops.map(
              (name) =>
                LAGOS_STOPS[name] && (
                  <CircleMarker
                    key={name}
                    center={LAGOS_STOPS[name]}
                    radius={5}
                    pathOptions={{ color: "#111111", weight: 2, fillColor: "#ffffff", fillOpacity: 1 }}
                  >
                    <Tooltip direction="top" offset={[0, -6]}>
                      {name}
                    </Tooltip>
                  </CircleMarker>
                )
            )}
            {legs.map(
              (leg, i) =>
                legPoints(leg)[0] && (
                  <Marker key={`board-${i}`} position={legPoints(leg)[0]} icon={boardIcons[i]}>
                    <Tooltip direction="top" offset={[0, -12]}>
                      Step {i + 1} — board at {leg.board}
                    </Tooltip>
                  </Marker>
                )
            )}
            {lastLeg && legPoints(lastLeg).slice(-1)[0] && (
              <Marker position={legPoints(lastLeg).slice(-1)[0]} icon={finishIcon}>
                <Tooltip direction="top" offset={[0, -12]}>
                  Destination: {lastLeg.alight}
                </Tooltip>
              </Marker>
            )}
          </>
        ) : (
          Object.entries(LAGOS_STOPS).map(([name, pos]) => {
            const on = mentioned.has(name);
            return (
              <CircleMarker
                key={name}
                center={pos}
                radius={on ? 9 : 5}
                pathOptions={{
                  color: on ? "#111111" : "#0050b3",
                  weight: on ? 2 : 1,
                  fillColor: on ? "#ffd400" : "#0050b3",
                  fillOpacity: on ? 1 : 0.55,
                }}
              >
                <Tooltip direction="top" offset={[0, -6]} permanent={on && stops.length <= 6}>
                  {name}
                </Tooltip>
              </CircleMarker>
            );
          })
        )}

        {fix && (
          <>
            {fix.source === "gps" && (
              <Circle
                center={fix.pos}
                radius={fix.accuracy}
                pathOptions={
                  coarse
                    ? {
                        color: "#6b7280",
                        weight: 1,
                        dashArray: "5 5",
                        fillColor: "#6b7280",
                        fillOpacity: 0.08,
                      }
                    : { color: "#2563eb", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.12 }
                }
              />
            )}
            <Marker position={fix.pos} icon={meIcon} zIndexOffset={1000} interactive={false} />
          </>
        )}
      </MapContainer>

      {!tilesReady && !tileProblem && <div className="rm-loading">Loading map\u2026</div>}
      {tileProblem && (
        <div className="rm-loading problem">
          <span>
            The map pictures aren&apos;t loading on this connection — the route below is still
            correct.
          </span>
          <button type="button" onClick={retryTiles}>
            Try again
          </button>
          {base !== "satellite" && (
            <button type="button" onClick={() => pickBasemap("satellite")}>
              Try satellite
            </button>
          )}
        </div>
      )}

      <div className="rm-controls">
        <button
          type="button"
          className={`rm-btn ${tracking ? "on" : ""}`}
          onClick={() => setTracking((v) => !v)}
          aria-pressed={tracking}
          title="Show my live location"
        >
          📍
          <span>
            {!tracking
              ? "Location off"
              : !gps.fix
                ? "Locating…"
                : coarse
                  ? `Approximate ±${formatAccuracy(gps.fix.accuracy)}`
                  : `Live ±${formatAccuracy(gps.fix.accuracy)}`}
          </span>
        </button>
        <button
          type="button"
          className={`rm-btn ${follow ? "on" : ""}`}
          onClick={() => setFollow(true)}
          disabled={!fix}
          title="Keep the map centred on you"
        >
          🎯<span>Follow</span>
        </button>
        {line && (
          <button
            type="button"
            className={`rm-btn ${simulating ? "on" : ""}`}
            onClick={() => {
              setFollow(!simulating);
              setSimulating((v) => !v);
            }}
            title="Animate the trip along the route"
          >
            {simulating ? "■" : "▶"}
            <span>{simulating ? "End demo" : "Simulate trip"}</span>
          </button>
        )}
        <div className="rm-basemaps" role="group" aria-label="Base map">
          {(Object.keys(BASEMAPS) as Basemap[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`rm-base ${base === key ? "on" : ""}`}
              aria-pressed={base === key}
              onClick={() => pickBasemap(key)}
            >
              {BASEMAPS[key].label}
            </button>
          ))}
        </div>
      </div>

      {gps.error && !sim && <div className="rm-toast">{gps.error}</div>}
      {!gps.error && coarse && !sim && (
        <div className="rm-toast">
          Your browser only knows roughly where you are (±{formatAccuracy(fix!.accuracy)}), so this
          is the area you're in, not your exact spot. On a phone, turn on precise location for this
          site; indoors, step outside for a GPS fix.
        </div>
      )}

      {itinerary ? (
        <div className="rm-sheet">
          {itineraries.length > 1 && (
            <div className="rm-tabs" role="tablist">
              {itineraries.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === selected}
                  className={`rm-tab ${i === selected ? "on" : ""}`}
                  onClick={() => {
                    setSelected(i);
                    setSimulating(false);
                  }}
                >
                  {i === 0 ? "Best" : `Option ${i + 1}`} · {formatNaira(it.fare)}
                </button>
              ))}
            </div>
          )}

          <div className="rm-summary">
            <strong>
              {itinerary.from} → {itinerary.to}
            </strong>
            <span>
              {formatNaira(itinerary.fare)}
              {itinerary.duration ? ` · ~${formatMinutes(itinerary.duration)}` : ""}
              {line ? ` · ${formatDistance(line.total)}` : ""}
            </span>
          </div>

          {progress && (
            <div className={`rm-progress ${progress.offRoute ? "warn" : ""}`} aria-live="polite">
              {progress.arrived
                ? `🎉 You've arrived — ${itinerary.to}`
                : progress.offRoute
                  ? `⚠️ You're ${formatDistance(progress.offset)} from the route — head to step ${progress.legIndex + 1}'s boarding point: ${legs[progress.legIndex].board}`
                  : `${MODE_ICON[legs[progress.legIndex].mode] ?? "🚏"} Step ${progress.legIndex + 1} of ${legs.length}` +
                    (progress.nextStop ? ` · next stop ${progress.nextStop}` : "") +
                    ` · ${formatDistance(progress.remaining)} · ~${progress.etaMin} min left`}
            </div>
          )}

          <ol className="rm-legs">
            {legs.map((leg, i) => (
              <li
                key={i}
                className={progress && !progress.offRoute && progress.legIndex === i ? "current" : ""}
              >
                <span className="rm-dot" style={{ background: legColor(leg) }} />
                <div>
                  <div className="t">
                    <span>
                      {MODE_ICON[leg.mode]} {leg.line ?? leg.mode}
                    </span>
                    <b>{formatNaira(leg.fare)}</b>
                  </div>
                  <div className="s">Board: {leg.board}</div>
                  <div className="s">Get off: {leg.alight}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="rm-sheet compact">
          Ask DanfoAI for a trip (for example &ldquo;CMS to Ikeja&rdquo;) to see the route here.
          {stops.length > 0 && ` Showing: ${stops.join(", ")}.`}
        </div>
      )}

      <style jsx global>{`
        .rm {
          position: relative;
          height: 100%;
          width: 100%;
        }
        /* Turn the light OSM tiles into a dark basemap (labels stay legible). */
        .rm-basemaps {
          display: flex;
          border: 1.5px solid var(--border);
          border-radius: 999px;
          overflow: hidden;
          background: var(--surface);
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
        }
        .rm-base {
          border: 0;
          background: transparent;
          color: var(--text-muted);
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          padding: 6px 12px;
          cursor: pointer;
        }
        .rm-base + .rm-base {
          border-left: 1.5px solid var(--border);
        }
        .rm-base.on {
          background: var(--accent);
          color: var(--accent-text);
        }
        .rm-loading.problem {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          align-items: center;
          gap: 8px;
          max-width: min(420px, 86%);
          text-align: center;
          line-height: 1.45;
          pointer-events: auto;
        }
        .rm-loading.problem button {
          border: 1.5px solid var(--border);
          border-radius: 999px;
          background: transparent;
          color: var(--text);
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          padding: 4px 10px;
          cursor: pointer;
        }
        /* Until the first tiles arrive the map would be a blank sheet. */
        .rm-loading {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 900;
          background: var(--surface);
          border: 1.5px solid var(--border);
          border-radius: 999px;
          padding: 7px 14px;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text-muted);
          pointer-events: none;
        }
        .rm :global(.leaflet-container) {
          background: ${dark ? "#1b2026" : "#dfe3e6"};
        }
        /*
         * The dark map used to be the street map with its colours inverted,
         * which riders read as "not a real map" — water came out orange and
         * parks grey. It is now dimmed instead: the same real map, at dusk.
         */
        .rm-tiles-dark {
          filter: brightness(0.78) saturate(0.85) contrast(1.06);
        }
        .rm-controls {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 1000;
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: flex-end;
        }
        .rm-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 2px solid var(--border);
          border-radius: 999px;
          background: var(--surface);
          color: var(--text);
          font-size: 13px;
          font-weight: 700;
          padding: 7px 12px;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        }
        .rm-btn.on {
          background: var(--accent);
          color: var(--accent-text);
        }
        .rm-btn:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .rm-btn:focus-visible,
        .rm-tab:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px var(--ring);
        }
        .rm-toast {
          position: absolute;
          top: 12px;
          left: 56px;
          right: 150px;
          z-index: 1000;
          background: var(--surface);
          color: var(--text);
          border: 2px solid var(--border);
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 12.5px;
        }
        .rm-sheet {
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: 12px;
          z-index: 1000;
          max-width: 520px;
          max-height: 42%;
          overflow-y: auto;
          background: var(--surface);
          color: var(--text);
          border: 2px solid var(--border);
          border-radius: 16px;
          padding: 12px 14px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
          font-size: 13.5px;
        }
        .rm-sheet.compact {
          max-height: none;
          color: var(--text-muted);
        }
        .rm-tabs {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          margin-bottom: 8px;
        }
        .rm-tab {
          flex-shrink: 0;
          border: 2px solid var(--border);
          border-radius: 999px;
          background: transparent;
          color: var(--text);
          font-size: 12px;
          font-weight: 700;
          padding: 4px 10px;
          cursor: pointer;
        }
        .rm-tab.on {
          background: var(--accent);
          color: var(--accent-text);
        }
        .rm-summary {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 4px 12px;
        }
        .rm-summary span {
          color: var(--text-muted);
        }
        .rm-progress {
          margin-top: 8px;
          padding: 8px 10px;
          border-radius: 10px;
          background: color-mix(in srgb, #16a34a 16%, var(--surface));
          font-weight: 700;
        }
        .rm-progress.warn {
          background: color-mix(in srgb, #f59e0b 20%, var(--surface));
        }
        .rm-legs {
          list-style: none;
          margin: 10px 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .rm-legs li {
          display: flex;
          gap: 10px;
          padding: 6px;
          border-radius: 10px;
        }
        .rm-legs li.current {
          background: var(--surface-hover);
        }
        .rm-dot {
          width: 10px;
          min-width: 10px;
          height: 10px;
          border-radius: 50%;
          margin-top: 5px;
          border: 2px solid var(--border);
        }
        .rm-legs .t {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          font-weight: 700;
        }
        .rm-legs .s {
          color: var(--text-muted);
          line-height: 1.35;
        }
        /* A coarse fix is a grey, unpulsing dot — it isn't a position. */
        :global(.rm-me-dot.coarse) {
          background: #6b7280;
          box-shadow: 0 0 0 2px #ffffff;
        }

        /* Rider marker: pulsing blue dot with a heading cone. */
        .rm-me {
          position: relative;
        }
        .rm-me-dot {
          position: absolute;
          inset: 8px;
          border-radius: 50%;
          background: #2563eb;
          border: 3px solid #ffffff;
          box-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
        }
        .rm-me-dot.sim {
          background: #e0b000;
        }
        .rm-me-pulse {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: rgba(37, 99, 235, 0.35);
          animation: rm-pulse 1.8s ease-out infinite;
        }
        .rm-me-cone {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 0;
          height: 0;
          margin-left: -9px;
          margin-top: -26px;
          border-left: 9px solid transparent;
          border-right: 9px solid transparent;
          border-bottom: 20px solid rgba(37, 99, 235, 0.55);
          transform-origin: 9px 26px;
        }
        @keyframes rm-pulse {
          0% {
            transform: scale(0.6);
            opacity: 0.9;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }
        .rm-badge span {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          border: 2px solid #ffffff;
          color: #ffffff;
          font-size: 12px;
          font-weight: 800;
          box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
        }
        @media (max-width: 480px) {
          .rm-btn span {
            display: none;
          }
          .rm-toast {
            right: 64px;
            left: 12px;
            top: 60px;
          }
          .rm-sheet {
            left: 8px;
            right: 8px;
            bottom: 8px;
            max-height: 46%;
          }
        }
      `}</style>
    </div>
  );
}
