"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  overlayEvents,
  overlaysVersion,
  prepareOverlays,
  subscribeOverlays,
  type OverlayEvent,
} from "./calendar-overlay";

/**
 * The overlay events for the visible range (V2 feature 12 §6). Asks the providers to load the range, and draws
 * again when they have it. With no provider registered, or nothing connected, it is an empty map.
 */
export function useCalendarOverlay(range: {
  from: string;
  to: string;
}): Map<string, OverlayEvent[]> {
  const version = useSyncExternalStore(subscribeOverlays, overlaysVersion, () => 0);
  useEffect(() => {
    prepareOverlays({ from: range.from, to: range.to });
  }, [range.from, range.to]);
  return useMemo(() => {
    // `version` changes when a provider has new events, so the answer is read again.
    void version;
    return overlayEvents({ from: range.from, to: range.to });
  }, [range.from, range.to, version]);
}
