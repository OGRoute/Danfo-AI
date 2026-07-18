"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type NotifKind = "info" | "success" | "warn";

export interface AppNotification {
  id: string;
  title: string;
  body?: string;
  kind: NotifKind;
  ts: number;
  read: boolean;
}

/**
 * Lightweight notification store, persisted per identity so a logged-in wallet
 * keeps its notifications across sessions while anonymous users get an
 * ephemeral (in-memory) feed. Backs the header bell icon + panel.
 *
 * `identityKey` is the wallet address (logged in) or null (anonymous).
 */
export function useNotifications(identityKey: string | null) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const storageKey = identityKey ? `danfo-notifs-${identityKey}` : null;
  // Avoid persisting the initial empty state back over a freshly loaded feed.
  const hydrated = useRef(false);

  // Load (or reset) when the identity changes.
  useEffect(() => {
    hydrated.current = false;
    if (!storageKey) {
      setItems([]);
      hydrated.current = true;
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      setItems(raw ? (JSON.parse(raw) as AppNotification[]) : []);
    } catch {
      setItems([]);
    }
    hydrated.current = true;
  }, [storageKey]);

  // Persist on change (logged-in identities only).
  useEffect(() => {
    if (!hydrated.current || !storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(items.slice(0, 50)));
    } catch {
      /* non-fatal */
    }
  }, [items, storageKey]);

  const notify = useCallback(
    (title: string, kind: NotifKind = "info", body?: string) => {
      setItems((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title,
          body,
          kind,
          ts: Date.now(),
          read: false,
        },
        ...prev,
      ]);
    },
    []
  );

  const markAllRead = useCallback(
    () => setItems((prev) => prev.map((n) => ({ ...n, read: true }))),
    []
  );

  const clearAll = useCallback(() => setItems([]), []);

  const unreadCount = items.reduce((n, i) => (i.read ? n : n + 1), 0);

  return { items, unreadCount, notify, markAllRead, clearAll };
}
