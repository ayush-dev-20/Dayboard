import { useEffect, useSyncExternalStore } from "react";
import { getNoteMetas } from "@/actions/notes";
import type { NoteMeta } from "@/lib/notes/links";
import { onNoteEvent } from "./note-events";

// The title, emoji and state of the notes that links and sub-note blocks point at (V2 feature 07
// §4). A link holds only an id, so every pill and block asks this store what to show. Asks are
// batched into one request, answers are kept for a short while and fetched again when they are
// stale (or when notes moved, were trashed or restored), and a rename in this tab or another
// updates every pill at once.

const STALE_MS = 30_000;
const BATCH = 100;

type Entry = { meta: NoteMeta; at: number };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const wanted = new Set<string>();
let scheduled = false;
let wired = false;

function notify() {
  for (const listener of listeners) listener();
}

function put(meta: NoteMeta) {
  cache.set(meta.id, { meta, at: Date.now() });
}

async function flush() {
  scheduled = false;
  const ids = [...wanted];
  wanted.clear();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const result = await getNoteMetas({ ids: chunk }).catch(() => null);
    if (result?.ok) for (const meta of result.data) put(meta);
    else for (const id of chunk) cache.delete(id); // try again next time it is asked for
  }
  notify();
}

/** Asks for a note's details; many asks in the same moment become one request. */
export function requestNoteMeta(id: string): void {
  wanted.add(id);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => void flush());
}

/** Fills the store with details already known (the page that loaded them), so no request is needed. */
export function primeNoteMeta(metas: readonly NoteMeta[]): void {
  for (const meta of metas) put(meta);
  notify();
}

export function peekNoteMeta(id: string): NoteMeta | undefined {
  return cache.get(id)?.meta;
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  onNoteEvent((event) => {
    if (event.type === "title" || event.type === "emoji") {
      const entry = cache.get(event.id);
      if (!entry) return;
      const meta =
        event.type === "title"
          ? { ...entry.meta, title: event.title }
          : { ...entry.meta, emoji: event.emoji };
      cache.set(event.id, { meta, at: entry.at });
      notify();
    } else if (event.type === "structure") {
      // States may have changed (archived, trashed, restored): read everything shown again.
      for (const id of cache.keys()) wanted.add(id);
      if (wanted.size > 0 && !scheduled) {
        scheduled = true;
        queueMicrotask(() => void flush());
      }
    }
  });
}

function subscribe(listener: () => void) {
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What a link or block should show for this note, or undefined while it is being fetched. */
export function useNoteMeta(id: string): NoteMeta | undefined {
  const meta = useSyncExternalStore(
    subscribe,
    () => cache.get(id)?.meta,
    () => undefined,
  );
  useEffect(() => {
    const entry = cache.get(id);
    if (!entry || Date.now() - entry.at > STALE_MS) requestNoteMeta(id);
  }, [id]);
  return meta;
}

/** For tests. */
export function resetNoteMetaStore(): void {
  cache.clear();
  wanted.clear();
  scheduled = false;
}
