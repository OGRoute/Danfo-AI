/**
 * 0G Compute speech-to-text (Whisper Large V3).
 * Same broker pattern as chat, but hits the audio/transcriptions endpoint.
 * Whisper handles Yoruba, Igbo, Hausa (with varying quality).
 */
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { getWallet } from "./zg-provider";

let brokerPromise: ReturnType<typeof createZGComputeNetworkBroker> | null = null;

async function getBroker() {
  if (!brokerPromise) brokerPromise = createZGComputeNetworkBroker(getWallet());
  return brokerPromise;
}

/** Find a speech-to-text provider, or use STT_PROVIDER_ADDRESS if pinned. */
async function getSttProvider(): Promise<string> {
  const pinned = process.env.STT_PROVIDER_ADDRESS;
  if (pinned) return pinned;
  const broker = await getBroker();
  const services = await broker.inference.listService();
  // Prefer a service whose model name signals whisper / speech.
  const stt = services.find((s: any) =>
    /whisper|speech|transcri/i.test(s.model || "")
  );
  if (!stt)
    throw new Error(
      "No 0G speech-to-text provider is currently online. Set INTRON_API_KEY to use " +
        "Intron for voice input, or pin a known STT provider via STT_PROVIDER_ADDRESS."
    );
  return stt.provider;
}

/** ISO-639-1 codes Whisper understands for the Nigerian languages we target. */
const SUPPORTED_LANGUAGES = new Set(["yo", "ig", "ha", "en"]);

export async function transcribe(
  audio: Buffer,
  filename = "audio.webm",
  language?: string
): Promise<string> {
  const broker = await getBroker();
  const provider = await getSttProvider();

  await broker.inference.acknowledgeProviderSigner(provider).catch(() => {});

  const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
  const headers = await broker.inference.getRequestHeaders(provider, "audio-transcription");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), filename);
  form.append("model", model);
  // A language hint markedly improves accuracy for Yoruba/Igbo/Hausa. If the
  // caller doesn't pass a recognised code (e.g. Pidgin), we let Whisper
  // auto-detect rather than forcing "en".
  if (language && SUPPORTED_LANGUAGES.has(language)) {
    form.append("language", language);
  }

  const res = await fetch(`${endpoint}/audio/transcriptions`, {
    method: "POST",
    headers: { ...headers }, // do NOT set Content-Type; fetch sets the multipart boundary
    body: form,
  });

  if (!res.ok) {
    throw new Error(`0G transcription failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.text ?? "";
}