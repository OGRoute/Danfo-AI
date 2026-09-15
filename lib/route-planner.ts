/**
 * Deterministic trip planner over the route knowledge base.
 *
 * The chat model on 0G Compute is small, so it is never asked to work out a
 * route or a price on its own. This module turns "CMS to Ikeja" into concrete
 * legs — which vehicle, where to board, where to get off, what it costs —
 * using only data from data/lagos-routes.json. The model then explains the
 * plan in the rider's language, and the UI shows the same plan as a trip card
 * and on the live map, so the numbers always agree.
 */
import type { KBRoute, RouteKB } from "./prompt";
import {
  LAGOS_STOPS,
  findStopHits,
  haversineKm,
  nearestStop,
  type LatLng,
} from "./lagos-stops";

export interface TripLeg {
  from: string;
  to: string;
  mode: string;
  line?: string;
  fare: [number, number];
  duration?: [number, number];
  /** Where to get on, as specifically as the data allows. */
  board: string;
  /** Where to get off. */
  alight: string;
  /** The line's final stop, when boarding part-way along it ("the one heading to Ajah"). */
  towards?: string;
  /** Ordered stops travelled through, from → to (drawn on the map). */
  path: string[];
  /** True when the fare is pro-rated for part of a line rather than published. */
  estimated: boolean;
  notes?: string;
}

export interface Itinerary {
  from: string;
  to: string;
  legs: TripLeg[];
  fare: [number, number];
  duration?: [number, number];
}

export interface TripPlan {
  origin: string | null;
  destination: string | null;
  /** How the origin was found: named by the rider, or nearest to their GPS fix. */
  originSource: "text" | "location" | null;
  /** Places with no mapped route that were swapped for a nearby served stop. */
  substitutions: Array<{ requested: string; used: string; km: number }>;
  best: Itinerary | null;
  alternatives: Itinerary[];
}

export function formatNaira([lo, hi]: [number, number]): string {
  const f = (n: number) => `₦${n.toLocaleString("en-NG")}`;
  return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
}

export function formatMinutes([lo, hi]: [number, number]): string {
  const f = (m: number) =>
    m < 60 ? `${m}` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
  if (hi < 60) return lo === hi ? `${lo} min` : `${lo}–${hi} min`;
  return lo === hi ? f(lo) : `${f(lo)}${lo < 60 ? " min" : ""}–${f(hi)}`;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

// Lowest fare charged for any ride on a mode, used when pro-rating a section.
const MIN_FARE: Record<string, number> = { danfo: 300, keke: 200, brt: 300, rail: 200, ferry: 1000 };
// Naira-equivalent cost of getting off and boarding another vehicle.
const TRANSFER_PENALTY = 250;
// Naira-equivalent value of a minute of travel time.
const MINUTE_COST = 8;
// Slight preference for published end-to-end fares over pro-rated sections.
const ESTIMATE_PENALTY = 40;
const MAX_LEGS = 4;
// How far a named place may be from a served stop before we give up on it.
const SNAP_KM = 4;

interface Edge {
  from: string;
  to: string;
  route: KBRoute;
  /** Every stop of the route in this edge's direction of travel. */
  seq: string[];
  path: string[];
  fare: [number, number];
  duration?: [number, number];
  estimated: boolean;
  reverse: boolean;
  cost: number;
}

type Graph = Map<string, Edge[]>;

function pathKm(path: string[]): number {
  let km = 0;
  for (let i = 1; i < path.length; i++) {
    const a = LAGOS_STOPS[path[i - 1]];
    const b = LAGOS_STOPS[path[i]];
    if (a && b) km += haversineKm(a, b);
  }
  return km;
}

const round50 = (n: number) => Math.max(50, Math.round(n / 50) * 50);

/**
 * Every route becomes edges in both directions (unless oneWay), including
 * boarding/alighting at intermediate "via" stops — riders join a BRT at
 * Maryland or a danfo at Costain all the time. Section fares are pro-rated by
 * distance and flagged as estimates.
 */
function buildGraph(kb: RouteKB): Graph {
  const graph: Graph = new Map();
  for (const route of kb.routes) {
    const forward = [route.from, ...(route.via ?? []), route.to];
    const total = pathKm(forward) || 1;
    const directions: Array<[string[], boolean]> = [[forward, false]];
    if (!route.oneWay) directions.push([[...forward].reverse(), true]);

    for (const [seq, reverse] of directions) {
      for (let i = 0; i < seq.length - 1; i++) {
        for (let j = i + 1; j < seq.length; j++) {
          const path = seq.slice(i, j + 1);
          const full = i === 0 && j === seq.length - 1;
          const share = full ? 1 : Math.min(1, pathKm(path) / total);
          const floor = Math.min(route.minFare ?? MIN_FARE[route.mode] ?? 200, route.fare[0]);
          const fare: [number, number] = full
            ? route.fare
            : [
                round50(Math.max(floor, route.fare[0] * share)),
                round50(Math.max(floor, route.fare[1] * share)),
              ];
          if (fare[1] < fare[0]) fare[1] = fare[0];
          // Riding time, plus up to one typical wait for the vehicle to come.
          const wait = route.wait ?? 0;
          const duration: [number, number] | undefined =
            route.duration &&
            (full
              ? [route.duration[0], route.duration[1] + wait]
              : [
                  Math.max(5, Math.round(route.duration[0] * share)),
                  Math.max(5, Math.round(route.duration[1] * share)) + wait,
                ]);
          const minutes = duration ? (duration[0] + duration[1]) / 2 : pathKm(path) * 4 + wait / 2;
          const edge: Edge = {
            from: path[0],
            to: path[path.length - 1],
            route,
            seq,
            path,
            fare,
            duration,
            estimated: !full,
            reverse,
            cost:
              (fare[0] + fare[1]) / 2 +
              minutes * MINUTE_COST +
              TRANSFER_PENALTY +
              (full ? 0 : ESTIMATE_PENALTY),
          };
          const list = graph.get(edge.from) ?? [];
          list.push(edge);
          graph.set(edge.from, list);
        }
      }
    }
  }
  // A published fare beats a pro-rated estimate for the same hop on the same mode.
  const published = new Set<string>();
  for (const list of graph.values()) {
    for (const e of list) if (!e.estimated) published.add(`${e.from}>${e.to}:${e.route.mode}`);
  }
  for (const [stop, list] of graph) {
    graph.set(
      stop,
      list.filter((e) => !e.estimated || !published.has(`${e.from}>${e.to}:${e.route.mode}`))
    );
  }
  return graph;
}

const graphs = new WeakMap<RouteKB, Graph>();
function graphFor(kb: RouteKB): Graph {
  let g = graphs.get(kb);
  if (!g) {
    g = buildGraph(kb);
    graphs.set(kb, g);
  }
  return g;
}

/** Dijkstra over stops; `banned` edges are skipped (used to find alternatives). */
function shortestPath(graph: Graph, source: string, target: string, banned: Set<Edge>): Edge[] | null {
  const dist = new Map<string, number>([[source, 0]]);
  const legs = new Map<string, number>([[source, 0]]);
  const prev = new Map<string, Edge>();
  const done = new Set<string>();

  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const [node, d] of dist) {
      if (!done.has(node) && d < best) {
        best = d;
        u = node;
      }
    }
    if (u === null) return null;
    if (u === target) break;
    done.add(u);
    const usedLegs = legs.get(u) ?? 0;
    if (usedLegs >= MAX_LEGS) continue;

    const arrivedBy = prev.get(u);
    for (const e of graph.get(u) ?? []) {
      if (banned.has(e) || done.has(e.to)) continue;
      if (arrivedBy) {
        // Never get off and straight back onto the same line, nor change onto
        // a vehicle that also stops where the previous one was boarded — the
        // rider could simply have taken that one from the start.
        if (arrivedBy.route === e.route) continue;
        const boardedAt = e.seq.indexOf(arrivedBy.from);
        if (boardedAt !== -1 && boardedAt < e.seq.indexOf(e.from)) continue;
      }
      const next = best + e.cost;
      if (next < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, next);
        prev.set(e.to, e);
        legs.set(e.to, usedLegs + 1);
      }
    }
  }

  const out: Edge[] = [];
  for (let cur = target; cur !== source; ) {
    const e = prev.get(cur);
    if (!e) return null;
    out.unshift(e);
    cur = e.from;
  }
  return out;
}

const VEHICLE: Record<string, string> = { danfo: "danfo", brt: "BRT bus", rail: "train", ferry: "ferry", keke: "keke" };
const PLACE: Record<string, string> = { rail: "station", ferry: "jetty", keke: "keke stand" };
const firstClause = (s: string) => s.split(" — ")[0];

function legFromEdge(e: Edge): TripLeg {
  const r = e.route;
  const lineStart = e.reverse ? r.to : r.from;
  const lineEnd = e.reverse ? r.from : r.to;
  const place = PLACE[r.mode] ?? "bus stop";
  const boardHere = e.reverse ? r.boardReverse : r.board;
  const boardAtEnd = e.reverse ? r.board : r.boardReverse;

  const atNamedStart = e.from === lineStart && !!boardHere;
  const board = atNamedStart
    ? boardHere!
    : `${e.from} ${place} — take the ${VEHICLE[r.mode] ?? r.mode} heading to ${lineEnd}`;
  // The terminal you arrive at is where the opposite direction boards.
  const alight = e.to === lineEnd && boardAtEnd ? firstClause(boardAtEnd) : `${e.to} ${place}`;

  return {
    from: e.from,
    to: e.to,
    mode: r.mode,
    line: r.line,
    fare: e.fare,
    duration: e.duration,
    board,
    alight,
    towards: atNamedStart ? undefined : lineEnd,
    path: e.path,
    estimated: e.estimated,
    notes: r.notes,
  };
}

function toItinerary(edges: Edge[]): Itinerary {
  const legs = edges.map(legFromEdge);
  const transfers = Math.max(0, legs.length - 1);
  const timed = legs.every((l) => l.duration);
  return {
    from: legs[0].from,
    to: legs[legs.length - 1].to,
    legs,
    fare: [
      legs.reduce((s, l) => s + l.fare[0], 0),
      legs.reduce((s, l) => s + l.fare[1], 0),
    ],
    // Allow 5–10 minutes to walk between vehicles at each change.
    duration: timed
      ? [
          legs.reduce((s, l) => s + l.duration![0], 0) + transfers * 5,
          legs.reduce((s, l) => s + l.duration![1], 0) + transfers * 10,
        ]
      : undefined,
  };
}

const pathCost = (edges: Edge[]) => edges.reduce((s, e) => s + e.cost, 0);
const signature = (edges: Edge[]) =>
  edges.map((e) => `${e.from}>${e.to}:${e.route.mode}`).join("|");

/** Best route plus up to two meaningfully different alternatives. */
function planRoute(graph: Graph, origin: string, destination: string) {
  const best = shortestPath(graph, origin, destination, new Set());
  if (!best) return { best: null, alternatives: [] as Itinerary[] };

  const seen = new Set([signature(best)]);
  const found: Edge[][] = [];
  for (const e of best) {
    // Ban boarding this line at this stop (any section), then re-plan.
    const banned = new Set((graph.get(e.from) ?? []).filter((x) => x.route === e.route));
    const alt = shortestPath(graph, origin, destination, banned);
    if (alt && !seen.has(signature(alt))) {
      seen.add(signature(alt));
      found.push(alt);
    }
  }

  // Prefer alternatives that ride different kinds of vehicle (the ferry or the
  // train rather than a second variant of the same bus trip), then fill by cost.
  const limit = pathCost(best) * 2.2;
  const modes = (edges: Edge[]) => edges.map((e) => e.route.mode).join(">");
  const candidates = found
    .filter((a) => pathCost(a) <= limit)
    .sort((a, b) => pathCost(a) - pathCost(b));
  const seenModes = new Set([modes(best)]);
  const picked: Edge[][] = [];
  for (const a of candidates) {
    if (picked.length < 2 && !seenModes.has(modes(a))) {
      picked.push(a);
      seenModes.add(modes(a));
    }
  }
  for (const a of candidates) if (picked.length < 2 && !picked.includes(a)) picked.push(a);

  const alternatives = picked.sort((a, b) => pathCost(a) - pathCost(b)).map(toItinerary);
  return { best: toItinerary(best), alternatives };
}

/** Use the stop if it has routes; otherwise the nearest stop that does. */
function snapToNetwork(graph: Graph, name: string): { used: string; km: number } | null {
  if (graph.has(name)) return { used: name, km: 0 };
  const pos = LAGOS_STOPS[name];
  if (!pos) return null;
  let best: { used: string; km: number } | null = null;
  for (const node of graph.keys()) {
    const p = LAGOS_STOPS[node];
    if (!p) continue;
    const km = haversineKm(pos, p);
    if (km <= SNAP_KM && (!best || km < best.km)) best = { used: node, km };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Understanding the request
// ---------------------------------------------------------------------------

// Words that come right before a place, in English, Pidgin, Yoruba, Igbo and
// Hausa (matched on diacritic-free text). "lati Yaba" = from Yaba, "si Oshodi"
// = to Oshodi, "site na" / "gaa" (Igbo), "daga" / "zuwa" (Hausa).
const ORIGIN_MARKERS = [
  "from", "lati", "site na", "site", "daga", "comot for", "comot from", "leaving",
  "leave", "start from", "starting from", "i am at", "im at", "i dey", "dey for",
  "mo wa ni", "wa ni", "near",
];
const DEST_MARKERS = [
  "to", "si", "go", "gaa", "zuwa", "reach", "towards", "enter", "get to", "going",
  "destination", "for",
];

function precededBy(normalized: string, start: number, markers: string[]): boolean {
  const before = ` ${normalized.slice(Math.max(0, start - 30), start)}`;
  return markers.some((m) => before.endsWith(` ${m} `));
}

/** Pull origin/destination stop names out of one message. */
export function parseTrip(text: string): { origin: string | null; destination: string | null } {
  const { hits, normalized } = findStopHits(text);
  let origin: string | null = null;
  let destination: string | null = null;
  const unmarked: string[] = [];

  for (const h of hits) {
    if (!origin && precededBy(normalized, h.start, ORIGIN_MARKERS)) origin = h.name;
    else if (!destination && precededBy(normalized, h.start, DEST_MARKERS)) destination = h.name;
    else unmarked.push(h.name);
  }

  const free = unmarked.filter(
    (n, i) => n !== origin && n !== destination && unmarked.indexOf(n) === i
  );
  if (origin && !destination) destination = free[0] ?? null;
  else if (!origin && destination) origin = free[0] ?? null;
  else if (!origin && !destination) {
    // No markers: "CMS Oshodi" reads as from → to; a lone place is where they're going.
    if (free.length >= 2) [origin, destination] = [free[0], free[1]];
    else destination = free[0] ?? null;
  }
  if (origin === destination) origin = null;
  return { origin, destination };
}

/**
 * Plan the trip the conversation is about.
 * @param userTexts the rider's messages, oldest first
 * @param location  the rider's live GPS position, if they shared it
 */
export function planTrip(kb: RouteKB, userTexts: string[], location?: LatLng | null): TripPlan {
  const graph = graphFor(kb);
  let { origin, destination } = parseTrip(userTexts[userTexts.length - 1] ?? "");
  let originSource: TripPlan["originSource"] = origin ? "text" : null;

  // "How do I get to Ikeja?" with live location on: start from the nearest stop.
  if (!origin && destination && location) {
    const near = nearestStop(location, 8);
    if (near && near.name !== destination) {
      origin = near.name;
      originSource = "location";
    }
  }

  // Follow-ups ("and from Yaba?") inherit whatever the latest message left out.
  for (let i = userTexts.length - 2; i >= Math.max(0, userTexts.length - 4); i--) {
    if (origin && destination) break;
    const earlier = parseTrip(userTexts[i]);
    if (!destination && earlier.destination && earlier.destination !== origin) {
      destination = earlier.destination;
    }
    if (!origin && earlier.origin && earlier.origin !== destination) {
      origin = earlier.origin;
      originSource = "text";
    }
  }

  const plan: TripPlan = {
    origin,
    destination,
    originSource,
    substitutions: [],
    best: null,
    alternatives: [],
  };
  if (!origin || !destination || origin === destination) return plan;

  const from = snapToNetwork(graph, origin);
  const to = snapToNetwork(graph, destination);
  if (!from || !to || from.used === to.used) return plan;
  for (const [requested, snap] of [
    [origin, from],
    [destination, to],
  ] as const) {
    if (snap.km > 0) {
      plan.substitutions.push({ requested, used: snap.used, km: Math.round(snap.km * 10) / 10 });
    }
  }

  const { best, alternatives } = planRoute(graph, from.used, to.used);
  plan.best = best;
  plan.alternatives = alternatives;
  return plan;
}

/** Knowledge-base routes that touch the trip, most relevant first. */
export function relevantRoutes(kb: RouteKB, plan: TripPlan, limit = 14): KBRoute[] {
  const involved = new Set(
    [
      plan.origin,
      plan.destination,
      ...plan.substitutions.map((s) => s.used),
      ...[plan.best, ...plan.alternatives].flatMap((it) => it?.legs.flatMap((l) => l.path) ?? []),
    ].filter((s): s is string => !!s)
  );
  if (!involved.size) return [];
  const score = (r: KBRoute) => [r.from, ...(r.via ?? []), r.to].filter((s) => involved.has(s)).length;
  return kb.routes
    .filter((r) => score(r) > 0)
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}
