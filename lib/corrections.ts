/**
 * What riders tell us is wrong, folded back into the route data.
 *
 * DanfoAI can't retrain the model it runs on 0G Compute — but its answers come
 * from the route database, so corrections are where it actually learns. Each
 * correction is recorded on 0G Chain (RouteCorrections), and the detail field
 * carries a small JSON payload so it can be read back and applied:
 *
 *   {"kind":"fare","mode":"danfo","fare":[500,700],"note":"conductor charged 600"}
 *
 * A reported fare only replaces the published one once enough riders agree —
 * one annoyed rider shouldn't rewrite the map, and neither should one typo.
 */
import type { KBRoute, RouteKB } from "./prompt";
import { getRecentCorrections, type Correction } from "./zg-chain";

export type CorrectionKind = "fare" | "board" | "missing" | "wrong" | "praise" | "other";

export interface CorrectionPayload {
  kind: CorrectionKind;
  /** Vehicle the rider actually used. */
  mode?: string;
  /** Fare they actually paid, as a range. */
  fare?: [number, number];
  /** Where the vehicle really boards. */
  board?: string;
  /** Anything they typed. */
  note?: string;
  rating?: "up" | "down";
}

/** How many independent reports before a fare overrides the published one. */
const MIN_REPORTS = Number(process.env.CORRECTION_MIN_REPORTS || 2);
/** Upvotes count as extra agreement, capped so one loud voice can't win. */
const MAX_UPVOTE_WEIGHT = 3;
const CORRECTIONS_TO_READ = Number(process.env.CORRECTION_HISTORY || 200);
const CACHE_TTL_MS = 5 * 60_000;

export interface RouteOverride {
  fare?: [number, number];
  board?: string;
  /** How many riders backed this. */
  reports: number;
  /** Riders saying the route doesn't exist / is wrong. */
  disputes: number;
  notes: string[];
}

export type Overrides = Map<string, RouteOverride>;

export const overrideKey = (from: string, to: string, mode?: string) =>
  `${from.toLowerCase()}>${to.toLowerCase()}:${(mode ?? "").toLowerCase()}`;

function parsePayload(detail: string): CorrectionPayload | null {
  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed === "object" && typeof parsed.kind === "string") {
      return parsed as CorrectionPayload;
    }
  } catch {
    // Older corrections are plain prose — keep them as notes.
  }
  return detail.trim() ? { kind: "other", note: detail.trim() } : null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/** Turn raw on-chain corrections into per-route overrides. */
export function aggregate(corrections: Correction[]): Overrides {
  const fares = new Map<string, number[][]>();
  const overrides: Overrides = new Map();

  for (const c of corrections) {
    const payload = parsePayload(c.detail);
    if (!payload || !c.fromStop || !c.toStop) continue;
    const key = overrideKey(c.fromStop, c.toStop, payload.mode);
    const entry = overrides.get(key) ?? { reports: 0, disputes: 0, notes: [] };
    // One report, plus a little weight for riders who upvoted it.
    const weight = 1 + Math.min(c.upvotes ?? 0, MAX_UPVOTE_WEIGHT);

    if (payload.kind === "missing" || payload.kind === "wrong") entry.disputes += weight;
    else entry.reports += weight;

    if (payload.fare && payload.fare.length === 2) {
      const list = fares.get(key) ?? [];
      for (let i = 0; i < weight; i++) list.push(payload.fare);
      fares.set(key, list);
    }
    if (payload.kind === "board" && payload.board) entry.board = payload.board;
    if (payload.note) entry.notes.push(payload.note);
    overrides.set(key, entry);
  }

  for (const [key, reported] of fares) {
    if (reported.length < MIN_REPORTS) continue;
    const entry = overrides.get(key);
    if (!entry) continue;
    entry.fare = [median(reported.map((f) => f[0])), median(reported.map((f) => f[1]))];
    if (entry.fare[1] < entry.fare[0]) entry.fare = [entry.fare[0], entry.fare[0]];
  }
  return overrides;
}

let cache: { at: number; overrides: Overrides; total: number } | null = null;

/**
 * Corrections currently in force. Reads 0G Chain (cached); an unreachable or
 * undeployed contract simply means no overrides yet.
 */
export async function loadOverrides(): Promise<{ overrides: Overrides; total: number }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { overrides: cache.overrides, total: cache.total };
  }
  let corrections: Correction[] = [];
  try {
    corrections = await getRecentCorrections(CORRECTIONS_TO_READ);
  } catch (e) {
    // No contract deployed yet, or the chain is slow — carry on uncorrected.
    console.warn("corrections unavailable:", (e as Error).message);
  }
  const overrides = aggregate(corrections);
  cache = { at: Date.now(), overrides, total: corrections.length };
  return { overrides, total: corrections.length };
}

/** Forget the cached corrections (after a new one is submitted). */
export function invalidateOverrides() {
  cache = null;
}

const applied = new Map<string, RouteKB>();

/**
 * The route database with rider corrections applied. Corrected routes keep a
 * note so answers can say the fare came from riders, not the published table.
 */
export function applyCorrections(kb: RouteKB, overrides: Overrides): RouteKB {
  if (!overrides.size) return kb;

  // Same corrections + same data = same object, so the planner's graph cache holds.
  const signature = [...overrides.entries()]
    .map(([k, v]) => `${k}:${v.fare?.join("-") ?? ""}:${v.board ?? ""}:${v.reports}`)
    .sort()
    .join("|");
  const cacheKey = `${kb.version}@${kb.updatedAt}#${signature}`;
  const hit = applied.get(cacheKey);
  if (hit) return hit;

  let changed = false;
  const routes: KBRoute[] = kb.routes.map((route) => {
    const forward = overrides.get(overrideKey(route.from, route.to, route.mode));
    const reverse = overrides.get(overrideKey(route.to, route.from, route.mode));
    const o = forward ?? reverse;
    if (!o || (!o.fare && !o.board)) return route;
    changed = true;
    const riders = o.reports === 1 ? "1 rider" : `${o.reports} riders`;
    return {
      ...route,
      fare: o.fare ?? route.fare,
      board: o.board && forward ? o.board : route.board,
      boardReverse: o.board && !forward ? o.board : route.boardReverse,
      communityCorrected: true,
      notes: [route.notes, o.fare ? `Fare corrected by ${riders} using this route.` : ""]
        .filter(Boolean)
        .join(" ")
        .trim(),
    };
  });

  if (!changed) return kb;
  const corrected: RouteKB = { ...kb, routes };
  if (applied.size > 8) applied.clear();
  applied.set(cacheKey, corrected);
  return corrected;
}
