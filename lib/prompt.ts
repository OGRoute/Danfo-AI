/**
 * Builds the DanfoAI system prompt.
 *
 * Accuracy strategy: the 0G testnet chat model is small (7B). Asked to work a
 * route out from raw data it mixes up fares, copies notes verbatim and gets
 * comparisons backwards. So the server does the reasoning:
 *  - lib/route-planner.ts computes the trip from the route knowledge base
 *    (loaded from 0G Storage at runtime), and
 *  - composeAnswer() turns it into the complete, detailed reply in English.
 * The model's job is to rephrase that reply naturally, or translate it into
 * Pidgin, Yoruba, Igbo or Hausa. It doesn't always manage (it can loop in
 * Yoruba), so replyKeepsFacts() checks its text and the chat route falls back
 * to the computed answer when facts were lost or changed.
 */
import { LANGUAGE_NAMES, type LangCode } from "./language-detect";
import { normalizeText } from "./lagos-stops";
import {
  formatMinutes,
  formatNaira,
  relevantRoutes,
  type Itinerary,
  type TripLeg,
  type TripPlan,
} from "./route-planner";

export interface KBRoute {
  from: string;
  to: string;
  mode: string;
  fare: [number, number];
  /** Typical door-to-door minutes, [fast, slow]. */
  duration?: [number, number];
  via?: string[];
  /** Named line or corridor, e.g. "Lagos Blue Line". */
  line?: string;
  /** Where to board when travelling from → to. */
  board?: string;
  /** Where to board when travelling to → from. */
  boardReverse?: string;
  /** Set for services that don't run in the reverse direction. */
  oneWay?: boolean;
  /** Lowest fare for a short ride on this line (defaults by mode). */
  minFare?: number;
  /** Typical wait for the next vehicle in minutes, added to journey time. */
  wait?: number;
  notes?: string;
}

export interface RouteKB {
  version: number;
  updatedAt: string;
  currency: string;
  fareNote?: string;
  stops: string[];
  routes: KBRoute[];
  tips?: string[];
  phrases?: Record<string, { greeting: string; thanks: string }>;
}

const VEHICLE_NAME: Record<string, string> = {
  danfo: "danfo (yellow bus)",
  brt: "BRT bus",
  rail: "train",
  ferry: "ferry",
  keke: "keke (tricycle)",
};

const VEHICLE_SHORT: Record<string, string> = {
  danfo: "danfo",
  brt: "BRT bus",
  rail: "train",
  ferry: "ferry",
  keke: "keke",
};

const TAKE_VEHICLE: Record<string, string> = {
  danfo: "a danfo (yellow bus)",
  brt: "the BRT bus",
  rail: "the train",
  ferry: "the ferry",
  keke: "a keke",
};

// Cash to the conductor, or the Cowry card used across LAMATA services.
const PAYS_BY_CARD = new Set(["brt", "rail", "ferry"]);

const LANGUAGE_STYLE: Record<LangCode, string> = {
  en: "clear, friendly Nigerian English",
  pcm:
    'natural Nigerian Pidgin, the way a Lagos conductor talks (for example "Enter danfo for...", "E go cost you...", "Drop for...")',
  yo: LANGUAGE_NAMES.yo,
  ig: LANGUAGE_NAMES.ig,
  ha: LANGUAGE_NAMES.ha,
};

// ---------------------------------------------------------------------------
// The composed answer
// ---------------------------------------------------------------------------

const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function legSentence(leg: TripLeg, i: number): string {
  const line = leg.line && leg.mode !== "danfo" ? ` (${leg.line})` : "";
  return (
    `${i + 1}. Take ${TAKE_VEHICLE[leg.mode] ?? leg.mode}${line} from ${leg.board}. ` +
    `Get off at ${leg.alight}. ` +
    `Fare: ${formatNaira(leg.fare)}${leg.estimated ? " (estimate)" : ""}` +
    (leg.duration ? `, about ${formatMinutes(leg.duration)}` : "") +
    "."
  );
}

function paymentSentence(it: Itinerary): string {
  const kinds = (card: boolean) =>
    Array.from(
      new Set(
        it.legs
          .filter((l) => PAYS_BY_CARD.has(l.mode) === card)
          .map((l) => VEHICLE_SHORT[l.mode] ?? l.mode)
      )
    );
  const parts: string[] = [];
  const cash = kinds(false);
  const card = kinds(true);
  if (cash.length) parts.push(`pay cash on the ${cash.join(" and ")} (exact change helps)`);
  if (card.length) parts.push(`use a Cowry card on the ${card.join(" and ")} (buy or top up at the terminal)`);
  return `How to pay: ${parts.join("; ")}.`;
}

/** "It is cheaper and takes about as long." — computed, never guessed. */
function comparison(alt: Itinerary, best: Itinerary): string {
  const cost = mid(alt.fare) - mid(best.fare);
  const time = alt.duration && best.duration ? mid(alt.duration) - mid(best.duration) : 0;
  const money = cost < -50 ? "is cheaper" : cost > 50 ? "costs more" : "costs about the same";
  const speed = time < -5 ? "is faster" : time > 5 ? "is slower" : "takes about as long";
  return `It ${money} and ${speed}.`;
}

function alternativeSentence(alt: Itinerary, best: Itinerary): string {
  const legs = alt.legs
    .map((l, i) => `${i === 0 ? "" : "then "}${VEHICLE_SHORT[l.mode] ?? l.mode} to ${l.to}`)
    .join(", ");
  return (
    `Other option: ${capitalise(legs)} — ${formatNaira(alt.fare)}` +
    (alt.duration ? `, about ${formatMinutes(alt.duration)}` : "") +
    `. Board the first one at ${alt.legs[0].board.split(" — ")[0]}. ${comparison(alt, best)}`
  );
}

/** Practical notes from the route data, minus what the answer already covers. */
function tipsFor(it: Itinerary): string[] {
  const tips: string[] = [];
  for (const leg of it.legs) {
    for (const sentence of (leg.notes ?? "").split(/(?<=\.)\s+/)) {
      const s = sentence.trim();
      if (!s || /fare|₦|cowry card/i.test(s) || tips.includes(s)) continue;
      tips.push(/[.!?]$/.test(s) ? s : `${s}.`);
    }
  }
  return tips.slice(0, 3);
}

/**
 * The full, detailed reply for a planned trip, in English: summary, one
 * numbered step per vehicle (boarding point, drop-off, fare, time), how to
 * pay, the best alternative with a computed comparison, and tips.
 */
export function composeAnswer(plan: TripPlan): string | null {
  const best = plan.best;
  if (!best) return null;

  const vehicles = best.legs.length === 1 ? "1 vehicle" : `${best.legs.length} vehicles`;
  const lines = [
    `From ${best.from} to ${best.to}: ${vehicles}, ${formatNaira(best.fare)} in total` +
      (best.duration ? `, about ${formatMinutes(best.duration)}` : "") +
      ".",
  ];
  if (plan.originSource === "location") {
    lines.push(`Starting from ${best.from}, the stop nearest to you.`);
  }
  for (const s of plan.substitutions) {
    lines.push(`${s.requested} isn't on a mapped route, so the trip uses ${s.used} (about ${s.km} km away — a short keke ride).`);
  }

  lines.push("", ...best.legs.map(legSentence), "", paymentSentence(best));

  const alt = plan.alternatives[0];
  if (alt) lines.push("", alternativeSentence(alt, best));

  lines.push(
    "",
    `Tips: ${[...tipsFor(best), "Fares change often, so treat these prices as estimates."].join(" ")}`
  );
  return lines.join("\n");
}

/**
 * The 7B model sometimes loops, drops steps or invents prices, so its reply is
 * only used if it still carries the plan's facts: every boarding and drop-off
 * stop, every leg fare, no naira amount that isn't in the answer, no repeated
 * lines — and, in English, every boarding point word for word.
 */
export function replyKeepsFacts(
  reply: string,
  plan: TripPlan,
  answer: string,
  language: LangCode
): boolean {
  const text = reply.trim();
  const best = plan.best;
  if (!text || !best || text.length > answer.length * 2.5) return false;

  const seen = new Map<string, number>();
  for (const line of text.split("\n").map((l) => l.trim()).filter((l) => l.length > 20)) {
    const n = (seen.get(line) ?? 0) + 1;
    if (n >= 3) return false;
    seen.set(line, n);
  }

  const flat = normalizeText(text);
  const has = (s: string) => flat.includes(normalizeText(s));
  const amounts = (s: string) => (s.match(/\d[\d,]*/g) ?? []).map((d) => Number(d.replace(/,/g, "")));
  const numbers = new Set(amounts(text));
  for (const leg of best.legs) {
    if (!has(leg.from) || !has(leg.to) || !numbers.has(leg.fare[0])) return false;
    if (language === "en" && !has(leg.board.split(" — ")[0])) return false;
  }

  const allowed = new Set(amounts(answer));
  for (const m of Array.from(text.matchAll(/₦\s?(\d[\d,]*)/g))) {
    if (!allowed.has(Number(m[1].replace(/,/g, "")))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

function routeLine(r: KBRoute): string {
  return (
    `- ${r.from} ↔ ${r.to}: ${VEHICLE_NAME[r.mode] ?? r.mode}` +
    (r.line ? ` (${r.line})` : "") +
    `, ${formatNaira(r.fare)}` +
    (r.duration ? `, ${formatMinutes(r.duration)}` : "") +
    (r.via?.length ? `, via ${r.via.join(", ")}` : "") +
    (r.board ? ` | board at ${r.board.split(" — ")[0]}` : "") +
    (r.notes ? ` | ${r.notes}` : "")
  );
}

export function buildSystemPrompt(
  kb: RouteKB,
  { plan, language }: { plan: TripPlan; language: LangCode }
): string {
  const role =
    "You are DanfoAI, an expert Lagos transit guide. You help people travel across " +
    "Lagos, Nigeria by danfo, BRT, train, ferry and keke.";

  const answer = composeAnswer(plan);
  if (answer) {
    const task =
      language === "en"
        ? `Rewrite the answer below in ${LANGUAGE_STYLE.en}.`
        : `Translate the answer below into ${LANGUAGE_STYLE[language]}. Do not translate place names, bus stop names or line names.`;
    return [
      role,
      `ANSWER — computed from DanfoAI's route database. Every place, fare and time in it is correct:\n"""\n${answer}\n"""`,
      `YOUR TASK: ${task}
- Keep the same parts in the same order: the summary line, the numbered steps, how to pay, the other option and the tips.
- Keep every place name, bus stop, ₦ amount and time exactly as written. Do not add places, prices, steps or options.
- Do not add tips, warnings or advice that are not in the answer.
- Plain text only — no markdown symbols such as ** or #. Reply with only the answer.`,
    ].join("\n\n");
  }

  // No computable trip: guide the rider using the route data directly.
  const sections = [
    role,
    `REPLY LANGUAGE: Write your whole reply in ${LANGUAGE_STYLE[language]}.`,
  ];
  if (plan.origin || plan.destination) {
    const known = [
      plan.origin && `starting point ${plan.origin}`,
      plan.destination && `destination ${plan.destination}`,
    ]
      .filter(Boolean)
      .join(", ");
    const gap = !plan.origin
      ? "The rider hasn't said where they are starting from — ask them, and mention they can switch on live location in the map."
      : !plan.destination
        ? "Ask the rider where they want to go."
        : "There is no connection between these stops in the route database — say so honestly.";
    sections.push(
      `TRIP: not computed (recognised: ${known}). ${gap} ` +
        "Suggest the closest known connections from the ROUTE DATA, with where to board and the fare."
    );
  } else {
    sections.push(
      "No specific trip was recognised. If the rider wants directions, ask for their starting " +
        "point and destination (a Lagos area or bus stop). Otherwise answer their transit " +
        "question from the ROUTE DATA and GENERAL TIPS below."
    );
  }
  sections.push(`RULES:
- Only use stops, boarding points, lines, fares and times that appear below. Never invent a bus stop, park, line, fare or time.
- Always give prices in naira with the ₦ sign, and say where to board.
- Plain text only — no markdown symbols such as ** or #.
- Be warm and practical, like a helpful Lagos conductor who knows the city well.`);

  const routes = plan.origin || plan.destination ? relevantRoutes(kb, plan) : kb.routes;
  if (routes.length) {
    sections.push(
      `ROUTE DATA (fares in ₦, updated ${kb.updatedAt}; lines run both ways):\n` +
        routes.map(routeLine).join("\n")
    );
  }
  if (kb.fareNote) sections.push(`FARE NOTE: ${kb.fareNote}`);
  if (kb.tips?.length) sections.push(`GENERAL TIPS:\n${kb.tips.map((t) => `- ${t}`).join("\n")}`);
  return sections.join("\n\n");
}
