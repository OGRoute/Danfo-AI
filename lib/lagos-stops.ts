/**
 * Lagos stops: approximate coordinates plus the names riders actually say.
 *
 * Coordinates are hand-placed landmark points (good enough to plot and route a
 * trip on a city map — not survey-grade). Keys match the stop names used in
 * data/lagos-routes.json exactly. Aliases are matched diacritic- and
 * punctuation-insensitively, so "Ọ̀ṣọ́dì", "Mile-2" and "V.I" all resolve.
 */
export type LatLng = [number, number];

interface StopDef {
  pos: LatLng;
  aliases?: string[];
}

const STOP_DEFS: Record<string, StopDef> = {
  // --- Lagos Island ---
  CMS: { pos: [6.452, 3.389], aliases: ["C.M.S", "Church Missionary Society"] },
  Marina: { pos: [6.451, 3.387], aliases: ["Marina station"] },
  TBS: { pos: [6.4476, 3.3983], aliases: ["Tafawa Balewa Square", "Tafawa Balewa", "Onikan"] },
  Obalende: { pos: [6.4495, 3.404] },
  Idumota: { pos: [6.458, 3.386], aliases: ["Lagos Island"] },
  Falomo: { pos: [6.444, 3.429], aliases: ["Ikoyi", "Five Cowries", "Five Cowries Terminal"] },
  "Victoria Island": { pos: [6.4281, 3.4219], aliases: ["VI", "V.I", "Victoria Island"] },
  "Lekki Phase 1": {
    pos: [6.4474, 3.4723],
    aliases: ["Lekki", "Lekki Phase One", "Lekki 1", "Lekki first gate", "Lekki Phase I"],
  },
  Ajah: { pos: [6.468, 3.57], aliases: ["Ajah junction", "Ajah under bridge"] },

  // --- Mainland: Ikorodu Road corridor ---
  Ikorodu: { pos: [6.6194, 3.5105], aliases: ["Ikorodu garage", "Ikorodu terminal", "Ikorodu roundabout"] },
  "Ikorodu Ferry Terminal": {
    pos: [6.5935, 3.4885],
    aliases: ["Ikorodu jetty", "Ebute jetty", "Ebute Ikorodu", "Ikorodu ferry"],
  },
  "Owode Onirin": { pos: [6.609, 3.419], aliases: ["Owode-Onirin"] },
  "Mile 12": { pos: [6.606, 3.399], aliases: ["Mile twelve", "Mile12"] },
  Ketu: { pos: [6.5966, 3.3905] },
  Ojota: { pos: [6.583, 3.383] },
  Maryland: { pos: [6.572, 3.366] },
  Anthony: { pos: [6.56, 3.371], aliases: ["Anthony Village"] },
  Gbagada: { pos: [6.554, 3.386] },
  Obanikoro: { pos: [6.551, 3.366] },
  Palmgrove: { pos: [6.542, 3.368], aliases: ["Palm Grove"] },
  Fadeyi: { pos: [6.534, 3.37] },
  Yaba: { pos: [6.5095, 3.3711], aliases: ["Yaba bus stop", "Tejuosho"] },
  Oyingbo: { pos: [6.487, 3.384], aliases: ["Ebute Metta", "Ebute-Metta"] },
  Iddo: { pos: [6.465, 3.385], aliases: ["Iddo terminal"] },
  Berger: { pos: [6.64, 3.379], aliases: ["Ojodu Berger", "Ojodu-Berger"] },

  // --- Mainland: Oshodi / Ikeja / Agege axis ---
  Oshodi: { pos: [6.554, 3.345], aliases: ["Oshodi terminal", "Oshodi interchange", "Oshodi under bridge"] },
  Bolade: { pos: [6.561, 3.344] },
  Shogunle: { pos: [6.576, 3.347] },
  Ikeja: { pos: [6.6018, 3.3515], aliases: ["Ikeja Along", "Ikeja Under Bridge", "Ikeja bus stop"] },
  Agege: { pos: [6.618, 3.3209] },
  Iju: { pos: [6.66, 3.312] },
  Agbado: { pos: [6.683, 3.285], aliases: ["Agbado station"] },
  "Iyana Ipaja": { pos: [6.613, 3.296], aliases: ["Iyana-Ipaja"] },
  "Abule Egba": { pos: [6.647, 3.301], aliases: ["Abule-Egba", "Abuleegba"] },
  Egbeda: { pos: [6.593, 3.292] },
  Ikotun: { pos: [6.55, 3.264] },
  Mushin: { pos: [6.527, 3.349] },
  Cele: { pos: [6.527, 3.333], aliases: ["Cele Okota", "Ijesha"] },

  // --- Surulere / Apapa / Badagry axis ---
  Ojuelegba: { pos: [6.5106, 3.362], aliases: ["Ojuelegba under bridge"] },
  Surulere: { pos: [6.5, 3.35], aliases: ["National Stadium"] },
  Costain: { pos: [6.483, 3.366] },
  "National Theatre": { pos: [6.476, 3.37], aliases: ["National Theater"] },
  "Orile Iganmu": { pos: [6.47, 3.348], aliases: ["Orile", "Iganmu", "Orile-Iganmu"] },
  "Suru Alaba": { pos: [6.466, 3.333], aliases: ["Suru-Alaba", "Alaba Suru"] },
  "Mile 2": { pos: [6.464, 3.314], aliases: ["Mile two", "Mile2"] },
  Festac: { pos: [6.4667, 3.2833], aliases: ["Festac Town", "Festac first gate"] },
  Apapa: { pos: [6.449, 3.363] },
  Badagry: { pos: [6.415, 2.881] },
};

export const LAGOS_STOPS: Record<string, LatLng> = Object.fromEntries(
  Object.entries(STOP_DEFS).map(([name, def]) => [name, def.pos])
);

/** Rough geographic centre of Lagos, for the default map view. */
export const LAGOS_CENTER: LatLng = [6.5244, 3.3792];

// Hausa hooked letters don't decompose under NFD, so map them explicitly.
const HOOKED: Record<string, string> = { ƙ: "k", ɗ: "d", ɓ: "b", ƴ: "y", Ƙ: "k", Ɗ: "d", Ɓ: "b", Ƴ: "y" };

/**
 * Lower-case, strip tone marks / dots-below and punctuation, collapse spaces,
 * and pad with one space each side so phrase lookups land on word boundaries.
 */
export function normalizeText(text: string): string {
  const flat = text
    .replace(/[ƙɗɓƴƘƊƁƳ]/g, (c) => HOOKED[c])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return ` ${flat} `;
}

export interface StopHit {
  name: string;
  /** Span of the match inside the normalized text. */
  start: number;
  end: number;
}

// Every name + alias, longest first so "Lekki Phase 1" beats a bare "Lekki".
const PATTERNS = Object.entries(STOP_DEFS)
  .flatMap(([name, def]) =>
    [name, ...(def.aliases ?? [])].map((alias) => ({ name, needle: normalizeText(alias) }))
  )
  .sort((a, b) => b.needle.length - a.needle.length);

/** Find stop mentions (with positions) in free text, in order of appearance. */
export function findStopHits(text: string): { hits: StopHit[]; normalized: string } {
  const normalized = normalizeText(text || "");
  const hits: StopHit[] = [];
  for (const { name, needle } of PATTERNS) {
    let from = 0;
    for (;;) {
      const idx = normalized.indexOf(needle, from);
      if (idx === -1) break;
      // The needle is space-padded; its inner span is the actual word(s).
      const start = idx + 1;
      const end = idx + needle.length - 1;
      if (!hits.some((h) => start < h.end && end > h.start)) hits.push({ name, start, end });
      from = idx + 1;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  return { hits, normalized };
}

/** Stop names mentioned in the text, de-duplicated, in order of appearance. */
export function findStopsInText(text: string): string[] {
  const names = findStopHits(text).hits.map((h) => h.name);
  return names.filter((name, i) => names.indexOf(name) === i);
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Closest known stop to a position, if one is within `maxKm`. */
export function nearestStop(pos: LatLng, maxKm = Infinity): { name: string; km: number } | null {
  let best: { name: string; km: number } | null = null;
  for (const [name, p] of Object.entries(LAGOS_STOPS)) {
    const km = haversineKm(pos, p);
    if (km <= maxKm && (!best || km < best.km)) best = { name, km };
  }
  return best;
}
