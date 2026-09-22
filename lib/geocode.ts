/**
 * Street-level place lookup for Lagos and its neighbouring towns.
 *
 * The curated route database only knows named stops and parks. Riders name
 * streets ("Allen Avenue", "Bode Thomas"), estates, markets and landmarks, so
 * anything not in the database is resolved against OpenStreetMap and then
 * snapped to the nearest stop the transit network actually serves.
 *
 * OSM's public geocoder asks for at most one request per second and a real
 * User-Agent, so requests are queued and answers cached (including misses).
 */
import { LAGOS_STOPS, haversineKm, nearestStop, type LatLng } from "./lagos-stops";

const NOMINATIM = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const CONTACT = process.env.NOMINATIM_EMAIL || "";
const USER_AGENT = `DanfoAI/1.0 (Lagos transit assistant${CONTACT ? `; ${CONTACT}` : ""})`;

// Lagos plus the commuter belt in Ogun (Sango Ota, Mowe/Ibafo, Arepo…).
const VIEWBOX = "2.70,6.95,4.35,6.25"; // left,top,right,bottom
const CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
const CACHE_MAX = 500;
const MIN_REQUEST_GAP_MS = 1100;

export interface GeocodedPlace {
  /** Short name to show the rider, e.g. "Allen Avenue". */
  name: string;
  /** Full address line from OpenStreetMap. */
  display: string;
  pos: LatLng;
  /** OSM category, e.g. highway / amenity / place. */
  kind?: string;
}

interface CacheEntry {
  value: GeocodedPlace | null;
  at: number;
}

const cache = new Map<string, CacheEntry>();
let lastRequest = 0;
let queue: Promise<unknown> = Promise.resolve();

function remember(key: string, value: GeocodedPlace | null) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { value, at: Date.now() });
}

/** Serialise requests and keep one second between them (OSM usage policy). */
function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    return task();
  });
  // Keep the chain alive even when a lookup fails.
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function shortName(result: any): string {
  const a = result.address ?? {};
  return (
    result.name ||
    a.road ||
    a.neighbourhood ||
    a.suburb ||
    a.quarter ||
    a.town ||
    a.village ||
    a.city_district ||
    a.city ||
    String(result.display_name || "").split(",")[0]
  );
}

/**
 * Find a Lagos-area place by name. Returns null when OpenStreetMap doesn't
 * know it (or the lookup fails) — callers then fall back to asking the rider.
 */
export async function geocodePlace(query: string): Promise<GeocodedPlace | null> {
  const clean = query.trim().replace(/\s+/g, " ");
  if (clean.length < 3) return null;
  const key = clean.toLowerCase();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  // Keep the search inside Lagos unless the rider named another place.
  const scoped = /lagos|ogun|nigeria/i.test(clean) ? clean : `${clean}, Lagos, Nigeria`;
  const url =
    `${NOMINATIM}/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=ng` +
    `&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(scoped)}` +
    (CONTACT ? `&email=${encodeURIComponent(CONTACT)}` : "");

  try {
    const results = await schedule(async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`geocoder returned ${res.status}`);
      return (await res.json()) as any[];
    });

    const first = Array.isArray(results) ? results[0] : null;
    if (!first) {
      remember(key, null);
      return null;
    }
    const place: GeocodedPlace = {
      name: shortName(first),
      display: String(first.display_name || "").split(",").slice(0, 3).join(",").trim(),
      pos: [Number(first.lat), Number(first.lon)],
      kind: first.category || first.class,
    };
    remember(key, place);
    return place;
  } catch (e) {
    console.warn(`geocode "${clean}" failed:`, (e as Error).message);
    return null;
  }
}

export interface ResolvedEndpoint {
  /** What the rider called it, as OpenStreetMap knows it. */
  label: string;
  pos: LatLng;
  /** Nearest stop the transit network serves. */
  stop: string;
  /** Distance from the place to that stop, in km. */
  km: number;
}

/** How far a rider will reasonably get to a mapped stop from a street. */
const MAX_ACCESS_KM = 8;

/**
 * Turn a free-text place into a transit endpoint: its position, plus the
 * nearest stop with routes. Returns null if it can't be placed in Lagos.
 */
export async function resolveEndpoint(query: string): Promise<ResolvedEndpoint | null> {
  const place = await geocodePlace(query);
  if (!place) return null;
  const near = nearestStop(place.pos, MAX_ACCESS_KM);
  if (!near) return null;
  return { label: place.name, pos: place.pos, stop: near.name, km: Math.round(near.km * 10) / 10 };
}

/** Distance in km between a place and a named stop (0 when unknown). */
export function kmToStop(pos: LatLng, stop: string): number {
  const p = LAGOS_STOPS[stop];
  return p ? haversineKm(pos, p) : 0;
}
