"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import ThemeToggle from "../../components/ThemeToggle";
import { LANGUAGE_NAMES, type LangCode } from "../../lib/language-detect";
import { useAuth } from "../../lib/useAuth";
import { useSettings } from "../../lib/useSettings";
import { useTheme, type ThemePref } from "../../lib/useTheme";

const LANGUAGES: Array<{ code: "" | LangCode; label: string }> = [
  { code: "", label: "Match my question" },
  { code: "en", label: LANGUAGE_NAMES.en },
  { code: "pcm", label: LANGUAGE_NAMES.pcm },
  { code: "yo", label: "Yorùbá" },
  { code: "ig", label: LANGUAGE_NAMES.ig },
  { code: "ha", label: LANGUAGE_NAMES.ha },
];

const VOICE_LANGUAGES: Array<{ code: "" | LangCode; label: string }> = [
  { code: "", label: "Auto-detect" },
  ...LANGUAGES.slice(1),
];

const THEMES: Array<{ value: ThemePref; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

interface Status {
  routes?: { version: number; updatedAt: string; count: number; stops: number; modes: Record<string, number>; source: string };
  voice?: { speechToText: string; problem: string | null; textToSpeech: string };
  compute?: { available: boolean; model?: string; provider?: string; error?: string };
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <div className="row-text">
        <span className="row-label">{label}</span>
        {hint && <span className="row-hint">{hint}</span>}
      </div>
      <div className="row-control">{children}</div>
      <style jsx>{`
        .row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 0;
          border-top: 1px solid var(--border);
          flex-wrap: wrap;
        }
        .row:first-child {
          border-top: 0;
        }
        .row-text {
          flex: 1;
          min-width: 180px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .row-label {
          font-size: 14.5px;
          font-weight: 700;
          color: var(--text);
        }
        .row-hint {
          font-size: 12px;
          line-height: 1.45;
          color: var(--text-muted);
        }
        .row-control {
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
      <style jsx>{`
        .toggle {
          width: 52px;
          height: 30px;
          border-radius: 999px;
          border: 2px solid var(--border);
          background: var(--surface-hover);
          position: relative;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .toggle.on {
          background: var(--accent);
        }
        .knob {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: var(--surface);
          border: 2px solid var(--border);
          transition: transform 0.15s ease;
        }
        .toggle.on .knob {
          transform: translateX(22px);
        }
        .toggle:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px var(--ring);
        }
      `}</style>
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
      <style jsx>{`
        .seg {
          display: inline-flex;
          border: 2px solid var(--border);
          border-radius: 999px;
          overflow: hidden;
        }
        button {
          border: 0;
          background: transparent;
          color: var(--text);
          font-size: 13px;
          font-weight: 700;
          padding: 7px 13px;
          cursor: pointer;
        }
        button.on {
          background: var(--accent);
          color: var(--accent-text);
        }
        button:focus-visible {
          outline: none;
          box-shadow: inset 0 0 0 3px var(--ring);
        }
      `}</style>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const { pref, setPref } = useTheme();
  const { method, displayName, signOut } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [cleared, setCleared] = useState("");

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  function clearChats() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("danfo-history"))
        .forEach((k) => localStorage.removeItem(k));
      setCleared("Saved chats cleared on this device.");
    } catch {
      setCleared("Couldn't clear saved chats in this browser.");
    }
  }

  const modes = status?.routes?.modes ?? {};
  const modeSummary = Object.entries(modes)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${n} ${m}`)
    .join(" · ");

  return (
    <main className="wrap">
      <header className="top">
        <Link href="/" className="back" aria-label="Back to chat">
          ←
        </Link>
        <h1>Settings</h1>
        <ThemeToggle />
      </header>

      <div className="body">
        <section className="card">
          <h2>Appearance</h2>
          <Row label="Theme" hint="System follows your phone or computer.">
            <Segmented value={pref} options={THEMES} onChange={setPref} label="Theme" />
          </Row>
          <Row label="Map colours" hint="Force a light or dark map regardless of theme.">
            <Segmented
              value={settings.mapStyle}
              options={[
                { value: "auto", label: "Auto" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onChange={(v) => update("mapStyle", v)}
              label="Map colours"
            />
          </Row>
          <Row label="Show the trip card" hint="The computed route, fares and boarding points under each reply.">
            <Toggle on={settings.showTripCard} onChange={(v) => update("showTripCard", v)} label="Show the trip card" />
          </Row>
        </section>

        <section className="card">
          <h2>Language</h2>
          <Row label="Reply language" hint="DanfoAI answers in this language, whatever you type.">
            <select
              value={settings.replyLanguage}
              onChange={(e) => update("replyLanguage", e.target.value as "" | LangCode)}
              aria-label="Reply language"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Voice input language" hint="What the mic expects. Auto-detect works out which you spoke.">
            <select
              value={settings.voiceLanguage}
              onChange={(e) => update("voiceLanguage", e.target.value as "" | LangCode)}
              aria-label="Voice input language"
            >
              {VOICE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Row>
        </section>

        <section className="card">
          <h2>Voice</h2>
          <Row label="Read replies aloud" hint="Speaks each new answer automatically — handy while driving.">
            <Toggle on={settings.autoSpeak} onChange={(v) => update("autoSpeak", v)} label="Read replies aloud" />
          </Row>
          <Row label="Speaking voice">
            <Segmented
              value={settings.voiceGender}
              options={[
                { value: "female", label: "Female" },
                { value: "male", label: "Male" },
              ]}
              onChange={(v) => update("voiceGender", v)}
              label="Speaking voice"
            />
          </Row>
          <Row label="Voice engine" hint="Speech recognition and the voice that reads replies.">
            <span className="value">
              {status
                ? `${status.voice?.speechToText === "intron" ? "Intron" : status.voice?.speechToText === "problem" ? "Intron (unavailable)" : "Browser"} · ${
                    status.voice?.textToSpeech === "intron" ? "Intron voices" : status.voice?.textToSpeech === "yarngpt" ? "YarnGPT" : "Browser voice"
                  }`
                : "…"}
            </span>
          </Row>
          {status?.voice?.problem && <p className="warn">Voice input: {status.voice.problem}.</p>}
        </section>

        <section className="card">
          <h2>Live map</h2>
          <Row label="Use my location" hint="Shows where you are and how far is left on the trip.">
            <Toggle on={settings.liveLocation} onChange={(v) => update("liveLocation", v)} label="Use my location" />
          </Row>
          <Row label="Follow me while travelling" hint="Keeps the map centred on you until you drag it.">
            <Toggle on={settings.followMe} onChange={(v) => update("followMe", v)} label="Follow me while travelling" />
          </Row>
        </section>

        <section className="card">
          <h2>Account</h2>
          <Row label="Signed in as" hint={method === "anonymous" ? "Anonymous sessions stay on this device." : undefined}>
            <span className="value">{displayName ?? "Guest"}</span>
          </Row>
          {method === "clerk" && (
            <Row label="Manage account" hint="Profile, email and security, handled by Clerk.">
              <UserButton />
            </Row>
          )}
          <Row label="Sign out">
            <button type="button" className="btn" onClick={signOut}>
              Sign out
            </button>
          </Row>
        </section>

        <section className="card">
          <h2>Data</h2>
          <Row label="Saved chats" hint="Chat history is stored in this browser only.">
            <button type="button" className="btn" onClick={clearChats}>
              Clear chats
            </button>
          </Row>
          <Row label="Preferences" hint="Put every setting on this page back to its default.">
            <button type="button" className="btn" onClick={reset}>
              Reset
            </button>
          </Row>
          {cleared && <p className="ok">{cleared}</p>}
        </section>

        <section className="card">
          <h2>About</h2>
          <Row label="Route data" hint={modeSummary || undefined}>
            <span className="value">
              {status?.routes
                ? `v${status.routes.version} · ${status.routes.count} routes · ${status.routes.stops} stops`
                : "…"}
            </span>
          </Row>
          <Row label="Data source" hint="0G Storage when seeded, otherwise the bundled copy.">
            <span className="value">{status?.routes?.source ?? "…"}</span>
          </Row>
          <Row label="AI model" hint="Runs on 0G Compute; replies are verified on-chain.">
            <span className="value">
              {status?.compute?.available ? status.compute.model : status ? "unavailable" : "…"}
            </span>
          </Row>
          <Row label="Streets" hint="Street and landmark search uses OpenStreetMap.">
            <span className="value">OpenStreetMap</span>
          </Row>
          <p className="fine">
            Fares are community estimates and change often. Corrections are recorded on 0G Chain.
          </p>
        </section>
      </div>

      <style jsx>{`
        .wrap {
          min-height: 100dvh;
          background: var(--bg);
          color: var(--text);
        }
        .top {
          position: sticky;
          top: 0;
          z-index: 5;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          border-bottom: 3px solid var(--header-border);
          background: var(--header-bg);
        }
        h1 {
          flex: 1;
          margin: 0;
          font-size: 20px;
          font-weight: 800;
          color: var(--header-text);
        }
        .back {
          width: 38px;
          height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 2px solid var(--header-border);
          border-radius: 10px;
          color: var(--header-text);
          text-decoration: none;
          font-size: 18px;
        }
        .back:hover {
          background: rgba(0, 0, 0, 0.08);
        }
        .body {
          max-width: 720px;
          margin: 0 auto;
          padding: 18px 16px 60px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .card {
          background: var(--surface);
          border: 2px solid var(--border);
          border-radius: 16px;
          padding: 14px 16px;
        }
        h2 {
          margin: 0 0 6px;
          font-size: 13px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
        }
        select {
          border: 2px solid var(--border);
          border-radius: 10px;
          background: var(--surface);
          color: var(--text);
          font-size: 14px;
          font-weight: 600;
          padding: 7px 10px;
          cursor: pointer;
        }
        .btn {
          border: 2px solid var(--border);
          border-radius: 10px;
          background: var(--surface);
          color: var(--text);
          font-size: 13.5px;
          font-weight: 700;
          padding: 8px 14px;
          cursor: pointer;
        }
        .btn:hover {
          background: var(--surface-hover);
        }
        .value {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-muted);
          text-align: right;
          display: inline-block;
          max-width: 260px;
          overflow-wrap: anywhere;
        }
        .warn {
          margin: 10px 0 0;
          font-size: 12.5px;
          color: var(--verify-warn);
        }
        .ok {
          margin: 10px 0 0;
          font-size: 12.5px;
          color: var(--verify-ok);
        }
        .fine {
          margin: 12px 0 0;
          font-size: 11.5px;
          line-height: 1.5;
          color: var(--text-muted);
        }
        @media (max-width: 480px) {
          .body {
            padding: 14px 12px 50px;
          }
          .value {
            max-width: 180px;
          }
        }
      `}</style>
    </main>
  );
}
