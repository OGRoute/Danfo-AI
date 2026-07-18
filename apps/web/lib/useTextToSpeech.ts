"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseTextToSpeechResult {
  /** Index of the message currently loading audio (server path only), or null. */
  loadingId: number | null;
  /** Index of the message currently playing, or null. */
  playingId: number | null;
  error: string | null;
  /** Speak a message; tapping the same one again stops it. */
  speak: (id: number, text: string, language?: string) => Promise<void>;
  stop: () => void;
}

/** BCP-47 tag for the browser speech engine. */
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
      return "en-NG";
  }
}

function getSynth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

/**
 * Text-to-speech for assistant replies.
 *
 * Primary: the browser's built-in speechSynthesis — instant, free, zero load on
 * the server/machine. Falls back to the YarnGPT /api/speak service (Nigerian
 * voice, but slow on CPU) only when the browser has no speech synthesis.
 */
export function useTextToSpeech(): UseTextToSpeechResult {
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const cleanupAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.removeAttribute("src");
      a.load();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    getSynth()?.cancel();
    cleanupAudio();
    setPlayingId(null);
  }, [cleanupAudio]);

  // --- Server fallback (YarnGPT) --------------------------------------------
  const speakServer = useCallback(
    async (id: number, text: string, language?: string) => {
      setLoadingId(id);
      try {
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Speech failed (${res.status})`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => stop();
        audio.onerror = () => {
          setError("Couldn't play audio.");
          stop();
        };
        await audio.play();
        setPlayingId(id);
      } catch (e) {
        setError((e as Error).message || "Text-to-speech failed.");
      } finally {
        setLoadingId(null);
      }
    },
    [stop]
  );

  const speak = useCallback(
    async (id: number, text: string, language?: string) => {
      // Tapping the active message again toggles it off.
      if (playingId === id || loadingId === id) {
        stop();
        setLoadingId(null);
        return;
      }
      stop();
      setError(null);

      const synth = getSynth();
      if (synth) {
        // Instant, on-device browser speech.
        const u = new SpeechSynthesisUtterance(text);
        u.lang = toBCP47(language);
        const voice = synth
          .getVoices()
          .find((v) => v.lang === u.lang) ||
          synth.getVoices().find((v) => v.lang?.startsWith("en"));
        if (voice) u.voice = voice;
        u.onend = () => setPlayingId((cur) => (cur === id ? null : cur));
        u.onerror = () => setPlayingId((cur) => (cur === id ? null : cur));
        synth.cancel();
        synth.speak(u);
        setPlayingId(id);
        return;
      }

      // No browser speech — use the YarnGPT service.
      await speakServer(id, text, language);
    },
    [playingId, loadingId, stop, speakServer]
  );

  useEffect(() => {
    return () => {
      getSynth()?.cancel();
      cleanupAudio();
    };
  }, [cleanupAudio]);

  return { loadingId, playingId, error, speak, stop };
}
