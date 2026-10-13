"use client";

import { useSyncExternalStore } from "react";

function subscribe(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/**
 * Whether the browser reports a connection (V2 feature 03 §5). Later features add a failed-request
 * signal; for now this is the browser's own online flag. Server-rendered as online, so nothing
 * flickers on first paint.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
