"use client";

import { useEffect, useRef, useState } from "react";
import type { AppNotification } from "../lib/useNotifications";

interface Props {
  items: AppNotification[];
  unreadCount: number;
  onOpen: () => void; // marks all read
  onClear: () => void;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const ICON: Record<AppNotification["kind"], string> = {
  info: "ℹ️",
  success: "✓",
  warn: "⚠️",
};

/** Header bell with unread badge and a dropdown notification panel. */
export default function NotificationBell({
  items,
  unreadCount,
  onOpen,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) onOpen();
  }

  return (
    <div className="bell-wrap" ref={ref}>
      <button
        type="button"
        className="bell"
        onClick={toggle}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span aria-hidden>🔔</span>
        {unreadCount > 0 && (
          <span className="badge" aria-hidden>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="panel" role="menu" aria-label="Notifications">
          <div className="panel-head">
            <strong>Notifications</strong>
            {items.length > 0 && (
              <button className="clear" onClick={onClear}>
                Clear
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="empty">No notifications yet.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id} className={n.read ? "" : "unread"}>
                  <span className={`ico ${n.kind}`} aria-hidden>
                    {ICON[n.kind]}
                  </span>
                  <span className="body">
                    <span className="title">{n.title}</span>
                    {n.body && <span className="sub">{n.body}</span>}
                    <span className="when">{timeAgo(n.ts)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <style jsx>{`
        .bell-wrap {
          position: relative;
          flex-shrink: 0;
        }
        .bell {
          position: relative;
          width: 38px;
          height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 2px solid var(--header-border);
          border-radius: 999px;
          background: transparent;
          color: var(--header-text);
          font-size: 16px;
          cursor: pointer;
        }
        .bell:hover {
          background: rgba(0, 0, 0, 0.08);
        }
        .bell:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px var(--ring);
        }
        .badge {
          position: absolute;
          top: -4px;
          right: -4px;
          min-width: 17px;
          height: 17px;
          padding: 0 4px;
          border-radius: 999px;
          background: var(--danger);
          color: #fff;
          font-size: 10px;
          font-weight: 800;
          line-height: 17px;
          text-align: center;
        }
        .panel {
          position: absolute;
          top: 46px;
          right: 0;
          width: 300px;
          max-width: 84vw;
          max-height: 60vh;
          overflow-y: auto;
          background: var(--surface);
          color: var(--text);
          border: 2px solid var(--border);
          border-radius: 14px;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
          z-index: 20;
        }
        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          font-size: 14px;
        }
        .clear {
          background: none;
          border: none;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }
        .empty {
          margin: 0;
          padding: 24px 14px;
          text-align: center;
          font-size: 13px;
          color: var(--text-muted);
        }
        ul {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        li {
          display: flex;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
        }
        li.unread {
          background: var(--surface-hover);
        }
        li:last-child {
          border-bottom: none;
        }
        .ico {
          flex-shrink: 0;
          font-size: 13px;
          font-weight: 800;
        }
        .ico.success {
          color: var(--verify-ok);
        }
        .ico.warn {
          color: var(--verify-warn);
        }
        .body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .title {
          font-size: 13px;
          font-weight: 600;
        }
        .sub {
          font-size: 12px;
          color: var(--text-muted);
        }
        .when {
          font-size: 11px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
