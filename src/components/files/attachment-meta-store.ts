import { useEffect, useSyncExternalStore } from "react";
import type { AttachmentDTO } from "@/lib/storage/dto";
import { fetchFileMeta } from "./api";

// What image and file blocks know about the files they point at (V2 feature 09 §6): name, size, type
// and dimensions, or that the file is gone. Asks are batched into one request; a file that comes
// back absent is "missing" (deleted, never finished, or not the person's), which a block shows as
// "File removed" and never as a broken image.

export type AttachmentState =
  { state: "loading" } | { state: "ready"; file: AttachmentDTO } | { state: "missing" };

const cache = new Map<string, AttachmentState>();
const listeners = new Set<() => void>();
const wanted = new Set<string>();
let scheduled = false;

const notify = () => {
  for (const listener of listeners) listener();
};

async function flush() {
  scheduled = false;
  const ids = [...wanted];
  wanted.clear();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const result = await fetchFileMeta(chunk);
    if (!result.ok) {
      // Offline or a server problem: ask again next time, and show nothing wrong meanwhile.
      for (const id of chunk) cache.delete(id);
      continue;
    }
    const found = new Map(result.data.files.map((f) => [f.id, f]));
    for (const id of chunk) {
      const file = found.get(id);
      cache.set(id, file ? { state: "ready", file } : { state: "missing" });
    }
  }
  notify();
}

function request(id: string) {
  if (cache.has(id)) return;
  cache.set(id, { state: "loading" });
  wanted.add(id);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => void flush());
}

/** Fills the store with files already known (a finished upload, the Attachments list). */
export function primeAttachments(files: readonly AttachmentDTO[]) {
  for (const file of files) cache.set(file.id, { state: "ready", file });
  notify();
}

/** A file was deleted here: every block that shows it says so at once. */
export function markAttachmentRemoved(id: string) {
  cache.set(id, { state: "missing" });
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const LOADING: AttachmentState = { state: "loading" };

export function useAttachment(id: string): AttachmentState {
  const value = useSyncExternalStore(
    subscribe,
    () => cache.get(id),
    () => undefined,
  );
  useEffect(() => {
    request(id);
  }, [id]);
  return value ?? LOADING;
}

/** The name of a file the page already knows (for copying a block out). */
export const peekAttachment = (id: string): AttachmentDTO | null => {
  const entry = cache.get(id);
  return entry?.state === "ready" ? entry.file : null;
};
