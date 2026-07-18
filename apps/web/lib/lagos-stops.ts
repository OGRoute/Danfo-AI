/**
 * Approximate coordinates for the Lagos stops in data/lagos-routes.json.
 *
 * These are hand-placed landmark points (good enough to plot routes on a city
 * map for a transit demo — not survey-grade). Keys match the stop names used in
 * the knowledge base exactly.
 */
export type LatLng = [number, number];

export const LAGOS_STOPS: Record<string, LatLng> = {
  CMS: [6.4499, 3.3903],
  Obalende: [6.4485, 3.403],
  TBS: [6.4497, 3.3925],
  Marina: [6.453, 3.3915],
  Oshodi: [6.5556, 3.3486],
  Yaba: [6.5095, 3.3711],
  Ojuelegba: [6.5106, 3.362],
  "Mile 2": [6.4667, 3.307],
  Festac: [6.4667, 3.2833],
  Ikeja: [6.6018, 3.3515],
  Berger: [6.639, 3.381],
  Ojota: [6.583, 3.383],
  Maryland: [6.57, 3.367],
  Ketu: [6.59, 3.386],
  "Mile 12": [6.6, 3.396],
  Ikorodu: [6.6194, 3.5105],
  Ajah: [6.4667, 3.5667],
  "Lekki Phase 1": [6.445, 3.475],
  "Victoria Island": [6.4281, 3.4219],
  Surulere: [6.5, 3.35],
  Costain: [6.483, 3.366],
  "Iyana Ipaja": [6.613, 3.296],
  Agege: [6.615, 3.321],
  "Abule Egba": [6.647, 3.301],
  // A couple of "via" points that appear in routes but not the stops list.
  Bolade: [6.5497, 3.3486],
};

/** Rough geographic centre of Lagos, for the default map view. */
export const LAGOS_CENTER: LatLng = [6.5244, 3.3792];

/**
 * Scan free text for known stop names and return the matched stops in the order
 * they appear. Used to highlight a route the user/assistant is talking about.
 * Longer names are matched first so "Lekki Phase 1" wins over a bare "Lekki".
 */
export function findStopsInText(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const names = Object.keys(LAGOS_STOPS).sort((a, b) => b.length - a.length);
  const hits: { name: string; index: number }[] = [];
  const claimed: Array<[number, number]> = [];

  for (const name of names) {
    let from = 0;
    const needle = name.toLowerCase();
    // Find every occurrence, skipping spans already claimed by a longer name.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      const overlaps = claimed.some(([s, e]) => idx < e && end > s);
      if (!overlaps) {
        hits.push({ name, index: idx });
        claimed.push([idx, end]);
      }
      from = end;
    }
  }

  return hits
    .sort((a, b) => a.index - b.index)
    .map((h) => h.name)
    .filter((name, i, arr) => arr.indexOf(name) === i); // de-dupe, keep first order
}
