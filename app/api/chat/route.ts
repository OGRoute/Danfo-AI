import { NextRequest, NextResponse } from "next/server";
import { danfoChat, discoverProvider } from "../../../lib/zg-compute";
import { loadRouteKB } from "../../../lib/routes-kb";
import { buildSystemPrompt, replyKeepsFacts } from "../../../lib/prompt";
import { composeAnswer, composeNoTrip } from "../../../lib/compose-answer";
import {
  COARSE_LOCATION_M,
  extractPlacePhrases,
  isOutOfArea,
  planBetween,
  planTrip,
  resolveToNetwork,
  type TripPlan,
} from "../../../lib/route-planner";
import { placeById } from "../../../lib/lagos-places";
import type { RouteKB } from "../../../lib/prompt";
import { recordQuery } from "../../../lib/query-log";
import { resolveEndpoint } from "../../../lib/geocode";
import { applyCorrections, loadOverrides } from "../../../lib/corrections";
import { detectLanguage, isLangCode, replyInLanguage, type LangCode } from "../../../lib/language-detect";
import { isTimeoutError } from "../../../lib/zg-provider";
import type { LatLng } from "../../../lib/lagos-stops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The 0G testnet RPC is slow; give the request room before the platform kills it.
export const maxDuration = 120;

// The trip plan carries the context the model needs, so only recent turns are
// sent — a shorter prompt is also cheaper on 0G Compute.
const HISTORY_TURNS = 6;

// Languages the chat model may phrase trip answers in. The only testnet chat
// model (qwen2.5-omni-7b) garbles Yoruba, Igbo and Hausa and drifts into
// English when asked for Pidgin, so trips asked in those are answered straight
// from the composed answer in that language. Widen when 0G offers a stronger
// model.
const MODEL_REPLY_LANGUAGES = new Set(
  (process.env.MODEL_REPLY_LANGUAGES || "en")
    .split(",")
    .map((s) => s.trim())
    .filter(isLangCode)
);

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function asLatLng(v: unknown): LatLng | null {
  return Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    Math.abs(v[0]) <= 90 &&
    Math.abs(v[1]) <= 180
    ? [v[0], v[1]]
    : null;
}

/** What the rider's own position is called in each reply language. */
const HERE: Record<LangCode, string> = {
  en: "your location",
  pcm: "where you dey",
  yo: "ibi tí o wà",
  ig: "ebe ị nọ",
  ha: "inda kake",
};

/**
 * One end of a picked trip: a place id from lib/lagos-places.ts, or the
 * rider's position ({ location: [lat, lng], accuracy? }).
 */
function pickedEndpoint(kb: RouteKB, raw: any, language: LangCode) {
  const place = placeById(raw?.id);
  if (place) {
    return { label: place.name, resolved: resolveToNetwork(kb, place.name, place.pos), here: false };
  }
  const pos = asLatLng(raw?.location);
  if (!pos) return null;
  const accuracy = typeof raw.accuracy === "number" && Number.isFinite(raw.accuracy) ? raw.accuracy : null;
  // Same rule as typed trips: a fix vaguer than COARSE_LOCATION_M is a
  // neighbourhood, not a place to start a trip from.
  const usable = accuracy == null || accuracy <= COARSE_LOCATION_M;
  return {
    label: HERE[language],
    resolved: usable ? resolveToNetwork(kb, HERE[language], pos) : null,
    here: true,
    vague: !usable,
  };
}

/**
 * The plan for a trip chosen in the From / To picker, or null when the request
 * carries no (valid) picked trip and the message should be read as text.
 */
function planPickedTrip(kb: RouteKB, trip: any, language: LangCode): TripPlan | null {
  if (!trip || typeof trip !== "object") return null;
  const origin = pickedEndpoint(kb, trip.origin, language);
  const destination = pickedEndpoint(kb, trip.destination, language);
  if (!origin || !destination) return null;

  if (origin.resolved && destination.resolved) {
    return planBetween(kb, origin.resolved, destination.resolved, origin.here ? "location" : "text");
  }
  // One end can't be tied to the network: too far from any served stop, or a
  // position too vague to use. Say which, rather than routing from a guess.
  const unplaced = (label: string) => ({ label, pos: [0, 0] as LatLng, stop: label, km: 0 });
  const vagueOrigin = "vague" in origin && origin.vague;
  return {
    origin: vagueOrigin ? null : origin.resolved?.stop ?? origin.label,
    destination: destination.resolved?.stop ?? destination.label,
    originSource: null,
    status: vagueOrigin ? "need-origin" : "no-connection",
    substitutions: [],
    best: null,
    alternatives: [],
    places: {
      origin: vagueOrigin ? null : origin.resolved ?? unplaced(origin.label),
      destination: destination.resolved ?? unplaced(destination.label),
    },
  };
}

/**
 * POST { messages, language?, location?, trip? }
 *  - trip: { origin, destination } chosen in the From / To picker. Each end is
 *    { id } (a place id) or { location: [lat, lng], accuracy? } for "where I
 *    am now". When present the trip is planned between exactly those points.
 *  - language: reply language (yo | ig | ha | en | pcm); detected from the
 *    rider's last message when omitted.
 *  - location: [lat, lng] from the live map, used as the starting point when
 *    the rider only names a destination.
 *  - locationAccuracy: metres of uncertainty on that position; a vague fix is
 *    not used to guess where the rider is boarding.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: ChatMessage[] | null = Array.isArray(body?.messages)
      ? body.messages.filter(
          (m: any) =>
            (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string"
        )
      : null;
    if (!messages?.length) {
      return NextResponse.json({ error: "messages array required" }, { status: 400 });
    }

    const { kb: published, source } = await loadRouteKB();
    // Riders' corrections (recorded on 0G Chain) take precedence over the
    // published fares and boarding points — this is how DanfoAI learns.
    const { overrides } = await loadOverrides();
    const kb = applyCorrections(published, overrides);

    const userTexts = messages.filter((m) => m.role === "user").map((m) => m.content);
    const location = asLatLng(body.location);
    // How precise that fix is. A ±2 km network fix must not quietly become
    // "you are at Yaba" — riders reported exactly that going wrong.
    const accuracy =
      typeof body.locationAccuracy === "number" && Number.isFinite(body.locationAccuracy)
        ? body.locationAccuracy
        : null;
    // Reply language is needed early: a trip from the rider's position is
    // labelled in it ("your location" / "where you dey").
    const language: LangCode = isLangCode(body.language)
      ? body.language
      : detectLanguage(userTexts[userTexts.length - 1] ?? "").code;

    // Places chosen in the From / To picker are planned exactly as picked —
    // nothing is guessed from the wording of the message.
    const picked = planPickedTrip(kb, body.trip, language);
    let plan = picked ?? planTrip(kb, userTexts, location, undefined, accuracy);

    // Streets, estates, markets and landmarks the route database doesn't know:
    // resolve them on OpenStreetMap and walk the rider to the nearest stop
    // that actually has routes.
    if (!picked && !plan.best) {
      const latest = userTexts[userTexts.length - 1] ?? "";
      const phrases = extractPlacePhrases(latest);
      // Never geocode a city outside the covered area: OpenStreetMap will
      // happily return a Lagos street with that name.
      const [origin, destination] = await Promise.all([
        !plan.origin && phrases.origin && !isOutOfArea(phrases.origin)
          ? resolveEndpoint(phrases.origin)
          : null,
        !plan.destination && phrases.destination && !isOutOfArea(phrases.destination)
          ? resolveEndpoint(phrases.destination)
          : null,
      ]);
      if (origin || destination) {
        plan = planTrip(kb, userTexts, location, { origin, destination }, accuracy);
      }
    }
    recordQuery({
      text: userTexts[userTexts.length - 1] ?? "",
      language,
      status: plan.status,
      origin: plan.origin ?? undefined,
      destination: plan.destination ?? undefined,
      fare: plan.best?.fare,
      legs: plan.best?.legs.length,
    });

    // No trip to describe: answer from the planner's own templates. The 7B
    // model improvises badly here (and in the wrong language), and there is
    // nothing for it to rephrase, so it isn't asked — which also saves 0G.
    if (!plan.best) {
      return NextResponse.json({
        reply: composeNoTrip(plan, language),
        plan,
        language,
        source: "planner",
        verified: false,
        kbSource: source,
      });
    }

    // The English answer is what the model's text is checked against; the local
    // one is the reply in the rider's own language.
    const answer = composeAnswer(plan, "en");
    const localAnswer = composeAnswer(plan, language);
    if (localAnswer && !MODEL_REPLY_LANGUAGES.has(language)) {
      return NextResponse.json({
        reply: localAnswer,
        plan,
        language,
        source: "planner",
        verified: false,
        kbSource: source,
      });
    }

    const system = buildSystemPrompt(kb, { plan, language });
    let result: Awaited<ReturnType<typeof danfoChat>>;
    try {
      const provider = await discoverProvider();
      result = await danfoChat(provider, [
        { role: "system", content: system },
        ...messages.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content })),
      ]);
    } catch (e) {
      // The trip is already computed; the model only rewords it. A slow or
      // unfunded 0G provider must not cost the rider their answer.
      console.warn("/api/chat: model unavailable, sending the computed answer:", (e as Error).message);
      return NextResponse.json({
        reply: localAnswer ?? answer,
        plan,
        language,
        source: "planner",
        verified: false,
        kbSource: source,
      });
    }

    // For a planned trip the model only rephrases the computed answer. If its
    // text lost or changed facts, show the computed answer instead.
    let reply = result.reply.trim();
    let replySource: "model" | "planner" = "model";
    // …or if it came back in the wrong language (small models drift to English).
    if (answer && (!replyKeepsFacts(reply, plan, answer, language) || !replyInLanguage(reply, language))) {
      reply = localAnswer ?? answer;
      replySource = "planner";
    }
    if (!reply) reply = "Sorry, I couldn't put that answer together — please try asking again.";

    return NextResponse.json({
      reply,
      plan,
      language,
      source: replySource,
      verified: replySource === "model" && result.verified,
      model: result.model,
      provider: result.provider,
      chatId: result.chatId,
      kbSource: source,
    });
  } catch (e) {
    console.error("/api/chat error:", e);
    if (isTimeoutError(e)) {
      return NextResponse.json(
        {
          error:
            "The 0G testnet is responding slowly right now — please try again in a moment.",
        },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: (e as Error).message || "inference failed" },
      { status: 500 }
    );
  }
}
