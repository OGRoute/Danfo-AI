import { NextRequest, NextResponse } from "next/server";
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import { isIntronConfigured, transcribeWithIntron } from "../../../lib/intron-speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Local Whisper STT service (defaults to the same box as YarnGPT). When set, it
// is the primary engine — Whisper auto-detects language incl. Nigerian ones.
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

// Set STT_PREFER_INTRON=1 to make Intron the primary STT engine (best accuracy
// for Nigerian languages) once your Intron account is provisioned. Whisper then
// acts as the fallback. Default: local Whisper first.
const PREFER_INTRON = process.env.STT_PREFER_INTRON === "1";

async function transcribeLocal(
  buf: Buffer,
  filename: string,
  language?: string
): Promise<string> {
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
  return (data?.text || "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
    const language = (form.get("language") as string | null) || undefined;
    const buf = Buffer.from(await file.arrayBuffer());
    const filename = file.name || "audio.webm";

    // Build the engine order. Intron first only when explicitly preferred.
    const local = {
      name: "whisper-local",
      enabled: !!STT_BASE,
      run: () => transcribeLocal(buf, filename, language),
    };
    const intron = {
      name: "intron",
      enabled: isIntronConfigured(),
      run: () => transcribeWithIntron(buf, filename, language),
    };
    const engines = (PREFER_INTRON ? [intron, local] : [local, intron]).filter(
      (e) => e.enabled
    );

    const errors: string[] = [];
    for (const eng of engines) {
      try {
        const text = await eng.run();
        return NextResponse.json({ text, engine: eng.name });
      } catch (e) {
        const msg = (e as Error).message || "";
        console.error(`/api/transcribe ${eng.name} failed:`, msg);
        errors.push(msg);
      }
    }

    // Every engine failed — return the most actionable guidance we can.
    const joined = errors.join(" | ");
    let hint =
      "Voice input isn't available right now. Make sure the local speech service " +
      "is running (services/speech on port 8000), or configure another STT engine. " +
      "You can type your message meanwhile.";
    if (!STT_BASE && /integrator|permission denied|\b403\b/i.test(joined)) {
      hint =
        "Intron account isn't approved for API access yet (needs an 'integrator " +
        "account'). Email voice@intron.io, or start the local Whisper service.";
    }
    return NextResponse.json({ error: hint }, { status: 503 });
  } catch (e) {
    console.error("/api/transcribe error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
