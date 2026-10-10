"use client";

import { useSyncExternalStore } from "react";
import type { ContextChip, Proposal } from "@/lib/ai/assistant-types";
import type { AskSource } from "@/lib/ai/types";

// The assistant's conversations (V2 feature 11 §3): kept in this browser, per person, and nowhere
// else, so Dayboard's servers store no questions or answers. A thread does not follow the person to
// another device; signing out clears them. (The spec keeps them in Dexie. Dexie arrives with the
// offline features, so until then they live in `localStorage` behind this same small interface; see
// ADR 0016.) Every read and write is wrapped: storage can be blocked or full, and the assistant then
// still works for the visit.

export type StoredProposal = {
  proposal: Proposal;
  status: "pending" | "applied" | "dismissed";
  applied?: number;
  failed?: number;
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  sources?: AskSource[];
  quotes?: string[];
  /** The tools used for this answer, in order (shows "Searched your workspace"). */
  tools?: string[];
  proposals?: StoredProposal[];
  /** An answer that failed or was stopped part-way: kept so the person sees what arrived. */
  failure?: { code: string; message: string; retryAfterSeconds?: number };
  stopped?: boolean;
};

export type Thread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** The items the person pointed the assistant at; they scope every turn of the thread. */
  chips: ContextChip[];
  messages: StoredMessage[];
};

export const MAX_THREADS = 30;
export const MAX_STORED_MESSAGES = 100;
const PREFIX = "dayboard:assistant:v1:";
const TITLE_MAX = 60;

type State = { userId: string | null; threads: Thread[]; currentId: string | null };

let state: State = { userId: null, threads: [], currentId: null };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const keyFor = (userId: string) => `${PREFIX}${userId}`;

function read(userId: string): Pick<State, "threads" | "currentId"> {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return { threads: [], currentId: null };
    const parsed = JSON.parse(raw) as { threads?: Thread[]; currentId?: string | null };
    const threads = Array.isArray(parsed.threads)
      ? parsed.threads.filter((t) => t && typeof t.id === "string" && Array.isArray(t.messages))
      : [];
    return { threads, currentId: parsed.currentId ?? null };
  } catch {
    return { threads: [], currentId: null };
  }
}

function persist() {
  if (!state.userId) return;
  const write = () =>
    window.localStorage.setItem(
      keyFor(state.userId!),
      JSON.stringify({ threads: state.threads, currentId: state.currentId }),
    );
  try {
    write();
  } catch {
    // Full or blocked: drop the oldest thread and try once more, then carry on in memory.
    try {
      state = { ...state, threads: state.threads.slice(0, Math.max(1, state.threads.length - 1)) };
      write();
    } catch {
      // The conversation still works for this visit.
    }
  }
}

function commit(next: State) {
  state = next;
  persist();
  notify();
}

/** Loads this person's threads. Safe to call again; another person's threads are never shown. */
export function initThreads(userId: string) {
  if (state.userId === userId) return;
  state = { userId, ...read(userId) };
  notify();
}

/** Called when another tab of the same browser changed the stored threads. */
function reloadFromStorage() {
  if (!state.userId) return;
  state = { ...state, ...read(state.userId) };
  notify();
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key && event.key === (state.userId ? keyFor(state.userId) : null))
      reloadFromStorage();
  });
}

const newId = () => crypto.randomUUID();

export function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TITLE_MAX
    ? `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…`
    : flat || "New chat";
}

function pruned(threads: Thread[]): Thread[] {
  return [...threads]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS)
    .map((t) =>
      t.messages.length > MAX_STORED_MESSAGES
        ? { ...t, messages: t.messages.slice(-MAX_STORED_MESSAGES) }
        : t,
    );
}

export function createThread(
  options: {
    chips?: ContextChip[];
    messages?: StoredMessage[];
    title?: string;
  } = {},
): string {
  const now = Date.now();
  const thread: Thread = {
    id: newId(),
    title: options.title ?? "New chat",
    createdAt: now,
    updatedAt: now,
    chips: options.chips ?? [],
    messages: options.messages ?? [],
  };
  commit({ ...state, threads: pruned([thread, ...state.threads]), currentId: thread.id });
  return thread.id;
}

export function updateThread(id: string, mutate: (thread: Thread) => Thread) {
  const threads = state.threads.map((t) =>
    t.id === id ? { ...mutate(t), updatedAt: Date.now() } : t,
  );
  commit({ ...state, threads: pruned(threads) });
}

/** Changes a thread without moving it to the top of the list (a proposal ticked, a chip removed). */
export function patchThread(id: string, mutate: (thread: Thread) => Thread) {
  commit({ ...state, threads: state.threads.map((t) => (t.id === id ? mutate(t) : t)) });
}

export function renameThread(id: string, title: string) {
  const clean = titleFrom(title);
  patchThread(id, (t) => ({ ...t, title: clean }));
}

export function deleteThread(id: string) {
  const threads = state.threads.filter((t) => t.id !== id);
  commit({
    ...state,
    threads,
    currentId: state.currentId === id ? (threads[0]?.id ?? null) : state.currentId,
  });
}

export function clearAllThreads() {
  commit({ ...state, threads: [], currentId: null });
}

export function setCurrentThread(id: string | null) {
  if (state.currentId === id) return;
  commit({ ...state, currentId: id });
}

/** Removes every stored conversation of every person on this browser (sign-out, "Clear"). */
export function wipeAllAssistantData() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Nothing to clear when storage is blocked.
  }
  state = { userId: state.userId, threads: [], currentId: null };
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const EMPTY: Thread[] = [];
let cachedSorted: { source: Thread[]; sorted: Thread[] } = { source: EMPTY, sorted: EMPTY };

/** Threads, newest activity first. The same array until something changes. */
export function useThreads(): Thread[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (cachedSorted.source !== state.threads) {
        cachedSorted = {
          source: state.threads,
          sorted: [...state.threads].sort((a, b) => b.updatedAt - a.updatedAt),
        };
      }
      return cachedSorted.sorted;
    },
    () => EMPTY,
  );
}

export function useThread(id: string | null): Thread | null {
  return useSyncExternalStore(
    subscribe,
    () => (id ? (state.threads.find((t) => t.id === id) ?? null) : null),
    () => null,
  );
}

export function useCurrentThreadId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => state.currentId,
    () => null,
  );
}

/** The id of the current thread, without subscribing (for event handlers). */
export const currentIdSnapshot = (): string | null => state.currentId;

export function getThreadSnapshot(id: string): Thread | null {
  return state.threads.find((t) => t.id === id) ?? null;
}
