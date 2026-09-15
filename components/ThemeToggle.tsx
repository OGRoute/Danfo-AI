"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme, type ThemePref } from "../lib/useTheme";

const OPTIONS: { value: ThemePref; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀️" },
  { value: "dark", label: "Dark", icon: "🌙" },
  { value: "system", label: "System", icon: "🖥️" },
];

/**
 * Three-way theme picker: Light, Dark, or System (follows the OS setting and
 * updates live when it changes). The first paint is set by the inline script
 * in layout.tsx; this component lets the user change and persist the choice.
 */
export default function ThemeToggle() {
  const { pref, mounted, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === pref) ?? OPTIONS[2];

  return (
    <div className="theme-root" ref={rootRef}>
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        // Avoid a hydration mismatch before we know the stored preference.
        aria-label={mounted ? `Theme: ${current.label}` : "Theme"}
        title={mounted ? `Theme: ${current.label}` : "Theme"}
      >
        <span aria-hidden suppressHydrationWarning>
          {mounted ? current.icon : "🌓"}
        </span>
      </button>

      {open && (
        <div className="theme-menu" role="menu" aria-label="Theme">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={pref === o.value}
              className={`theme-item ${pref === o.value ? "on" : ""}`}
              onClick={() => {
                setPref(o.value);
                setOpen(false);
              }}
            >
              <span aria-hidden>{o.icon}</span>
              <span className="lbl">{o.label}</span>
              {pref === o.value && <span className="check" aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}

      <style jsx>{`
        .theme-root {
          position: relative;
          flex-shrink: 0;
        }
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
          transition: transform 0.05s ease, background 0.15s ease;
        }
        .theme-toggle:hover {
          background: rgba(0, 0, 0, 0.08);
        }
        .theme-toggle:active {
          transform: scale(0.94);
        }
        .theme-toggle:focus-visible,
        .theme-item:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px var(--ring);
        }
        .theme-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 60;
          min-width: 150px;
          padding: 6px;
          background: var(--surface);
          border: 2px solid var(--border);
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        }
        .theme-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 9px 10px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: var(--text);
          font-size: 14px;
          font-weight: 600;
          text-align: left;
          cursor: pointer;
        }
        .theme-item:hover,
        .theme-item.on {
          background: var(--surface-hover);
        }
        .lbl {
          flex: 1;
        }
        .check {
          font-weight: 800;
        }
      `}</style>
    </div>
  );
}
