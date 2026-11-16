/**
 * Every place a rider can pick as a start or a destination: the stops the
 * route database serves, plus the Lagos State gazetteer in
 * data/lagos-places.json (areas, estates, markets, campuses, hospitals and
 * landmarks across all 20 LGAs — built by scripts/build-places.ts).
 *
 * A picked place is sent to the server by id, so the trip is planned between
 * two exact points instead of whatever could be read out of a typed sentence.
 */
import gazetteer from "../data/lagos-places.json";
import { STOP_LIST, haversineKm, normalizeText, spellingDistance, type LatLng } from "./lagos-stops";

export type PlaceKind =
  | "stop"
  | "area"
  | "estate"
  | "market"
  | "campus"
  | "hospital"
  | "mall"
  | "terminal"
  | "airport"
  | "landmark";

export interface PickerPlace {
  /** Stable id sent to the server: "stop:Yaba" or "place:allen-avenue". */
  id: string;
  name: string;
  aliases: string[];
  kind: PlaceKind;
  /** Local government area, for places from the gazetteer. */
  lga?: string;
  pos: LatLng;
}

export const KIND_LABEL: Record<PlaceKind, string> = {
  stop: "Bus stop",
  area: "Area",
  estate: "Estate",
  market: "Market",
  campus: "Campus",
  hospital: "Hospital",
  mall: "Mall",
  terminal: "Terminal",
  airport: "Airport",
  landmark: "Landmark",
};

interface RawPlace {
  id: string;
  name: string;
  aliases?: string[];
  kind: string;
  lga: string;
  pos: number[];
}

const flat = (s: string) => normalizeText(s).trim();

const stops: PickerPlace[] = STOP_LIST.map((s) => ({
  id: `stop:${s.name}`,
  name: s.name,
  aliases: s.aliases,
  kind: "stop",
  pos: s.pos,
}));
const stopNames = new Set(stops.map((s) => flat(s.name)));

const extra: PickerPlace[] = ((gazetteer as { places: RawPlace[] }).places ?? [])
  // A stop of the same name is the better answer: it is where vehicles load.
  .filter((p) => !stopNames.has(flat(p.name)) && p.pos?.length === 2)
  .map((p) => ({
    id: `place:${p.id}`,
    name: p.name,
    aliases: p.aliases ?? [],
    kind: (p.kind in KIND_LABEL ? p.kind : "area") as PlaceKind,
    lga: p.lga,
    pos: [p.pos[0], p.pos[1]],
  }));

export const PICKER_PLACES: PickerPlace[] = [...stops, ...extra];

const byId = new Map(PICKER_PLACES.map((p) => [p.id, p]));
export function placeById(id: unknown): PickerPlace | null {
  return typeof id === "string" ? byId.get(id) ?? null : null;
}

// Pre-normalised names for searching.
const INDEX = PICKER_PLACES.map((place) => ({
  place,
  name: flat(place.name),
  aliases: place.aliases.map(flat),
}));

/** The hubs most trips start or end at, offered before the rider types. */
const POPULAR = [
  "Ikeja", "Oshodi", "CMS", "Yaba", "Obalende", "Lekki Phase 1", "Ajah", "Victoria Island",
  "Ikorodu", "Mile 2", "Berger", "Iyana Ipaja", "Festac", "Surulere",
]
  .map((n) => byId.get(`stop:${n}`))
  .filter((p): p is PickerPlace => !!p);

function matchScore(q: string, text: string): number {
  if (text === q) return 100;
  if (text.startsWith(q)) return 80;
  if (text.split(" ").some((w) => w.startsWith(q))) return 62;
  if (text.includes(q)) return 45;
  return 0;
}

/**
 * Places matching what the rider typed, best first. Matches names and aliases
 * without regard to accents, case or punctuation, and forgives a letter or two
 * of misspelling ("oshodhi", "ikaja"). With nothing typed it offers the places
 * nearest `near`, or the busiest hubs.
 */
export function searchPlaces(query: string, limit = 8, near?: LatLng | null): PickerPlace[] {
  const q = flat(query);
  if (!q) return near ? nearestPlaces(near, limit) : POPULAR.slice(0, limit);

  const scored: Array<{ place: PickerPlace; score: number }> = [];
  for (const entry of INDEX) {
    let score = matchScore(q, entry.name);
    for (const alias of entry.aliases) score = Math.max(score, matchScore(q, alias) - 6);
    if (score === 0 && q.length >= 5) {
      // Spelling slips, on whole names only.
      const budget = q.length <= 6 ? 1 : 2;
      for (const candidate of [entry.name, ...entry.aliases]) {
        if (Math.abs(candidate.length - q.length) > budget) continue;
        if (spellingDistance(q, candidate) <= budget) {
          score = 30;
          break;
        }
      }
    }
    if (score === 0) continue;
    // Served stops first among equals, then shorter (more exact) names.
    if (entry.place.kind === "stop") score += 5;
    if (near) score += Math.max(0, 4 - haversineKm(near, entry.place.pos) / 5);
    scored.push({ place: entry.place, score: score - entry.name.length / 100 });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.place);
}

/** The places closest to a position, nearest first. */
export function nearestPlaces(pos: LatLng, limit = 6, maxKm = 6): PickerPlace[] {
  return PICKER_PLACES.map((place) => ({ place, km: haversineKm(pos, place.pos) }))
    .filter((p) => p.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
    .map((p) => p.place);
}

/** Lagos State with a margin, to tell a rider in another city from one in Lagos. */
export function isInLagosArea([lat, lng]: LatLng): boolean {
  return lat >= 6.3 && lat <= 6.95 && lng >= 2.65 && lng <= 4.4;
}

/** Second line under a place in the picker: "Market · Ikeja". */
export function placeSubtitle(p: PickerPlace): string {
  return p.lga ? `${KIND_LABEL[p.kind]} · ${p.lga}` : KIND_LABEL[p.kind];
}
