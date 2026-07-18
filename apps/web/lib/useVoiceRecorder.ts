"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus = "idle" | "recording" | "transcribing";

interface UseVoiceRecorderResult {
  status: RecorderStatus;
  supported: boolean;
  unavailable: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

const UNAVAILABLE_KEY = "danfo-voice-unavailable";

function getSpeechRecognition(): any {
  if (typeof window === "undefined") return null;
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  );
}

function toBCP47(code?: string): string {
  switch (code) {
    case "yo":
      return "yo-NG";
    case "ig":
      return "ig-NG";
    case "ha":
      return "ha-NG";
    case "en":
      return "en-NG";
    case "pcm":
      return "en-NG";
    default:
      return ""; // browser default
  }
}

/**
 * Voice-to-text.
 *
 * Primary: the browser's Web Speech API — instant, on-device, zero server load.
 * Falls back to the local Whisper service (/api/transcribe) only when the
 * browser has no speech recognition (e.g. Firefox).
 */
export function useVoiceRecorder(
  onResult: (text: string) => void,
  getLanguage?: () => string | undefined
): UseVoiceRecorderResult {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [supported, setSupported] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const hasWebSpeech = !!getSpeechRecognition();
    const hasRecorder =
      typeof window !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof window.MediaRecorder !== "undefined";
    setSupported(hasWebSpeech || hasRecorder);
    if (hasWebSpeech) {
      try {
        localStorage.removeItem(UNAVAILABLE_KEY);
      } catch {
        /* ignore */
      }
    } else {
      try {
        if (localStorage.getItem(UNAVAILABLE_KEY) === "1") setUnavailable(true);
      } catch {
        /* ignore */
      }
    }
  }, []);

  // --- Browser Web Speech (instant) -----------------------------------------
  const startWebSpeech = useCallback((): boolean => {
    const SR = getSpeechRecognition();
    if (!SR) return false;
    setError(null);
    const rec = new SR();
    const lang = toBCP47(getLanguage?.());
    if (lang) rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const t = e.results?.[0]?.[0]?.transcript?.trim();
      if (t) onResult(t);
    };
    rec.onerror = (e: any) => {
      const err = e?.error;
      if (err === "aborted") return;
      if (err === "no-speech") setError("Didn't catch that — try again.");
      else if (err === "not-allowed" || err === "service-not-allowed")
        setError("Microphone permission denied.");
      else if (err === "language-not-supported")
        setError("That language isn't supported for voice here — try English.");
      else setError("Voice recognition failed — try again.");
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setStatus("idle");
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setStatus("recording");
    } catch {
      recognitionRef.current = null;
      setStatus("idle");
      setError("Couldn't start voice recognition.");
    }
    return true;
  }, [onResult, getLanguage]);

  // --- Whisper fallback ------------------------------------------------------
  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const startFallback = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Voice input isn't supported in this browser.");
      return;
    }
    setError(null);
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        cleanupStream();
        if (cancelledRef.current || blob.size === 0) {
          setStatus("idle");
          return;
        }
        setStatus("transcribing");
        try {
          const form = new FormData();
          form.append("file", blob, "audio.webm");
          const language = getLanguage?.();
          if (language) form.append("language", language);
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = await res.json();
          if (!res.ok || data.error) {
            if (res.status === 403 || res.status === 503) {
              setUnavailable(true);
              try {
                localStorage.setItem(UNAVAILABLE_KEY, "1");
              } catch {
                /* ignore */
              }
            }
            throw new Error(data.error || `Transcription failed (${res.status})`);
          }
          const text = (data.text || "").trim();
          if (text) onResult(text);
          else setError("Didn't catch that — try again.");
        } catch (e) {
          setError((e as Error).message || "Couldn't transcribe audio.");
        } finally {
          setStatus("idle");
        }
      };
      recorder.start();
      setStatus("recording");
    } catch (e) {
      cleanupStream();
      setStatus("idle");
      setError(
        (e as Error).name === "NotAllowedError"
          ? "Microphone permission denied."
          : "Couldn't access the microphone."
      );
    }
  }, [cleanupStream, onResult, getLanguage]);

  const start = useCallback(async () => {
    if (status !== "idle") return;
    if (getSpeechRecognition()) {
      startWebSpeech();
      return;
    }
    await startFallback();
  }, [status, startWebSpeech, startFallback]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    if (recorderRef.current && status === "recording") recorderRef.current.stop();
  }, [status]);

  const cancel = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
      setStatus("idle");
      return;
    }
    cancelledRef.current = true;
    if (recorderRef.current && status === "recording") recorderRef.current.stop();
  }, [status]);

  useEffect(() => cleanupStream, [cleanupStream]);

  return { status, supported, unavailable, error, start, stop, cancel };
}
