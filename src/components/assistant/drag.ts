"use client";

import type { ContextChip, ContextType } from "@/lib/ai/assistant-types";

// Dragging a note, task or project onto the chat button (V2 feature 11 §6A, ADR 0015). Two ways in,
// so no existing drag breaks:
//   - Plain rows, cards and links use the browser's own drag and drop with one extra data type (set by
//     one listener in the launcher from their `data-ask-*` attributes, see `src/lib/ai/ask-attrs.ts`).
//     They are not drag sources for anything else, so they only gain this.
//   - Cards and rows that already drag with dnd-kit (Board cards, calendar chips, the notes tree)
//     tell a small bridge when a drag starts and where it ends. If it ends over the button, the drop
//     is taken as "ask about this" and the move is cancelled.
// The payload is only `{ type, id, title }`; the server re-checks every id.

export const ASK_MIME = "application/x-dayboard-ask-item";

export type AskDragItem = ContextChip;

const TYPES: readonly ContextType[] = ["note", "task", "project"];

/** Reads a drop. Null when the drop is not one of ours or is malformed. */
export function readAskDrop(data: DataTransfer | null): AskDragItem | null {
  if (!data) return null;
  let raw = "";
  try {
    raw = data.getData(ASK_MIME);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AskDragItem>;
    if (
      typeof value.id === "string" &&
      typeof value.title === "string" &&
      value.type &&
      TYPES.includes(value.type)
    ) {
      return { type: value.type, id: value.id, title: value.title };
    }
  } catch {
    // Not JSON.
  }
  return null;
}

/** True while the drag in progress carries our type (readable during dragover; the data is not). */
export function isAskDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(ASK_MIME);
}

// ---- The bridge for dnd-kit drags ---------------------------------------------------------------

type Zone = () => DOMRect | null;
let zone: Zone = () => null;
let active: AskDragItem | null = null;
const dropListeners = new Set<(item: AskDragItem) => void>();
const stateListeners = new Set<(item: AskDragItem | null, over: boolean) => void>();

/** The button registers where its drop zone is (a function, because it moves). */
export function registerDropZone(getRect: Zone) {
  zone = getRect;
  return () => {
    zone = () => null;
  };
}

export function onAskDrop(listener: (item: AskDragItem) => void) {
  dropListeners.add(listener);
  return () => {
    dropListeners.delete(listener);
  };
}

export function onBridgeState(listener: (item: AskDragItem | null, over: boolean) => void) {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

const inside = (rect: DOMRect | null, x: number, y: number) =>
  rect !== null && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

// The real pointer position, not "where it started plus how far it moved": that second figure is
// thrown off when a drag makes the board scroll sideways near an edge.
let pointer = { x: 0, y: 0 };
function track(event: PointerEvent | TouchEvent) {
  const point = "touches" in event ? event.touches[0] : event;
  if (!point) return;
  pointer = { x: point.clientX, y: point.clientY };
  stateListeners.forEach((l) => l(active, inside(zone(), pointer.x, pointer.y)));
}
function stopTracking() {
  window.removeEventListener("pointermove", track, true);
  window.removeEventListener("touchmove", track, true);
}

/** A dnd-kit drag of an item that can be asked about started. */
export function bridgeStart(item: AskDragItem) {
  active = item;
  window.addEventListener("pointermove", track, true);
  window.addEventListener("touchmove", track, true);
  stateListeners.forEach((l) => l(item, false));
}

/**
 * The drag ended. Returns true when the pointer is over the button: the item is handed over and the
 * caller must skip its own drop handling (nothing moves).
 */
export function bridgeEnd(): boolean {
  const item = active;
  active = null;
  stopTracking();
  const over = inside(zone(), pointer.x, pointer.y);
  stateListeners.forEach((l) => l(null, false));
  if (!item || !over) return false;
  dropListeners.forEach((l) => l(item));
  return true;
}

/** The drag was cancelled (Esc). */
export function bridgeCancel() {
  active = null;
  stopTracking();
  stateListeners.forEach((l) => l(null, false));
}
