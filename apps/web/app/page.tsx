"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { FlipWords } from "./flipword";
import ThemeToggle from "../components/ThemeToggle";
import TransitBackground from "../components/TransitBackground";
import AuthGate from "../components/AuthGate";
import NotificationBell from "../components/NotificationBell";
import HistoryDrawer from "../components/HistoryDrawer";
import MapPanel from "../components/MapPanel";
import StellarPanel from "../components/StellarPanel";
import { findStopsInText } from "../lib/lagos-stops";
import { useVoiceRecorder } from "../lib/useVoiceRecorder";
import { useTextToSpeech } from "../lib/useTextToSpeech";
import { useAuth } from "../lib/useAuth";
import { useNotifications } from "../lib/useNotifications";
import { useChatHistory, type Msg } from "../lib/useChatHistory";

// Rotating greeting across Nigeria's major languages (animated via FlipWords).
const GREETINGS = ["E kaabo.", "Nnọọ.", "Barka.", "Welcome."];

const SAMPLES = [
  "Mo fẹ lọ si Oshodi lati CMS",
  "Kedu ka m ga-esi gaa Ikeja site na Yaba?",
  "Ina son zuwa Lekki daga Obalende",
  "How much from Ikorodu to TBS?",
];

/**
 * Languages offered for voice input. `code` is the ASR hint sent to the
 * transcription API (Intron / 0G Whisper). Pidgin (pcm) is supported by Intron.
 */
const LANGUAGES: { code: string; label: string }[] = [
  { code: "", label: "Auto-detect" },
  { code: "yo", label: "Yorùbá" },
  { code: "ig", label: "Igbo" },
  { code: "ha", label: "Hausa" },
  { code: "en", label: "English" },
  { code: "pcm", label: "Pidgin" },
];

export default function Home() {
  const { status, identityKey, displayName, signOut } = useAuth();

  // Identity scope for history + notifications (null = anonymous / ephemeral).
  const history = useChatHistory(identityKey);
  const notif = useNotifications(identityKey);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [kbSource, setKbSource] = useState<string>("");
  const [lang, setLang] = useState<string>("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [stellarOpen, setStellarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stops mentioned in the latest exchange, to highlight on the map.
  const detectedRoute = useMemo(() => {
    const rev = [...messages].reverse();
    const lastUser = rev.find((m) => m.role === "user")?.content || "";
    const lastAssistant = rev.find((m) => m.role === "assistant")?.content || "";
    return findStopsInText(`${lastUser} ${lastAssistant}`);
  }, [messages]);

  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const voice = useVoiceRecorder(
    (text) => setInput((prev) => (prev ? `${prev} ${text}` : text)),
    () => langRef.current || undefined
  );
  const tts = useTextToSpeech();

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setKbSource(data.kbSource || "");
      const final: Msg[] = [
        ...next,
        { role: "assistant", content: data.reply, verified: data.verified },
      ];
      setMessages(final);
      history.saveMessages(final);
      notif.notify(
        data.verified ? "Reply verified on 0G Compute" : "Reply received",
        data.verified ? "success" : "info"
      );
    } catch (e: any) {
      const errText = e.message || "couldn't reach 0G Compute.";
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Wahala dey o — " + errText },
      ]);
      notif.notify("Couldn't get a route", "warn", errText);
    } finally {
      setLoading(false);
    }
  }

  function toggleMic() {
    if (voice.status === "recording") voice.stop();
    else voice.start();
  }

  function handleSelectChat(id: string) {
    const conv = history.conversations.find((c) => c.id === id);
    if (conv) setMessages(conv.messages);
    history.selectChat(id);
    setDrawerOpen(false);
  }

  function handleNewChat() {
    setMessages([]);
    setKbSource("");
    history.newChat();
    setDrawerOpen(false);
  }

  const recording = voice.status === "recording";
  const transcribing = voice.status === "transcribing";
  const identityLabel = displayName ?? "Guest";

  // Gate: show the sign-in / anonymous landing until a session exists.
  if (status === "loading") {
    return <main className="boot" aria-busy="true" />;
  }
  if (status === "unauthenticated") {
    return <AuthGate />;
  }

  return (
    <>
      <TransitBackground />

      <HistoryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        conversations={history.conversations}
        currentId={history.currentId}
        canPersist={status === "connected"}
        identityLabel={identityLabel}
        onSelect={handleSelectChat}
        onNew={handleNewChat}
        onDelete={history.deleteChat}
        onSignOut={signOut}
      />

      <MapPanel
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        route={detectedRoute}
      />

      <StellarPanel open={stellarOpen} onClose={() => setStellarOpen(false)} />

      <main className="wrap">
        <header className="top">
          <button
            type="button"
            className="hamburger"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu and chat history"
          >
            <span aria-hidden>☰</span>
          </button>

          <div className="brandtext">
            <span className="busmark" role="img" aria-label="DanfoAI" />
            <span className="wordmark">
              <span className="wm">DanfoAI</span>
              <span className="tagline">Your route, your language</span>
            </span>
          </div>

          <div className="chainbadge" title="Powered by 0G decentralized AI">
            on&nbsp;0G
          </div>

          <button
            type="button"
            className="mapbtn"
            onClick={() => setMapOpen(true)}
            aria-label={
              detectedRoute.length > 1
                ? `Open route map: ${detectedRoute[0]} to ${detectedRoute[detectedRoute.length - 1]}`
                : "Open route map"
            }
            title="Route map"
          >
            <span aria-hidden>🗺️</span>
            {detectedRoute.length > 1 && <span className="mapdot" aria-hidden />}
          </button>

          <button
            type="button"
            className="mapbtn"
            onClick={() => setStellarOpen(true)}
            aria-label="Community routes on Stellar"
            title="Community routes on Stellar"
          >
            <span aria-hidden>⭐</span>
          </button>

          <NotificationBell
            items={notif.items}
            unreadCount={notif.unreadCount}
            onOpen={notif.markAllRead}
            onClear={notif.clearAll}
          />
          <ThemeToggle />
        </header>

        <section className="chat" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty">
              <p className="emptylead">
                <FlipWords words={GREETINGS} duration={2500} /> Where you dey go
                today?
              </p>
              <div className="samples">
                {SAMPLES.map((s) => (
                  <button key={s} className="sample" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              <div className="content">{m.content}</div>
              {m.role === "assistant" && (
                <div className="meta">
                  <span className={`verify ${m.verified ? "ok" : "warn"}`}>
                    {m.verified ? "✓ verified on 0G Compute" : "unverified response"}
                  </span>
                  <button
                    type="button"
                    className={`speak ${tts.playingId === i ? "playing" : ""}`}
                    onClick={() => tts.speak(i, m.content, lang || "en")}
                    disabled={tts.loadingId === i}
                    aria-label={
                      tts.playingId === i ? "Stop speaking" : "Listen to reply"
                    }
                    title={tts.playingId === i ? "Stop" : "Listen (YarnGPT)"}
                  >
                    {tts.loadingId === i ? "…" : tts.playingId === i ? "◼" : "🔊"}
                  </button>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="bubble assistant">
              <div className="content typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
        </section>

        {voice.unavailable && (
          <div className="voicehint" role="status">
            <span aria-hidden>🎙️</span> Voice input isn’t set up yet — type your
            message, or tap the mic to retry.
          </div>
        )}
        {(tts.error || (!voice.unavailable && voice.error)) && (
          <div className="micerror" role="alert">
            {tts.error || voice.error}
          </div>
        )}

        <footer className="composer">
          {voice.supported && (
            <select
              className="langpick"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              aria-label="Voice input language"
              title="Voice input language"
              disabled={recording || transcribing}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          )}

          {voice.supported && (
            <button
              type="button"
              className={`mic ${recording ? "live" : ""} ${
                voice.unavailable ? "muted" : ""
              }`}
              onClick={toggleMic}
              disabled={transcribing || loading}
              aria-pressed={recording}
              aria-label={
                recording
                  ? "Stop recording"
                  : transcribing
                  ? "Transcribing"
                  : "Record voice"
              }
              title={recording ? "Stop recording" : "Record voice"}
            >
              {transcribing ? "…" : recording ? "■" : "🎤"}
            </button>
          )}

          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder={
              recording
                ? "Listening… tap ■ to stop"
                : "Type your destination: where you dey go?"
            }
            aria-label="Your destination"
          />
          <button className="go" onClick={() => send(input)} disabled={loading}>
            Go
          </button>
        </footer>

        {kbSource && (
          <div className="provenance">
            route data: {kbSource} · corrections recorded on 0G Chain
          </div>
        )}
      </main>

      <style jsx>{`
        .boot {
          min-height: 100dvh;
          background: var(--bg);
        }
        .wrap {
          position: relative;
          z-index: 1;
          max-width: 720px;
          margin: 0 auto;
          height: 100dvh;
          display: flex;
          flex-direction: column;
          background: color-mix(in srgb, var(--bg) 86%, transparent);
        }
        .top {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 18px;
          border-bottom: 3px solid var(--header-border);
          background: var(--header-bg);
        }
        .hamburger {
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          border: 2px solid var(--header-border);
          border-radius: 10px;
          background: transparent;
          color: var(--header-text);
          font-size: 17px;
          cursor: pointer;
        }
        .hamburger:hover {
          background: rgba(0, 0, 0, 0.08);
        }
        .hamburger:focus-visible,
        .mapbtn:focus-visible,
        .go:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px var(--ring);
        }
        .mapbtn {
          position: relative;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          border: 2px solid var(--header-border);
          border-radius: 999px;
          background: transparent;
          color: var(--header-text);
          font-size: 16px;
          cursor: pointer;
        }
        .mapbtn:hover {
          background: rgba(0, 0, 0, 0.08);
        }
        .mapdot {
          position: absolute;
          top: -2px;
          right: -2px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--verify-ok);
          border: 2px solid var(--header-bg);
        }
        .brandtext {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        /* The bus, cropped from the logo PNG (region x116-716, y212-596). */
        .busmark {
          flex-shrink: 0;
          width: 93px;
          height: 60px;
          background-image: url("/danfoai_logo.png");
          background-repeat: no-repeat;
          background-size: 208px 122px;
          background-position: -17px -32px;
        }
        .wordmark {
          display: flex;
          flex-direction: column;
          line-height: 1.05;
          min-width: 0;
        }
        .wm {
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--logo-ink);
        }
        .tagline {
          font-size: 10.5px;
          color: var(--header-subtext);
          margin-top: 3px;
          white-space: nowrap;
        }
        .brandtext h1 {
          margin: 0;
          font-size: 24px;
          letter-spacing: -0.02em;
          font-weight: 800;
          color: var(--header-text);
        }
        .brandtext p {
          margin: 2px 0 0;
          font-size: 12px;
          color: var(--header-subtext);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .chainbadge {
          font-size: 12px;
          font-weight: 700;
          background: var(--badge-bg);
          color: var(--badge-text);
          padding: 6px 10px;
          border-radius: 999px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .chat {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .empty { margin: auto 0; text-align: center; }
        .emptylead {
          position: relative;
          font-size: 18px;
          font-weight: 700;
          color: var(--text);
          margin-bottom: 16px;
        }
        .samples {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: 420px;
          margin: 0 auto;
          width: 100%;
        }
        .sample {
          text-align: left;
          padding: 12px 14px;
          border: 2px solid var(--border);
          border-radius: 12px;
          background: var(--surface);
          color: var(--text);
          font-size: 14px;
          cursor: pointer;
          transition: transform 0.05s, background 0.15s;
        }
        .sample:hover { background: var(--surface-hover); transform: translateY(-1px); }
        .bubble { max-width: 82%; }
        .bubble.user {
          align-self: flex-end;
          background: var(--user-bubble);
          color: var(--user-bubble-text);
          padding: 12px 15px;
          border-radius: 16px 16px 4px 16px;
        }
        .bubble.assistant {
          align-self: flex-start;
          background: var(--surface);
          color: var(--text);
          border: 2px solid var(--border);
          padding: 12px 15px;
          border-radius: 16px 16px 16px 4px;
        }
        .content { white-space: pre-wrap; line-height: 1.5; font-size: 15px; }
        .meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 7px;
        }
        .verify {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }
        .verify.ok { color: var(--verify-ok); }
        .verify.warn { color: var(--verify-warn); }
        .speak {
          margin-left: auto;
          border: 1.5px solid var(--border);
          border-radius: 999px;
          background: transparent;
          color: var(--text);
          font-size: 12px;
          line-height: 1;
          padding: 4px 8px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .speak:hover { background: var(--surface-hover); }
        .speak.playing { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
        .speak:disabled { opacity: 0.6; cursor: default; }
        .typing { display: flex; gap: 4px; }
        .typing span {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--typing-dot); opacity: 0.4;
          animation: blink 1.2s infinite;
        }
        .typing span:nth-child(2) { animation-delay: 0.2s; }
        .typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes blink { 0%,100%{opacity:0.2} 50%{opacity:0.9} }
        .micerror {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--danger);
          text-align: center;
          padding: 8px 16px 0;
        }
        .voicehint {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text-muted);
          background: var(--surface-hover);
          border-top: 1px solid var(--border);
          text-align: center;
          padding: 8px 16px;
        }
        .mic.muted {
          opacity: 0.6;
        }
        .composer {
          display: flex;
          gap: 8px;
          padding: 14px 16px;
          border-top: 3px solid var(--header-border);
          background: color-mix(in srgb, var(--bg) 86%, transparent);
        }
        .langpick {
          border: 2px solid var(--border);
          border-radius: 12px;
          background: var(--surface);
          color: var(--text);
          font-size: 13px;
          font-weight: 600;
          padding: 0 8px;
          cursor: pointer;
          max-width: 120px;
        }
        .langpick:disabled { opacity: 0.6; cursor: default; }
        .composer input {
          flex: 1;
          min-width: 0;
          padding: 13px 15px;
          border: 2px solid var(--border);
          border-radius: 12px;
          font-size: 16px; /* >=16px stops iOS Safari zooming on focus */
          background: var(--surface);
          color: var(--text);
          outline: none;
        }
        .composer input::placeholder { color: var(--text-muted); opacity: 0.8; }
        .composer input:focus { box-shadow: 0 0 0 3px var(--ring); }
        .mic, .go {
          border: 2px solid var(--border);
          border-radius: 12px;
          font-weight: 700;
          cursor: pointer;
          font-size: 16px;
          padding: 0 14px;
          flex-shrink: 0;
        }
        .mic {
          background: var(--surface);
          color: var(--text);
          min-width: 48px;
        }
        .mic.live {
          background: var(--danger);
          color: #fff;
          border-color: var(--danger);
          animation: pulse 1.3s ease-in-out infinite;
        }
        .mic:disabled { opacity: 0.55; cursor: default; }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(217, 38, 38, 0.5); }
          50% { box-shadow: 0 0 0 6px rgba(217, 38, 38, 0); }
        }
        .go {
          background: var(--accent);
          color: var(--accent-text);
        }
        .go:disabled { opacity: 0.5; cursor: default; }
        .provenance {
          font-size: 11px;
          color: var(--provenance);
          text-align: center;
          padding: 6px 0 10px;
        }

        /* ---- Tablet ---- */
        @media (max-width: 768px) {
          .top { padding: 14px 14px; gap: 10px; }
          .brandtext h1 { font-size: 21px; }
          .chat { padding: 16px; }
          .bubble { max-width: 88%; }
        }

        /* ---- Mobile phones ---- */
        @media (max-width: 480px) {
          .top { padding: 11px 12px; gap: 8px; }
          .busmark {
            width: 65px;
            height: 42px;
            background-size: 146px 86px;
            background-position: -12px -22px;
          }
          .wm { font-size: 19px; }
          .tagline { display: none; }
          .brandtext h1 { font-size: 19px; }
          .brandtext p { display: none; }
          .chainbadge { display: none; }
          .chat { padding: 14px 12px; gap: 12px; }
          .bubble { max-width: 90%; }
          .composer { padding: 10px 12px; gap: 6px; flex-wrap: wrap; }
          .langpick {
            order: 3;
            flex: 1 1 100%;
            max-width: none;
            padding: 8px;
          }
          .mic { order: 1; min-width: 46px; }
          .composer input { order: 2; }
          .go { order: 4; flex: 1 1 100%; padding: 12px; }
        }
      `}</style>
    </>
  );
}
