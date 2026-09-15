import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
// Use undici's own fetch + Agent together (mixing its Agent with Node's built-in
// fetch throws "invalid onRequestStart" due to version-mismatched interfaces).
import { Agent, fetch as undiciFetch } from "undici";
import {
  INTRON_TTS_MAX_CHARS,
  isIntronConfigured,
  synthesizeWithIntron,
} from "../../../lib/intron-speech";
import { detectLanguage, isLangCode, type LangCode } from "../../../lib/language-detect";
import { toSpeakable } from "../../../lib/speech-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Text-to-speech. Intron (when INTRON_API_KEY is set) speaks Yoruba, Igbo,
 * Hausa, Pidgin and Nigerian-accented English natively; otherwise the request
 * goes to a YarnGPT service (Nigerian-accented TTS, see yarngpt-service/).
 * The client falls back to the browser's own voice when neither is available.
 */

const INTRON_GENDER: "male" | "female" =
  process.env.INTRON_TTS_GENDER === "male" ? "male" : "female";

// Replaying a reply is common — keep recent clips in memory.
const CACHE_MAX = 40;
const cache = new Map<string, { audio: Buffer; contentType: string }>();

// CPU TTS inference can take minutes; Node's default fetch header timeout is
// 300s and aborts too early. Use a dispatcher with generous timeouts.
const TTS_TIMEOUT_MS = Number(process.env.YARNGPT_TIMEOUT_MS || 900_000);
const ttsAgent = new Agent({
  headersTimeout: TTS_TIMEOUT_MS,
  bodyTimeout: TTS_TIMEOUT_MS,
});

// Cap spoken text so CPU generation stays reasonable.
// Kept low because neural TTS is slow on CPU — shorter text = faster audio.
const MAX_YARNGPT_CHARS = Number(process.env.YARNGPT_MAX_CHARS || 280);

// Our app's short language codes -> YarnGPT's language names.
const LANG_MAP: Record<LangCode, string> = {
  yo: "yoruba",
  ig: "igbo",
  ha: "hausa",
  en: "english",
  pcm: "pidgin",
};

// A sensible default voice per language (valid YarnGPT2 speaker names).
const DEFAULT_VOICE: Record<string, string> = {
  yoruba: "yoruba_female2",
  igbo: "igbo_female2",
  hausa: "hausa_female1",
  english: "idera",
  pidgin: "idera",
};

function audioResponse(audio: Buffer, contentType: string, engine: string) {
  return new NextResponse(new Uint8Array(audio), {
    status: 200,
    headers: { "Content-Type": contentType, "Cache-Control": "no-store", "X-TTS-Engine": engine },
  });
}

/** Which server voices are configured (the client prefers them when present). */
export async function GET() {
  return NextResponse.json({
    intron: isIntronConfigured(),
    yarngpt: !!process.env.YARNGPT_API_URL,
  });
}

export async function POST(req: NextRequest) {
  try {
    const { text, language, voice, gender } = await req.json();
    const spoken = toSpeakable(String(text || ""));
    if (!spoken) {
      return NextResponse.json({ error: "no text" }, { status: 400 });
    }
    const lang: LangCode = isLangCode(language) ? language : detectLanguage(spoken).code;

    let intronError: string | null = null;
    if (isIntronConfigured()) {
      const g = gender === "male" || gender === "female" ? gender : INTRON_GENDER;
      const clip = spoken.slice(0, INTRON_TTS_MAX_CHARS);
      const key = createHash("sha1").update(`${lang}|${g}|${clip}`).digest("hex");
      try {
        let hit = cache.get(key);
        if (!hit) {
          hit = await synthesizeWithIntron(clip, lang, g);
          if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
          cache.set(key, hit);
        }
        return audioResponse(hit.audio, hit.contentType, "intron");
      } catch (e) {
        intronError = (e as Error).message;
        console.error("Intron TTS failed:", intronError);
      }
    }

    const base = process.env.YARNGPT_API_URL;
    if (!base) {
      return NextResponse.json(
        {
          error:
            intronError ??
            "Text-to-speech is not configured (set INTRON_API_KEY or YARNGPT_API_URL).",
        },
        { status: intronError ? 502 : 503 }
      );
    }

    const ygLanguage = LANG_MAP[lang];
    const ygVoice = voice || DEFAULT_VOICE[ygLanguage] || "idera";
    const upstream = await undiciFetch(`${base.replace(/\/$/, "")}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: spoken.slice(0, MAX_YARNGPT_CHARS),
        language: ygLanguage,
        voice: ygVoice,
      }),
      // Long-timeout dispatcher for slow CPU inference.
      dispatcher: ttsAgent,
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      throw new Error(`YarnGPT service error ${upstream.status}: ${detail}`);
    }

    // Buffer the WAV (small) — avoids stream interop between undici and Next.
    const audio = Buffer.from(await upstream.arrayBuffer());
    return audioResponse(audio, upstream.headers.get("content-type") || "audio/wav", "yarngpt");
  } catch (e) {
    console.error("/api/speak error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
