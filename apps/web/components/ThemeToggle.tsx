"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "danfo-theme";

function getInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const current = document.documentElement.getAttribute("data-theme");
  return current === "dark" ? "dark" : "light";
}

/**
 * Light/dark theme switch. The actual first-paint theme is set by the inline
 * script in layout.tsx; this component just keeps state in sync and lets the
 * user override it, persisting the choice to localStorage.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(getInitialTheme());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      // Avoid a hydration mismatch on the icon before we know the real theme.
      aria-label={mounted ? `Switch to ${isDark ? "light" : "dark"} mode` : "Toggle theme"}
      aria-pressed={mounted ? isDark : undefined}
      title={mounted ? `Switch to ${isDark ? "light" : "dark"} mode` : "Toggle theme"}
    >
      <span aria-hidden suppressHydrationWarning>
        {mounted ? (isDark ? "☀️" : "🌙") : "🌓"}
      </span>

      <style jsx>{`
        .theme-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border: 2px solid var(--header-border);
          border-radius: 999px;
          background: transparent;
          color: var(--header-text);
          font-size: 17px;
          line-height: 1;
          cursor: pointer;
          flex-shrink: 0;
          transition: transform 0.05s ease, background 0.15s ease;
        }
        .theme-toggle:hover {
          background: rgba(0, 0, 0, 0.08);
        }
        .theme-toggle:active {
          transform: scale(0.94);
        }
        .theme-toggle:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px var(--ring);
        }
      `}</style>
    </button>
  );
}
