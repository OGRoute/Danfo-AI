"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { LangCode } from "./language-detect";

/**
 * Rider preferences, kept on the device. Everything here is a preference, not
 * a secret: the reply language, how voice behaves, what the map does by
 * default, and how much detail to show under each answer.
 */
export interface Settings {
  /** Language for replies; "" follows the language of each question. */
  replyLanguage: "" | LangCode;
  /** Default language for the mic; "" auto-detects from the speech. */
  voiceLanguage: "" | LangCode;
  /** Voice used when replies are read aloud. */
  voiceGender: "female" | "male";
  /** Read every new reply aloud automatically. */
  autoSpeak: boolean;
  /** Show the computed trip card under replies. */
  showTripCard: boolean;
  /** Ask for GPS as soon as the map opens. */
  liveLocation: boolean;
  /** Keep the map centred on the rider while travelling. */
  followMe: boolean;
  /** Map colours: follow the app theme, or force one. */
  mapStyle: "auto" | "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = {
  replyLanguage: "",
  voiceLanguage: "",
  voiceGender: "female",
  autoSpeak: false,
  showTripCard: true,
  liveLocation: true,
  followMe: false,
  mapStyle: "auto",
};

const STORAGE_KEY = "danfo-settings";

interface SettingsValue {
  settings: Settings;
  /** True once the saved settings have been read (avoids a hydration flash). */
  ready: boolean;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // Merge, so settings added in a later version get their defaults.
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) });
    } catch {
      /* storage unavailable or corrupt — carry on with defaults */
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: Settings) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<SettingsValue>(
    () => ({
      settings,
      ready,
      update: (key, val) => persist({ ...settings, [key]: val }),
      reset: () => persist(DEFAULT_SETTINGS),
    }),
    [settings, ready, persist]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  // Outside the provider (e.g. a test render) fall back to defaults.
  return (
    ctx ?? {
      settings: DEFAULT_SETTINGS,
      ready: false,
      update: () => {},
      reset: () => {},
    }
  );
}
