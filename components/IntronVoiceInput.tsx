"use client";

/**
 * Intron Sahara streaming speech-to-text
 * (@intron_health/intron_transcriber_streaming).
 *
 * Intron's ASR is built for African accents and natively understands the
 * languages DanfoAI cares about — Yoruba, Igbo, Hausa, English and Nigerian
 * Pidgin. The widget streams transcripts live over a WebSocket to Intron's
 * inference service while the rider is still speaking.
 *
 * The widget renders its own floating record button. We keep
 * `writeStreamInActiveTextbox: false` so it never writes into the DOM behind
 * React's back — instead we pick the text up from its document-level events
 * and feed it into React state:
 *  - intronInferEventStreamTextReceived → partial text, live
 *  - intronInferEventTranscriptResult   → final transcript, on session end
 */

import { useEffect, useRef } from "react";

interface IntronVoiceInputProps {
  /** Intron integration access key (voice.intron.io → View Integration). */
  apiKey: string;
  /** Live partial transcript while the rider speaks. */
  onStreaming?: (text: string) => void;
  /** Final transcript once the recording session ends. */
  onFinal?: (text: string) => void;
  /** Post-processing category; "general" suits transit queries. */
  category?: string;
  /** Widget position from the right / bottom of the viewport. */
  positionX?: string;
  positionY?: string;
}

export default function IntronVoiceInput({
  apiKey,
  onStreaming,
  onFinal,
  category = "general",
  positionX = "18px",
  positionY = "84px",
}: IntronVoiceInputProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Latest handlers, so the widget is loaded once per key instead of every render.
  const handlersRef = useRef({ onStreaming, onFinal });
  useEffect(() => {
    handlersRef.current = { onStreaming, onFinal };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !apiKey) return;

    let cancelled = false;
    let cleanupWidget = () => {};

    (async () => {
      try {
        // Dynamic import: the widget touches browser APIs, so never let it
        // evaluate during SSR.
        const { loadIntronTranscribeWidget } = await import(
          "@intron_health/intron_transcriber_streaming"
        );
        if (cancelled) return;

        loadIntronTranscribeWidget(host, apiKey, {
          // We own the input box (React state) — take text via events instead.
          writeStreamInActiveTextbox: false,
          showPostProcessingCategory: category,
          positionX,
          positionY,
        });
        cleanupWidget = () => {
          host.innerHTML = ""; // widget exposes no teardown API
        };
      } catch (e) {
        console.error("Intron widget failed to load:", (e as Error).message);
      }
    })();

    const handleStream = (e: Event) => {
      const text = (e as CustomEvent).detail;
      if (typeof text === "string" && text.trim())
        handlersRef.current.onStreaming?.(text.trim());
    };
    const handleResult = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const text = String(detail.transcript_text ?? "").trim();
      if (text) handlersRef.current.onFinal?.(text);
    };

    document.addEventListener("intronInferEventStreamTextReceived", handleStream);
    document.addEventListener("intronInferEventTranscriptResult", handleResult);

    return () => {
      cancelled = true;
      cleanupWidget();
      document.removeEventListener("intronInferEventStreamTextReceived", handleStream);
      document.removeEventListener("intronInferEventTranscriptResult", handleResult);
    };
  }, [apiKey, category, positionX, positionY]);

  // The widget positions itself; the host is just an anchor and takes no space.
  return <div ref={hostRef} className="intron-host" aria-hidden />;
}
