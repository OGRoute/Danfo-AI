import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Road geometry for the live map. Proxies an OSRM routing server (the public
 * demo server by default — set OSRM_URL to self-host) so the map can draw
 * routes along real Lagos roads instead of straight lines. Responses are
 * cached in memory: the same danfo leg is requested over and over.
 *
 * GET /api/directions?points=lat,lng;lat,lng;...
 */
const OSRM_URL = (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/$/, "");
const MAX_POINTS = 25;
const CACHE_MAX = 300;
const cache = new Map<string, unknown>();

export async function GET(req: NextRequest) {
  const points = (req.nextUrl.searchParams.get("points") || "")
    .split(";")
    .map((p) => p.split(",").map(Number))
    .filter(
      (p) =>
        p.length === 2 &&
        p.every(Number.isFinite) &&
        Math.abs(p[0]) <= 90 &&
        Math.abs(p[1]) <= 180
    );
  if (points.length < 2 || points.length > MAX_POINTS) {
    return NextResponse.json(
      { error: `between 2 and ${MAX_POINTS} "lat,lng" points required` },
      { status: 400 }
    );
  }

  const key = points.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(";");
  const hit = cache.get(key);
  if (hit) return NextResponse.json(hit, { headers: { "Cache-Control": "public, max-age=86400" } });

  try {
    const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
    const res = await fetch(
      `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`,
      {
        signal: AbortSignal.timeout(12_000),
        headers: { "User-Agent": "DanfoAI/1.0 (Lagos transit assistant)" },
      }
    );
    const data: any = await res.json().catch(() => null);
    const route = data?.routes?.[0];
    if (!res.ok || data?.code !== "Ok" || !route) {
      throw new Error(`routing server returned ${res.status} ${data?.code ?? ""}`.trim());
    }

    const body = {
      distance: route.distance as number, // metres
      duration: route.duration as number, // seconds (car, free-flow)
      coordinates: (route.geometry.coordinates as [number, number][]).map(
        ([lng, lat]) => [lat, lng] as [number, number]
      ),
    };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, body);
    return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch (e) {
    console.warn("/api/directions failed:", (e as Error).message);
    return NextResponse.json({ error: "routing unavailable" }, { status: 502 });
  }
}
