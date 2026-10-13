"use client";

import { useOnlineStatus } from "@/lib/pwa/use-online-status";

/**
 * A quiet "Offline" label in the top bar (V2 feature 03 §5). Nothing shows while online. The text is
 * the signal, not the dot, so colour is never the only cue.
 */
export function OfflineIndicator() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <span
      role="status"
      className="hidden items-center gap-1.5 px-2 type-body-sm text-muted-foreground sm:inline-flex"
    >
      <span aria-hidden className="size-2 rounded-full bg-muted-foreground" />
      Offline
    </span>
  );
}
