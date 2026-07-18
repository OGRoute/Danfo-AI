"use client";

import type { Conversation } from "../lib/useChatHistory";

interface Props {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  currentId: string | null;
  canPersist: boolean;
  identityLabel: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSignOut: () => void;
}

/** Slide-in drawer listing saved conversations (logged-in accounts). */
export default function HistoryDrawer({
  open,
  onClose,
  conversations,
  currentId,
  canPersist,
  identityLabel,
  onSelect,
  onNew,
  onDelete,
  onSignOut,
}: Props) {
  return (
    <>
      <div
        className={`scrim ${open ? "show" : ""}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`drawer ${open ? "open" : ""}`}
        aria-label="Chat history"
        aria-hidden={!open}
      >
        <div className="head">
          <strong>Chat history</strong>
          <button className="x" onClick={onClose} aria-label="Close history">
            ✕
          </button>
        </div>

        <button className="new" onClick={onNew}>
          + New chat
        </button>

        {!canPersist && (
          <p className="note">
            You&apos;re anonymous — history isn&apos;t saved. Connect a wallet to
            keep your chats.
          </p>
        )}

        {conversations.length === 0 ? (
          <p className="empty">No saved conversations yet.</p>
        ) : (
          <ul>
            {conversations.map((c) => (
              <li key={c.id} className={c.id === currentId ? "active" : ""}>
                <button className="pick" onClick={() => onSelect(c.id)}>
                  <span className="title">{c.title}</span>
                  <span className="count">{c.messages.length} messages</span>
                </button>
                <button
                  className="del"
                  onClick={() => onDelete(c.id)}
                  aria-label={`Delete conversation: ${c.title}`}
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="acct">
          <span className="who" title={identityLabel}>
            <span className="dot" aria-hidden />
            {identityLabel}
          </span>
          <button className="signout" onClick={onSignOut}>
            {canPersist ? "Sign out" : "Exit"}
          </button>
        </div>

        <style jsx>{`
          .scrim {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.4);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
            z-index: 30;
          }
          .scrim.show {
            opacity: 1;
            pointer-events: auto;
          }
          .drawer {
            position: fixed;
            top: 0;
            left: 0;
            height: 100dvh;
            width: 300px;
            max-width: 86vw;
            background: var(--surface);
            color: var(--text);
            border-right: 3px solid var(--border);
            transform: translateX(-100%);
            transition: transform 0.22s ease;
            z-index: 31;
            display: flex;
            flex-direction: column;
            padding: 16px;
            overflow-y: auto;
          }
          .drawer.open {
            transform: translateX(0);
          }
          .head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 14px;
            font-size: 16px;
          }
          .x {
            background: none;
            border: none;
            font-size: 16px;
            cursor: pointer;
            color: var(--text-muted);
          }
          .new {
            width: 100%;
            padding: 11px;
            border: 2px solid var(--border);
            border-radius: 10px;
            background: var(--accent);
            color: var(--accent-text);
            font-weight: 700;
            cursor: pointer;
            margin-bottom: 12px;
          }
          .note,
          .empty {
            font-size: 12.5px;
            color: var(--text-muted);
            line-height: 1.5;
            margin: 4px 2px 12px;
          }
          ul {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          li {
            display: flex;
            align-items: stretch;
            gap: 4px;
            border: 2px solid var(--border);
            border-radius: 10px;
            overflow: hidden;
          }
          li.active {
            box-shadow: 0 0 0 2px var(--ring);
          }
          .pick {
            flex: 1;
            min-width: 0;
            text-align: left;
            background: transparent;
            border: none;
            padding: 10px 12px;
            cursor: pointer;
            color: var(--text);
            display: flex;
            flex-direction: column;
            gap: 3px;
          }
          .pick:hover {
            background: var(--surface-hover);
          }
          .title {
            font-size: 13.5px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .count {
            font-size: 11px;
            color: var(--text-muted);
          }
          .del {
            border: none;
            background: transparent;
            padding: 0 10px;
            cursor: pointer;
            font-size: 13px;
            color: var(--text-muted);
          }
          .del:hover {
            color: var(--danger);
          }
          .acct {
            margin-top: auto;
            padding-top: 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            border-top: 1px solid var(--border);
          }
          .who {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 12.5px;
            font-weight: 600;
            color: var(--text);
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--verify-ok);
            flex-shrink: 0;
          }
          .signout {
            flex-shrink: 0;
            border: 2px solid var(--border);
            background: transparent;
            color: var(--text);
            font-size: 12px;
            font-weight: 700;
            padding: 6px 10px;
            border-radius: 8px;
            cursor: pointer;
          }
          .signout:hover {
            background: var(--surface-hover);
          }
        `}</style>
      </aside>
    </>
  );
}
