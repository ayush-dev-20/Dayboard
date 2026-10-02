"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", onChange);
  viewport?.addEventListener("scroll", onChange);
  return () => {
    viewport?.removeEventListener("resize", onChange);
    viewport?.removeEventListener("scroll", onChange);
  };
}

function snapshot(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  // The part of the layout viewport the on-screen keyboard covers.
  return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
}

/** How many pixels of the bottom of the screen the on-screen keyboard covers (0 without one). */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
