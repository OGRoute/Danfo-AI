"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isLangCode, type LangCode } from "./language-detect";

export type RecorderStatus = "idle" | "recording" | "transcribing";
/** intron / whisper = recorded here, transcribed on the server; browser = Web Speech API. */
export type VoiceEngine = "intron" | "whisper" | "browser";

interface VoiceOptions {
  /** Language picked in the UI: yo | ig | ha | en | pcm, or "" for auto-detect. */
  getLanguage: () => string;
  /** A finished phrase, ready to append to the message box. */
  onText: (text: string) => void;
  /** Words still being recognised (browser engine only). */
  onInterim?: (text: string) => void;
  /** The language the speech was recognised as. */
  onLanguage?: (code: LangCode) => void;
}

interface UseVoiceRecorderResult {
  status: RecorderStatus;
  engine: VoiceEngine | null;
  supported: boolean;
  unavailable: boolean;
  error: string | null;
  /** Non-fatal information about the engine in use. */
  notice: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

// A pause this long ends a phrase, which is then sent for transcription.
const SILENCE_CUT_MS = 1100;
// Never send more than this in one request (Intron's sync limit is 120 s).
const MAX_SEGMENT_MS = 25_000;
// Stop listening after this long with no speech at all.
const IDLE_STOP_MS = 30_000;
const MAX_SESSION_MS = 5 * 60_000;
// Ignore clicks and bumps shorter than this.
const MIN_SPEECH_MS = 240;
// Intron needs at least 1 s of audio, so a pause never ends a phrase sooner.
const MIN_SEGMENT_MS = 1500;
const TICK_MS = 60;

const UNAVAILABLE_KEY = "danfo-voice-unavailable";
const MAX_SESSION_MESSAGE = "Stopped after 5 minutes — tap the mic to keep talking.";

function getSpeechRecognition(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function toBCP47(code?: string): string {
  switch (code) {
    case "yo":
      return "yo-NG";
    case "ig":
      return "ig-NG";
    case "ha":
      return "ha-NG";
    default:
      return "en-NG"; // English, Pidgin and auto-detect
  }
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
}

const extensionFor = (mime: string) =>
  mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";

interface Capabilities {
  intron: boolean;
  /** Why a configured Intron can't be used right now (e.g. out of credit). */
  intronProblem: string | null;
  local: boolean;
}

let capabilities: Promise<Capabilities> | null = null;
function loadCapabilities(): Promise<Capabilities> {
  if (!capabilities) {
    capabilities = fetch("/api/transcribe")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => ({ intron: !!d?.intron, intronProblem: d?.intronProblem ?? null, local: !!d?.local }))
      .catch(() => {
        capabilities = null; // retry next time
        return { intron: false, intronProblem: null, local: false };
      });
  }
  return capabilities;
}

// ---------------------------------------------------------------------------
// Server transcription: record phrase by phrase, split on pauses
// ---------------------------------------------------------------------------

interface Controller {
  opts: () => VoiceOptions;
  setStatus: (s: RecorderStatus) => void;
  setError: (e: string | null) => void;
  markUnavailable: () => void;
  isCurrent: (session: object) => boolean;
  release: (session: object) => void;
}

interface Segment {
  rec: MediaRecorder;
  chunks: Blob[];
  send: boolean;
}

interface ServerSession {
  stream: MediaStream;
  ctx: AudioContext;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  timer: ReturnType<typeof setInterval> | undefined;
  mimeType: string;
  current: Segment | null;
  segmentStart: number;
  speechMs: number;
  lastVoice: number;
  startedAt: number;
  noiseFloor: number;
  /** Language sent with each phrase; filled in after auto-detect succeeds. */
  language: string;
  queue: Promise<void>;
  pending: number;
  /** The last segment is being finalised after stop(). */
  flushing: boolean;
  stopped: boolean;
  cancelled: boolean;
}

function settle(ctl: Controller, s: ServerSession) {
  if (!ctl.isCurrent(s)) return;
  if (!s.stopped) ctl.setStatus("recording");
  else if (s.pending > 0 || s.flushing) ctl.setStatus("transcribing");
  else {
    ctl.setStatus("idle");
    ctl.release(s);
  }
}

async function uploadPhrase(ctl: Controller, s: ServerSession, blob: Blob) {
  const form = new FormData();
  form.append("file", blob, `speech.${extensionFor(s.mimeType)}`);
  if (s.language) form.append("language", s.language);
  try {
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      if (res.status === 503) {
        ctl.markUnavailable();
        capabilities = null; // re-check engines on the next tap (may switch to the browser)
      }
      throw new Error(data.error || `Transcription failed (${res.status})`);
    }
    // Auto-detect runs once; the rest of the session reuses the result.
    if (!s.language && typeof data.lock === "string") s.language = data.lock;
    if (isLangCode(data.language)) ctl.opts().onLanguage?.(data.language);
    const text = String(data.text || "").trim();
    if (text && !s.cancelled) ctl.opts().onText(text);
  } catch (e) {
    if (!s.cancelled) ctl.setError((e as Error).message || "Couldn't transcribe audio.");
  }
}

function enqueue(ctl: Controller, s: ServerSession, blob: Blob) {
  s.pending++;
  settle(ctl, s);
  // Sequential, so phrases land in the message box in the order they were said.
  s.queue = s.queue
    .then(() => uploadPhrase(ctl, s, blob))
    .finally(() => {
      s.pending--;
      settle(ctl, s);
    });
}

function releaseMedia(s: ServerSession) {
  clearInterval(s.timer);
  s.stream.getTracks().forEach((t) => t.stop());
  s.ctx.close().catch(() => {});
}

function startSegment(ctl: Controller, s: ServerSession) {
  const rec = new MediaRecorder(s.stream, s.mimeType ? { mimeType: s.mimeType } : undefined);
  const seg: Segment = { rec, chunks: [], send: false };
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) seg.chunks.push(e.data);
  };
  rec.onstop = () => {
    if (seg.send && !s.cancelled && seg.chunks.length) {
      enqueue(ctl, s, new Blob(seg.chunks, { type: rec.mimeType || s.mimeType || "audio/webm" }));
    }
    if (s.stopped) {
      s.flushing = false;
      releaseMedia(s);
      settle(ctl, s);
    }
  };
  rec.start();
  s.current = seg;
  s.segmentStart = performance.now();
  s.speechMs = 0;
}

/** Close the current recording (sending it if it holds speech) and start the next. */
function cutSegment(ctl: Controller, s: ServerSession, send: boolean) {
  const seg = s.current;
  if (!seg) return;
  seg.send = send;
  s.current = null;
  if (s.stopped) s.flushing = true;
  try {
    seg.rec.stop();
  } catch {
    s.flushing = false;
  }
  if (!s.stopped) startSegment(ctl, s);
}

function finishServer(ctl: Controller, s: ServerSession, send: boolean, message?: string) {
  if (s.stopped) return;
  s.stopped = true;
  clearInterval(s.timer);
  if (message) ctl.setError(message);
  if (s.current) cutSegment(ctl, s, send && s.speechMs >= MIN_SPEECH_MS);
  else releaseMedia(s);
  settle(ctl, s);
}

/** Voice-activity detection: split phrases on pauses, stop when the rider goes quiet. */
function tick(ctl: Controller, s: ServerSession) {
  if (s.stopped) return;
  s.analyser.getFloatTimeDomainData(s.samples);
  let sum = 0;
  for (const v of s.samples) sum += v * v;
  const rms = Math.sqrt(sum / s.samples.length);

  // Track background noise: drop quickly to quiet levels, rise slowly.
  s.noiseFloor = rms < s.noiseFloor ? rms : s.noiseFloor + (rms - s.noiseFloor) * 0.004;
  const now = performance.now();
  if (rms > Math.max(0.01, s.noiseFloor * 2.5)) {
    s.speechMs += TICK_MS;
    s.lastVoice = now;
  }

  const heard = s.speechMs >= MIN_SPEECH_MS;
  const age = now - s.segmentStart;
  if (heard && now - s.lastVoice >= SILENCE_CUT_MS && age >= MIN_SEGMENT_MS) cutSegment(ctl, s, true);
  else if (age >= MAX_SEGMENT_MS) cutSegment(ctl, s, heard);
  else if (!heard && age >= 8000) cutSegment(ctl, s, false); // discard long silence

  if (now - s.lastVoice >= IDLE_STOP_MS) finishServer(ctl, s, true);
  else if (now - s.startedAt >= MAX_SESSION_MS) finishServer(ctl, s, true, MAX_SESSION_MESSAGE);
}

async function startServerSession(ctl: Controller): Promise<ServerSession | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (e) {
    ctl.setError(
      (e as Error).name === "NotAllowedError"
        ? "Microphone permission denied."
        : "Couldn't access the microphone."
    );
    return null;
  }

  const Ctx: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);

  const now = performance.now();
  const language = ctl.opts().getLanguage();
  const s: ServerSession = {
    stream,
    ctx,
    analyser,
    samples: new Float32Array(analyser.fftSize),
    timer: undefined,
    mimeType: pickMimeType(),
    current: null,
    segmentStart: now,
    speechMs: 0,
    lastVoice: now,
    startedAt: now,
    noiseFloor: 0.01,
    language: isLangCode(language) ? language : "",
    queue: Promise.resolve(),
    pending: 0,
    flushing: false,
    stopped: false,
    cancelled: false,
  };
  startSegment(ctl, s);
  s.timer = setInterval(() => tick(ctl, s), TICK_MS);
  return s;
}

// ---------------------------------------------------------------------------
// Browser Web Speech: continuous, restarted after each browser-imposed stop
// ---------------------------------------------------------------------------

interface BrowserSession {
  rec: any;
  stopped: boolean;
  lastActivity: number;
  startedAt: number;
  timer: ReturnType<typeof setInterval> | undefined;
}

function startBrowserSession(ctl: Controller): BrowserSession | null {
  const SR = getSpeechRecognition();
  if (!SR) return null;
  const now = performance.now();
  const b: BrowserSession = { rec: null, stopped: false, lastActivity: now, startedAt: now, timer: undefined };
  const lang = toBCP47(ctl.opts().getLanguage());

  const end = (message?: string) => {
    if (b.stopped) return;
    b.stopped = true;
    clearInterval(b.timer);
    if (message) ctl.setError(message);
    try {
      b.rec?.stop(); // still delivers any final result in flight
    } catch {
      /* already ended */
    }
    ctl.opts().onInterim?.("");
    if (ctl.isCurrent(b)) {
      ctl.setStatus("idle");
      ctl.release(b);
    }
  };

  const begin = () => {
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      b.lastActivity = performance.now();
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = String(result[0]?.transcript ?? "");
        if (result.isFinal) {
          if (text.trim()) ctl.opts().onText(text.trim());
        } else {
          interim += text;
        }
      }
      ctl.opts().onInterim?.(interim.trim());
    };
    rec.onerror = (e: any) => {
      const err = e?.error;
      if (err === "no-speech" || err === "aborted") return; // onend restarts
      if (err === "not-allowed" || err === "service-not-allowed") end("Microphone permission denied.");
      else if (err === "language-not-supported")
        end("Your browser can't recognise that language — pick English, or set up Intron voice.");
      else if (err === "network") end("Voice recognition needs an internet connection.");
      else end("Voice recognition failed — try again.");
    };
    rec.onend = () => {
      if (b.stopped) return;
      // Browsers end recognition after a pause or about a minute. Keep going
      // until the rider taps stop or stays quiet for a while.
      const t = performance.now();
      if (t - b.lastActivity < IDLE_STOP_MS && t - b.startedAt < MAX_SESSION_MS) {
        try {
          begin();
          return;
        } catch {
          /* fall through to end */
        }
      }
      end();
    };
    b.rec = rec;
    rec.start();
  };

  try {
    begin();
  } catch {
    return null;
  }
  b.timer = setInterval(() => {
    const t = performance.now();
    if (t - b.lastActivity >= IDLE_STOP_MS) end();
    else if (t - b.startedAt >= MAX_SESSION_MS) end(MAX_SESSION_MESSAGE);
  }, 1000);
  return b;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Voice-to-text that keeps listening until the rider taps stop (or goes quiet
 * for 30 s), instead of cutting off at the first pause.
 *
 * Engine choice:
 *  - Intron (server) whenever INTRON_API_KEY is set — the only engine that
 *    reliably understands Pidgin, Yoruba, Igbo and Hausa, with auto-detect.
 *  - Local Whisper (server) for non-English when it's running.
 *  - The browser's Web Speech API otherwise (good for English only).
 * Server engines receive the audio phrase by phrase (split on pauses), so
 * text appears while the rider is still talking.
 */
export function useVoiceRecorder(options: VoiceOptions): UseVoiceRecorderResult {
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [engine, setEngine] = useState<VoiceEngine | null>(null);
  const [supported, setSupported] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const serverRef = useRef<ServerSession | null>(null);
  const browserRef = useRef<BrowserSession | null>(null);

  const ctlRef = useRef<Controller>({
    opts: () => optsRef.current,
    setStatus,
    setError,
    markUnavailable: () => {
      setUnavailable(true);
      try {
        localStorage.setItem(UNAVAILABLE_KEY, "1");
      } catch {
        /* ignore */
      }
    },
    isCurrent: (session) => serverRef.current === session || browserRef.current === session,
    release: (session) => {
      if (serverRef.current === session) serverRef.current = null;
      if (browserRef.current === session) browserRef.current = null;
    },
  });

  useEffect(() => {
    const hasWebSpeech = !!getSpeechRecognition();
    const hasRecorder = !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
    setSupported(hasWebSpeech || hasRecorder);
    loadCapabilities();
    try {
      if (!hasWebSpeech && localStorage.getItem(UNAVAILABLE_KEY) === "1") setUnavailable(true);
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(async () => {
    if (status !== "idle" || serverRef.current || browserRef.current) return;
    const ctl = ctlRef.current;
    setError(null);
    setNotice(null);

    const language = optsRef.current.getLanguage();
    const caps = await loadCapabilities();
    const webSpeech = !!getSpeechRecognition();
    const canRecord = !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";

    let choice: VoiceEngine;
    if (caps.intron && canRecord) choice = "intron";
    else if (caps.local && canRecord && (language !== "en" || !webSpeech)) choice = "whisper";
    else if (webSpeech) choice = "browser";
    else choice = "whisper"; // the server will still try 0G Whisper

    if (choice === "browser") {
      if (language !== "en") {
        setNotice(
          caps.intronProblem
            ? `Intron voice isn't working right now (${caps.intronProblem}) — using the browser's English recogniser, which won't understand Pidgin, Yoruba, Igbo or Hausa well.`
            : "Pidgin, Yoruba, Igbo, Hausa and auto-detect need Intron voice, which isn't set up on this server — using the browser's English recogniser for now."
        );
      }
      const b = startBrowserSession(ctl);
      if (!b) {
        setError("Couldn't start voice recognition.");
        return;
      }
      browserRef.current = b;
    } else {
      setStatus("recording"); // immediate feedback while the mic permission prompt is open
      const s = await startServerSession(ctl);
      if (!s) {
        setStatus("idle");
        return;
      }
      serverRef.current = s;
    }
    setEngine(choice);
    setStatus("recording");
  }, [status]);

  const stop = useCallback(() => {
    const ctl = ctlRef.current;
    if (browserRef.current) {
      const b = browserRef.current;
      clearInterval(b.timer);
      b.stopped = true; // onend won't restart; a final result in flight still lands
      try {
        b.rec?.stop();
      } catch {
        /* ignore */
      }
      optsRef.current.onInterim?.("");
      browserRef.current = null;
      setStatus("idle");
      return;
    }
    if (serverRef.current) finishServer(ctl, serverRef.current, true);
  }, []);

  const cancel = useCallback(() => {
    const ctl = ctlRef.current;
    if (browserRef.current) {
      const b = browserRef.current;
      clearInterval(b.timer);
      b.stopped = true;
      try {
        b.rec?.abort();
      } catch {
        /* ignore */
      }
      optsRef.current.onInterim?.("");
      browserRef.current = null;
      setStatus("idle");
      return;
    }
    const s = serverRef.current;
    if (s) {
      s.cancelled = true;
      finishServer(ctl, s, false);
      // Drop it now; pending uploads finish silently.
      serverRef.current = null;
      setStatus("idle");
    }
  }, []);

  // Release the microphone if the page unmounts mid-recording.
  useEffect(
    () => () => {
      const s = serverRef.current;
      if (s) {
        s.cancelled = true;
        s.stopped = true;
        try {
          s.current?.rec.stop();
        } catch {
          /* ignore */
        }
        releaseMedia(s);
      }
      const b = browserRef.current;
      if (b) {
        b.stopped = true;
        clearInterval(b.timer);
        try {
          b.rec?.abort();
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  return { status, engine, supported, unavailable, error, notice, start, stop, cancel };
}
