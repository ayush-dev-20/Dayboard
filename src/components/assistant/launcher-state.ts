"use client";

import { useEffect, useSyncExternalStore } from "react";

// Small shared state for the floating chat button (V2 feature 11 §6A): whether its panel is open,
// whether an item is being dragged toward it, and how much room other fixed things on the page take
// (the task side panel, a bottom bar), so the button never sits on top of them.

type State = {
  open: boolean;
  /** An item that can be asked about is being dragged right now. */
  dragging: boolean;
  /** The drag is over the drop zone. */
  over: boolean;
  /** The docked task panel is open (feature 02 sheet): the button stays to its left. */
  taskPanelOpen: boolean;
  /** Pixels of bar fixed or stuck to the bottom of the page. */
  bottomBars: number;
};

let state: State = {
  open: false,
  dragging: false,
  over: false,
  taskPanelOpen: false,
  bottomBars: 0,
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function set(patch: Partial<State>) {
  const next = { ...state, ...patch };
  if ((Object.keys(patch) as (keyof State)[]).every((k) => state[k] === next[k])) return;
  state = next;
  listeners.forEach((l) => l());
}

export const useLauncherState = (): State =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );

export const setLauncherOpen = (open: boolean) => set({ open });
export const toggleLauncher = () => set({ open: !state.open });
export const setAskDragging = (dragging: boolean) =>
  set({ dragging, ...(dragging ? {} : { over: false }) });
export const setAskOver = (over: boolean) => set({ over });
export const isLauncherOpen = () => state.open;

/** The task panel registers itself while it is on screen (it is docked at the right edge). */
export function useTaskPanelPresence(active: boolean) {
  useEffect(() => {
    if (!active) return;
    set({ taskPanelOpen: true });
    return () => set({ taskPanelOpen: false });
  }, [active]);
}

/** A bar fixed or stuck to the bottom of the page announces its height while it is shown. */
export function useBottomBar(active: boolean, height: number) {
  useEffect(() => {
    if (!active) return;
    set({ bottomBars: state.bottomBars + height });
    return () => set({ bottomBars: Math.max(0, state.bottomBars - height) });
  }, [active, height]);
}
