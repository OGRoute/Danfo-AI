import { NextRequest, NextResponse } from "next/server";
// Use undici's own fetch + Agent together (mixing its Agent with Node's built-in
// fetch throws "invalid onRequestStart" due to version-mismatched interfaces).
import { Agent, fetch as undiciFetch } from "undici";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// CPU TTS inference can take minutes; Node's default fetch header timeout is
// 300s and aborts too early. Use a dispatcher with generous timeouts.
const TTS_TIMEOUT_MS = Number(process.env.YARNGPT_TIMEOUT_MS || 900_000);
const ttsAgent = new Agent({
  headersTimeout: TTS_TIMEOUT_MS,
  bodyTimeout: TTS_TIMEOUT_MS,
});

// Cap spoken text so CPU generation stays reasonable (route replies are short).
// Kept low because neural TTS is slow on CPU — shorter text = faster audio.
const MAX_TTS_CHARS = Number(process.env.YARNGPT_MAX_CHARS || 280);

/**
 * Text-to-speech proxy. Forwards text to a YarnGPT service (Nigerian-accented
 * TTS) and streams the generated WAV back to the browser. The YarnGPT model is
 * Python-only and heavy, so it runs as a separate service — see
 * services/speech/README.md. Set YARNGPT_API_URL to point at it.
 */

// Our app's short language codes -> YarnGPT's language names.
const LANG_MAP: Record<string, string> = {
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

export async function POST(req: NextRequest) {
  const base = process.env.YARNGPT_API_URL;
  if (!base) {
    return NextResponse.json(
      { error: "Text-to-speech is not configured (YARNGPT_API_URL is unset)." },
      { status: 503 }
    );
  }

  try {
    const { text, language, voice } = await req.json();
    const clean = (text || "").toString().trim().slice(0, MAX_TTS_CHARS);
    if (!clean) {
      return NextResponse.json({ error: "no text" }, { status: 400 });
    }

    const ygLanguage = LANG_MAP[language as string] || "english";
    const ygVoice = voice || DEFAULT_VOICE[ygLanguage] || "idera";

    const upstream = await undiciFetch(`${base.replace(/\/$/, "")}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, language: ygLanguage, voice: ygVoice }),
      // Long-timeout dispatcher for slow CPU inference.
      dispatcher: ttsAgent,
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      throw new Error(`YarnGPT service error ${upstream.status}: ${detail}`);
    }

    // Buffer the WAV (small) — avoids stream interop between undici and Next.
    const audio = Buffer.from(await upstream.arrayBuffer());
    const contentType =
      upstream.headers.get("content-type") || "audio/wav";

    return new NextResponse(audio, {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("/api/speak error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
