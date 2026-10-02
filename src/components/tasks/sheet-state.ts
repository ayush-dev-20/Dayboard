"use client";

import { useSyncExternalStore } from "react";

// How the docked task panel looks right now. Kept in a tiny store of its own (not in the URL) so the
// panel and the list beside it, which are separate components, always agree. The width is
// remembered in this browser; the mode (docked, expanded, minimized) lasts for the visit.

export const SHEET_DEFAULT_WIDTH = 480;
export const SHEET_MIN_WIDTH = 360;
/** The list beside the panel is never squeezed below this (on top of the 240px sidebar). */
export const SHEET_LIST_MIN = 420;
export const SHEET_SIDEBAR = 240;
/** The page's own side padding (32px each side) that the list sits inside. */
export const SHEET_PAGE_PAD = 64;
export const SHEET_MAX_WIDTH = 960;

export type SheetMode = "docked" | "expanded" | "minimized";

const KEY = "dayboard:task-sheet-width";
const listeners = new Set<() => void>();
let width = SHEET_DEFAULT_WIDTH;
let mode: SheetMode = "docked";
let loaded = false;

const notify = () => listeners.forEach((l) => l());

export function clampWidth(value: number, viewport: number = Infinity): number {
  const max = Math.max(
    SHEET_MIN_WIDTH,
    Math.min(SHEET_MAX_WIDTH, viewport - SHEET_SIDEBAR - SHEET_PAGE_PAD - SHEET_LIST_MIN),
  );
  return Math.round(Math.min(max, Math.max(SHEET_MIN_WIDTH, value)));
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = Number(window.localStorage.getItem(KEY));
    if (Number.isFinite(saved) && saved > 0) width = clampWidth(saved);
  } catch {
    // storage blocked: use the default
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSheetWidth(): number {
  return useSyncExternalStore(
    subscribe,
    () => {
      load();
      return width;
    },
    () => SHEET_DEFAULT_WIDTH,
  );
}

export function useSheetMode(): SheetMode {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => "docked",
  );
}

/** `persist: false` while dragging, so storage is written once at the end. */
export function setSheetWidth(next: number, persist = true): void {
  width = clampWidth(next, typeof window === "undefined" ? Infinity : window.innerWidth);
  if (persist) {
    try {
      window.localStorage.setItem(KEY, String(width));
    } catch {
      // ignore
    }
  }
  notify();
}

export function resetSheetWidth(): void {
  setSheetWidth(SHEET_DEFAULT_WIDTH);
}

export function setSheetMode(next: SheetMode): void {
  if (mode === next) return;
  mode = next;
  notify();
}
