"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// Which parts of the notes tree are open, remembered on this device (V2 feature 07 §5): whether the
// tree under Notes is shown at all, and which notes' branches are expanded. It lives in
// localStorage, read through `useSyncExternalStore` so the server render (everything closed) and
// the first client render agree.

const KEY = "dayboard:notes-tree";

type Stored = { shown: boolean; open: string[] };
const EMPTY: Stored = { shown: false, open: [] };

const listeners = new Set<() => void>();

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function parse(raw: string): Stored {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw) as Partial<Stored>;
    return {
      shown: value.shown === true,
      open: Array.isArray(value.open) ? value.open.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return EMPTY;
  }
}

function write(next: Stored) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or storage off: the tree still works, it just does not remember.
  }
  for (const listener of listeners) listener();
}

export function useOpenBranches() {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  const state = useMemo(() => parse(raw), [raw]);
  const open = useMemo(() => new Set(state.open), [state.open]);

  const setShown = useCallback((shown: boolean) => {
    write({ ...parse(read()), shown });
  }, []);

  const setOpen = useCallback((id: string, isOpen: boolean) => {
    const current = parse(read());
    const next = new Set(current.open);
    if (isOpen) next.add(id);
    else next.delete(id);
    write({ ...current, open: [...next] });
  }, []);

  /** Opens every branch in `ids` (the ancestors of the open note). */
  const expand = useCallback((ids: readonly string[]) => {
    const current = parse(read());
    const missing = ids.filter((id) => !current.open.includes(id));
    if (missing.length === 0) return;
    write({ ...current, open: [...current.open, ...missing] });
  }, []);

  return { shown: state.shown, open, setShown, setOpen, expand };
}
