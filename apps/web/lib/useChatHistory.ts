"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Msg {
  role: "user" | "assistant";
  content: string;
  verified?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Msg[];
  updatedAt: number;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function titleFrom(messages: Msg[]): string {
  const first = messages.find((m) => m.role === "user")?.content?.trim();
  if (!first) return "New chat";
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}

/**
 * Conversation history keyed by identity.
 *
 *  - Logged-in wallet  → persisted in localStorage (survives reloads).
 *  - Anonymous (null)  → kept in memory only for the current session.
 *
 * Structured behind this hook so the store can later move to 0G Storage or a
 * database without touching the UI.
 */
export function useChatHistory(identityKey: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const storageKey = identityKey ? `danfo-history-${identityKey}` : null;
  const hydrated = useRef(false);

  // Load history when identity changes.
  useEffect(() => {
    hydrated.current = false;
    let loaded: Conversation[] = [];
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey);
        loaded = raw ? (JSON.parse(raw) as Conversation[]) : [];
      } catch {
        loaded = [];
      }
    }
    setConversations(loaded);
    setCurrentId(loaded[0]?.id ?? null);
    hydrated.current = true;
  }, [storageKey]);

  // Persist (logged-in only).
  useEffect(() => {
    if (!hydrated.current || !storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(conversations.slice(0, 50)));
    } catch {
      /* non-fatal */
    }
  }, [conversations, storageKey]);

  const current = conversations.find((c) => c.id === currentId) ?? null;

  const newChat = useCallback(() => {
    setCurrentId(null);
  }, []);

  const selectChat = useCallback((id: string) => {
    setCurrentId(id);
  }, []);

  const deleteChat = useCallback(
    (id: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setCurrentId((cur) => (cur === id ? null : cur));
    },
    []
  );

  /** Write the current message list into history, creating a conversation if needed. */
  const saveMessages = useCallback(
    (messages: Msg[]) => {
      if (messages.length === 0) return;
      setConversations((prev) => {
        const id = currentId ?? newId();
        if (!currentId) setCurrentId(id);
        const existing = prev.find((c) => c.id === id);
        const updated: Conversation = {
          id,
          title: existing?.title && existing.title !== "New chat"
            ? existing.title
            : titleFrom(messages),
          messages,
          updatedAt: Date.now(),
        };
        const rest = prev.filter((c) => c.id !== id);
        return [updated, ...rest];
      });
    },
    [currentId]
  );

  return {
    conversations,
    current,
    currentId,
    newChat,
    selectChat,
    deleteChat,
    saveMessages,
  };
}
