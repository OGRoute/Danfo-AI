/**
 * Intron Voice AI (https://docs.voice.intron.io) — speech-to-text and
 * text-to-speech built for African languages and accents: Yoruba, Igbo, Hausa,
 * Nigerian Pidgin (pcm) and Nigerian-accented English.
 *
 * Server-side only (uses INTRON_API_KEY). When the key is unset, callers fall
 * back to Whisper for STT and the browser/YarnGPT for TTS.
 */
import { isLangCode, pickTranscript, type LangCode } from "./language-detect";

/**
 * Endpoint overrides must be HTTP(S) request/response endpoints. Intron's
 * wss:// streaming URLs speak a different protocol and make fetch() fail, so
 * they're ignored with a warning instead of silently breaking voice.
 */
function httpEndpoint(name: string, fallback: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return value;
  console.warn(
    `${name}=${value} isn't an http(s) endpoint (streaming wss:// URLs aren't used here) — using ${fallback} instead.`
  );
  return fallback;
}

const INTRON_BASE = httpEndpoint("INTRON_API_BASE", "https://infer.voice.intron.io").replace(/\/$/, "");
const STT_URL = httpEndpoint("INTRON_STT_URL", `${INTRON_BASE}/file/v1/upload/sync`);
const TTS_URL = httpEndpoint("INTRON_TTS_URL", `${INTRON_BASE}/tts/v1/generate`);

// Intron's sync endpoints can take up to ~120 s before answering 503.
const REQUEST_TIMEOUT_MS = 125_000;

/**
 * Languages tried in parallel when the rider picks "Auto-detect". Intron has
 * no language-identification endpoint, so the clip is transcribed with each
 * model and the transcript that reads most like its own language wins. The
 * Pidgin-English model also covers plain English.
 */
const AUTO_LANGUAGES: LangCode[] = (process.env.INTRON_AUTO_LANGUAGES || "pcm,yo,ig,ha")
  .split(",")
  .map((s) => s.trim())
  .filter(isLangCode);

export const INTRON_TTS_MAX_CHARS = 4096;

// Account-level problems (no credit left, rejected key) don't fix themselves
// between phrases, so remember them for a while: /api/transcribe reports Intron
// as unusable and the client switches to another engine.
const ACCOUNT_ERROR = /insufficient balance|unauthori[sz]ed|invalid (api )?key|permission denied|integrator/i;
const ACCOUNT_ERROR_TTL_MS = 10 * 60_000;
let sttAccountError: { message: string; at: number } | null = null;

/** The current Intron speech-to-text account problem, if any. */
export function intronSttProblem(): string | null {
  if (sttAccountError && Date.now() - sttAccountError.at < ACCOUNT_ERROR_TTL_MS) {
    return sttAccountError.message;
  }
  return null;
}

function sttFailure(language: LangCode, detail: string): Error {
  if (ACCOUNT_ERROR.test(detail)) sttAccountError = { message: detail, at: Date.now() };
  return new Error(`Intron transcription failed (${language}): ${detail}`);
}

export function isIntronConfigured(): boolean {
  return !!process.env.INTRON_API_KEY;
}

function authHeader(): Record<string, string> {
  const key = process.env.INTRON_API_KEY;
  if (!key) throw new Error("INTRON_API_KEY missing from environment");
  return { Authorization: `Bearer ${key}` };
}

async function transcribeAs(audio: Buffer, filename: string, language: LangCode): Promise<string> {
  const form = new FormData();
  form.append("audio_file_name", filename);
  form.append("audio_file_blob", new Blob([new Uint8Array(audio)]), filename);
  form.append("use_language_asr_input", language);

  const res = await fetch(STT_URL, {
    method: "POST",
    headers: authHeader(), // no Content-Type: fetch sets the multipart boundary
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const raw = await res.text().catch(() => "");
  let data: any = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* not JSON — handled below */
  }
  // Intron reports some failures (e.g. an account out of credit) as JSON with
  // status "Error", so check the body as well as the HTTP status.
  if (!res.ok || data?.status !== "Ok") {
    const detail = String(data?.message ?? (raw || `HTTP ${res.status}`));
    // Clips shorter than a second are rejected: that's "no speech", not a failure.
    if (/less than minimum/i.test(detail)) return "";
    throw sttFailure(language, detail);
  }
  sttAccountError = null;
  return String(data?.data?.audio_transcript ?? "").trim();
}

/**
 * Transcribe a clip (≤120 s). With a language it's a single request; without
 * one, candidate language models run in parallel and the best transcript wins.
 * Returns the language the speech was recognised as.
 */
export async function transcribeWithIntron(
  audio: Buffer,
  filename = "audio.webm",
  language?: string
): Promise<{ text: string; language: LangCode }> {
  if (isLangCode(language)) {
    return { text: await transcribeAs(audio, filename, language), language };
  }

  const results = await Promise.allSettled(
    AUTO_LANGUAGES.map(async (lang) => ({ lang, text: await transcribeAs(audio, filename, lang) }))
  );
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length) {
    throw (results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined)?.reason ??
      new Error("Intron transcription failed");
  }
  const best = pickTranscript(ok);
  return best ? { text: best.text, language: best.lang } : { text: "", language: "en" };
}

// Intron TTS voices (docs: TTS supported languages and accents). English is
// spoken with a Nigerian accent; override with INTRON_TTS_EN_ACCENT
// (yoruba | igbo | hausa).
const TTS_VOICE: Record<LangCode, { voice_language: string; voice_accent: string }> = {
  en: { voice_language: "en", voice_accent: process.env.INTRON_TTS_EN_ACCENT || "yoruba" },
  pcm: { voice_language: "pcm", voice_accent: "pidgin" },
  yo: { voice_language: "yo", voice_accent: "yoruba" },
  ig: { voice_language: "ig", voice_accent: "igbo" },
  ha: { voice_language: "ha", voice_accent: "hausa" },
};

/** Generate speech and return the audio bytes. */
export async function synthesizeWithIntron(
  text: string,
  language: LangCode,
  gender: "male" | "female"
): Promise<{ audio: Buffer; contentType: string }> {
  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text.slice(0, INTRON_TTS_MAX_CHARS),
      ...TTS_VOICE[language],
      voice_gender: gender,
      output_audio_format: "wav",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Intron TTS failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = await res.json();
  const audioPath = data?.data?.audio_path;
  if (!audioPath) {
    throw new Error(
      `Intron TTS returned no audio (${data?.data?.processing_status ?? data?.message ?? "unknown status"})`
    );
  }

  // audio_path is a download URL. Fetch it server-side (so the browser never
  // needs the key) and retry with the key in case it isn't public.
  const url = new URL(audioPath, INTRON_BASE).toString();
  let audioRes = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (audioRes.status === 401 || audioRes.status === 403) {
    audioRes = await fetch(url, { headers: authHeader(), signal: AbortSignal.timeout(60_000) });
  }
  if (!audioRes.ok) throw new Error(`Couldn't download Intron audio: ${audioRes.status}`);

  // The storage bucket labels files binary/octet-stream; Safari won't play that.
  const type = audioRes.headers.get("content-type") || "";
  return {
    audio: Buffer.from(await audioRes.arrayBuffer()),
    contentType: type.startsWith("audio/") ? type : "audio/wav",
  };
}
