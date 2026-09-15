/**
 * Builds the DanfoAI system prompt.
 *
 * Accuracy strategy: the 0G testnet chat model is small (7B). Asked to work a
 * route out from raw data it mixes up fares, copies notes verbatim and gets
 * comparisons backwards. So the server does the reasoning:
 *  - lib/route-planner.ts computes the trip from the route knowledge base
 *    (loaded from 0G Storage at runtime), and
 *  - lib/compose-answer.ts writes the complete, detailed reply from it, in
 *    English, Pidgin, Yoruba, Igbo or Hausa.
 * For English and Pidgin the model rephrases that reply naturally;
 * replyKeepsFacts() checks its text and the chat route falls back to the
 * composed answer when facts were lost or changed.
 */
import { LANGUAGE_NAMES, type LangCode } from "./language-detect";
import { normalizeText } from "./lagos-stops";
import { composeAnswer } from "./compose-answer";
import { formatMinutes, formatNaira, relevantRoutes, type TripPlan } from "./route-planner";

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

const LANGUAGE_STYLE: Record<LangCode, string> = {
  en: "clear, friendly Nigerian English",
  pcm:
    'natural Nigerian Pidgin, the way a Lagos conductor talks (for example "Enter danfo for...", "E go cost you...", "Drop for...")',
  yo: LANGUAGE_NAMES.yo,
  ig: LANGUAGE_NAMES.ig,
  ha: LANGUAGE_NAMES.ha,
};

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

  const answer = composeAnswer(plan, "en");
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
