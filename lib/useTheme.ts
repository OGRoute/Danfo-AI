"use client";

import { useCallback, useEffect, useState } from "react";

/** What the user picked. "system" follows the OS light/dark setting live. */
export type ThemePref = "light" | "dark" | "system";
/** What is actually painted. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "danfo-theme";
const PREF_ATTR = "data-theme-pref";

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readPref(): ThemePref {
  if (typeof document === "undefined") return "system";
  const p = document.documentElement.getAttribute(PREF_ATTR);
  return p === "light" || p === "dark" ? p : "system";
}

function readResolved(): ResolvedTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  root.setAttribute(PREF_ATTR, pref);
  root.setAttribute("data-theme", pref === "system" ? systemTheme() : pref);
}

/**
 * Theme state shared by every component that calls it. The first paint is
 * handled by the inline script in layout.tsx; this hook keeps React in sync by
 * observing the <html> attributes, so all instances (header toggle, gate
 * toggle, map tiles) agree without a context provider.
 */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPrefState(readPref());
    setResolved(readResolved());
    setMounted(true);

    const observer = new MutationObserver(() => {
      setPrefState(readPref());
      setResolved(readResolved());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", PREF_ATTR],
    });

    // Follow OS changes live while the preference is "system".
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (readPref() === "system") apply("system");
    };
    mq.addEventListener("change", onSystemChange);

    return () => {
      observer.disconnect();
      mq.removeEventListener("change", onSystemChange);
    };
  }, []);

  const setPref = useCallback((next: ThemePref) => {
    apply(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  }, []);

  return { pref, resolved, mounted, setPref };
}
