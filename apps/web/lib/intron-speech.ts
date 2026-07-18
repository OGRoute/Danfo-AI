/**
 * Intron Voice AI speech-to-text (https://docs.voice.intron.io).
 *
 * Intron's ASR is optimized for African accents and natively supports the
 * Nigerian languages DanfoAI cares about — Yoruba, Igbo, Hausa, English and,
 * unlike Whisper, Nigerian Pidgin (pcm).
 *
 * Enabled by setting INTRON_API_KEY. When it's unset, callers fall back to the
 * 0G Whisper transcriber so the app keeps working without Intron credentials.
 */

const INTRON_ENDPOINT =
  process.env.INTRON_STT_URL ||
  "https://infer.voice.intron.io/file/v1/upload/sync";

/** Language codes Intron accepts for the languages we expose. */
const SUPPORTED = new Set(["yo", "ig", "ha", "en", "pcm"]);

export function isIntronConfigured(): boolean {
  return !!process.env.INTRON_API_KEY;
}

export async function transcribeWithIntron(
  audio: Buffer,
  filename = "audio.webm",
  language?: string
): Promise<string> {
  const key = process.env.INTRON_API_KEY;
  if (!key) throw new Error("INTRON_API_KEY missing from environment");

  const form = new FormData();
  form.append("audio_file_name", filename);
  form.append("audio_file_blob", new Blob([new Uint8Array(audio)]), filename);
  // Default to English when no (or an unsupported) hint is given.
  form.append(
    "use_language_asr_input",
    language && SUPPORTED.has(language) ? language : "en"
  );

  const res = await fetch(INTRON_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` }, // no Content-Type: fetch sets the multipart boundary
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Intron transcription failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data?.data?.audio_transcript ?? "";
}
