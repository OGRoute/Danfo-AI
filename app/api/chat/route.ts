import { NextRequest, NextResponse } from "next/server";
import { danfoChat, discoverProvider } from "../../../lib/zg-compute";
import { loadRouteKB } from "../../../lib/routes-kb";
import { buildSystemPrompt, replyKeepsFacts } from "../../../lib/prompt";
import { composeAnswer, composeNoTrip } from "../../../lib/compose-answer";
import { extractPlacePhrases, isOutOfArea, planTrip } from "../../../lib/route-planner";
import { recordQuery } from "../../../lib/query-log";
import { resolveEndpoint } from "../../../lib/geocode";
import { applyCorrections, loadOverrides } from "../../../lib/corrections";
import { detectLanguage, isLangCode, type LangCode } from "../../../lib/language-detect";
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

/**
 * POST { messages, language?, location? }
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
    let plan = planTrip(kb, userTexts, location, undefined, accuracy);

    // Streets, estates, markets and landmarks the route database doesn't know:
    // resolve them on OpenStreetMap and walk the rider to the nearest stop
    // that actually has routes.
    if (!plan.best) {
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
    const language: LangCode = isLangCode(body.language)
      ? body.language
      : detectLanguage(userTexts[userTexts.length - 1] ?? "").code;

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
    const provider = await discoverProvider();

    const result = await danfoChat(provider, [
      { role: "system", content: system },
      ...messages.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content })),
    ]);

    // For a planned trip the model only rephrases the computed answer. If its
    // text lost or changed facts, show the computed answer instead.
    let reply = result.reply.trim();
    let replySource: "model" | "planner" = "model";
    if (answer && !replyKeepsFacts(reply, plan, answer, language)) {
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
