/**
 * Loads the route knowledge base for DanfoAI.
 *
 * The bundled seed file is the base layer; community corrections recorded on
 * the Stellar registry contract are the living layer on top (surfaced via the
 * corrections feed and, once accepted, folded back into the seed).
 *
 * Cached in memory for the lifetime of the server process.
 */
import type { RouteKB } from "./prompt";
import seed from "../data/lagos-routes.json";

let cache: RouteKB | null = null;

export async function loadRouteKB(): Promise<{ kb: RouteKB; source: string }> {
  if (cache) return { kb: cache, source: "cache" };
  cache = seed as unknown as RouteKB;
  return { kb: cache, source: "community-seed" };
}

export function clearKBCache() {
  cache = null;
}
