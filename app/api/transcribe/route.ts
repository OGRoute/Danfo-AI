import { NextRequest, NextResponse } from "next/server";
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import { transcribe } from "../../../lib/zg-speech";
import {
  intronSttProblem,
  isIntronConfigured,
  transcribeWithIntron,
} from "../../../lib/intron-speech";
import { detectLanguage, isLangCode, type LangCode } from "../../../lib/language-detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Local Whisper STT service (defaults to the same box as YarnGPT).
const STT_BASE = (
  process.env.STT_API_URL ||
  process.env.YARNGPT_API_URL ||
  ""
).replace(/\/$/, "");
const STT_TIMEOUT_MS = Number(process.env.STT_TIMEOUT_MS || 300_000);
const sttAgent = new Agent({
  headersTimeout: STT_TIMEOUT_MS,
  bodyTimeout: STT_TIMEOUT_MS,
});

let localHealth: { ok: boolean; at: number } | null = null;

/** Is the local Whisper service actually running? (cached for 30 s) */
async function localSttHealthy(): Promise<boolean> {
  if (!STT_BASE) return false;
  if (localHealth && Date.now() - localHealth.at < 30_000) return localHealth.ok;
  let ok = false;
  try {
    ok = (await fetch(`${STT_BASE}/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    ok = false;
  }
  localHealth = { ok, at: Date.now() };
  return ok;
}

async function transcribeLocal(
  buf: Buffer,
  filename: string,
  language?: string
): Promise<{ text: string; language?: string }> {
  // Use undici's own FormData so it serializes as proper multipart for fetch.
  const fd = new UndiciFormData();
  fd.append("file", new Blob([new Uint8Array(buf)]), filename);
  if (language) fd.append("language", language);
  const res = await undiciFetch(`${STT_BASE}/stt`, {
    method: "POST",
    body: fd,
    dispatcher: sttAgent,
  });
  if (!res.ok) {
    throw new Error(`local STT ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data: any = await res.json();
  return { text: (data?.text || "").trim(), language: data?.language };
}

/** Whisper never reports Pidgin — read the words to tell Pidgin from English. */
function languageOf(text: string, reported?: string): LangCode {
  if (isLangCode(reported) && reported !== "en") return reported;
  return detectLanguage(text).code;
}

/**
 * Which speech engines are usable right now. The client uses this to decide
 * between server transcription (Intron / Whisper) and the browser recogniser.
 */
export async function GET() {
  const problem = isIntronConfigured() ? intronSttProblem() : null;
  return NextResponse.json({
    intron: isIntronConfigured() && !problem,
    intronProblem: problem ? friendlyIntronProblem(problem) : null,
    local: await localSttHealthy(),
  });
}

function friendlyIntronProblem(detail: string): string {
  return /insufficient balance/i.test(detail)
    ? "the Intron account is out of credit"
    : "the Intron key was rejected";
}

/**
 * POST multipart { file, language? } → { text, language, lock, engine }.
 *  - language: yo | ig | ha | en | pcm, or empty for auto-detect.
 *  - lock: the language the client should send with the rest of this
 *    recording session, so auto-detect only costs extra on the first phrase.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
    const requested = (form.get("language") as string | null) || "";
    const language = isLangCode(requested) ? requested : undefined; // undefined = auto
    const buf = Buffer.from(await file.arrayBuffer());
    const filename = file.name || "audio.webm";

    // Intron first: it's the engine that genuinely understands Pidgin, Yoruba,
    // Igbo and Hausa. Whisper (local, then 0G) is the fallback.
    const engines = [
      {
        name: "intron",
        enabled: isIntronConfigured(),
        run: async () => {
          const r = await transcribeWithIntron(buf, filename, language);
          // The Pidgin-English model handles English too, so lock onto it
          // rather than plain English to keep Pidgin phrases recognisable.
          return { ...r, lock: language ?? (r.language === "en" ? "pcm" : r.language) };
        },
      },
      {
        name: "whisper-local",
        enabled: !!STT_BASE,
        run: async () => {
          const r = await transcribeLocal(buf, filename, language);
          return { text: r.text, language: language ?? languageOf(r.text, r.language), lock: language ?? "" };
        },
      },
      {
        name: "0g-whisper",
        enabled: true,
        run: async () => {
          const text = (await transcribe(buf, filename, language)).trim();
          return { text, language: language ?? languageOf(text), lock: language ?? "" };
        },
      },
    ].filter((e) => e.enabled);

    const errors: string[] = [];
    for (const eng of engines) {
      try {
        const result = await eng.run();
        return NextResponse.json({ ...result, engine: eng.name });
      } catch (e) {
        const msg = (e as Error).message || "";
        console.error(`/api/transcribe ${eng.name} failed:`, msg);
        errors.push(msg);
      }
    }

    // Every engine failed — return the most actionable guidance we can.
    const joined = errors.join(" | ");
    let hint =
      "Voice input isn't available right now. Add INTRON_API_KEY for Nigerian-language " +
      "speech recognition, or start the local speech service (yarngpt-service on port 8000). " +
      "You can type your message meanwhile.";
    if (isIntronConfigured()) {
      if (/insufficient balance/i.test(joined)) {
        hint =
          "Intron speech recognition is out of credit on this account — top it up at " +
          "voice.intron.io. Tap the mic again to use the browser's English recogniser, or type.";
      } else if (/integrator|permission denied|unauthori|\b40[13]\b/i.test(joined)) {
        hint =
          "The Intron key was rejected — check INTRON_API_KEY and that the account is approved " +
          "for API access (voice@intron.io).";
      } else {
        hint = `Voice input failed (${errors[0]}). You can type your message meanwhile.`;
      }
    }
    return NextResponse.json({ error: hint }, { status: 503 });
  } catch (e) {
    console.error("/api/transcribe error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
