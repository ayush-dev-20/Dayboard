// Whether each toggle is open is remembered per person and device, not saved in the note, so
// opening a toggle never changes the document, autosaves or syncs (feature 01 §2). Moved into the
// local database in V2 feature 04. Storage can be blocked, so every access is wrapped.

const PREFIX = "toggle:";
const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, boolean>();

export const toggleKey = (ownerId: string | null, toggleId: string) =>
  `${PREFIX}${ownerId ?? "new"}:${toggleId}`;

/** A toggle with no stored choice is open. */
export function getToggleOpen(key: string): boolean {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const value = window.localStorage.getItem(key);
    if (value === "0") return false;
    if (value === "1") return true;
  } catch {
    // storage unavailable: fall through to the default
  }
  return true;
}

export function setToggleOpen(key: string, open: boolean): void {
  memory.set(key, open);
  try {
    window.localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // the in-memory copy still holds for this session
  }
  listeners.get(key)?.forEach((notify) => notify());
}

export function subscribeToggle(key: string, notify: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(notify);
  return () => {
    set.delete(notify);
  };
}
