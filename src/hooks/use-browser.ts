"use client";

import { useSyncExternalStore } from "react";
import { modernTimeZoneName } from "@/lib/dates/timezones";

const noopSubscribe = () => () => {};

/** False while rendering on the server and during hydration, true afterwards. Needs no effect. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** The browser's IANA time zone, or `fallback` on the server so markup matches during hydration. */
export function useBrowserTimeZone(fallback = "UTC"): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => modernTimeZoneName(Intl.DateTimeFormat().resolvedOptions().timeZone) || fallback,
    () => fallback,
  );
}
