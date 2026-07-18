/**
 * Loads the route knowledge base for DanfoAI.
 *
 * Priority:
 *   1. If ROUTES_ROOT_HASH is set, load from 0G Storage (verifiable).
 *   2. Otherwise fall back to the bundled seed file (dev / before seeding).
 *
 * Cached in memory for the lifetime of the server process.
 */
import { downloadJson } from "./zg-storage";
import type { RouteKB } from "./prompt";
import seed from "../data/lagos-routes.json";

let cache: RouteKB | null = null;

export async function loadRouteKB(): Promise<{ kb: RouteKB; source: string }> {
  if (cache) return { kb: cache, source: "cache" };

  const rootHash = process.env.ROUTES_ROOT_HASH;
  if (rootHash) {
    try {
      const kb = await downloadJson<RouteKB>(rootHash);
      cache = kb;
      return { kb, source: `0g-storage:${rootHash.slice(0, 10)}…` };
    } catch (e) {
      console.warn("Failed to load KB from 0G Storage, using seed:", (e as Error).message);
    }
  }

  cache = seed as unknown as RouteKB;
  return { kb: cache, source: "local-seed" };
}

export function clearKBCache() {
  cache = null;
}
