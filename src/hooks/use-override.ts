"use client";

import { useState } from "react";

/**
 * Holds a local value on top of one that comes from the server. The local value wins until the
 * server value changes (after a refresh), then the server value wins again. Lets a row show a
 * result immediately and keep showing it, with no effect needed to reset.
 */
export function useOverride<T>(serverValue: T): [T, (next: T | null) => void] {
  const [override, setOverride] = useState<T | null>(null);
  const [seen, setSeen] = useState(serverValue);

  if (!Object.is(seen, serverValue)) {
    // Adjusting state while rendering, from a prop change, is the supported pattern for this.
    setSeen(serverValue);
    setOverride(null);
  }
  return [override ?? serverValue, setOverride];
}
