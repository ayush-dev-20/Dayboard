"use client";

import type { Active, DragStartEvent } from "@dnd-kit/core";
import { useMemo } from "react";
import { bridgeCancel, bridgeEnd, bridgeStart, type AskDragItem } from "./drag";

/**
 * Lets a dnd-kit drag (Board cards, Calendar chips, the notes tree) also mean "ask the assistant
 * about this" when it ends over the floating chat button (V2 feature 11 §6A, ADR 0015). The view
 * keeps its own drag exactly as it was; it only calls these three functions:
 *
 *   onDragStart  -> `ask.start(event)`
 *   onDragEnd    -> `if (ask.end()) return;`   (true: dropped on the button, so move nothing)
 *   onDragCancel -> `ask.cancel()`
 *
 * `resolve` says which item the dragged thing is, or null when it cannot be asked about (a todo).
 */
export function useAskBridge(resolve: (active: Active) => AskDragItem | null) {
  return useMemo(
    () => ({
      start(event: DragStartEvent) {
        const item = resolve(event.active);
        if (item) bridgeStart(item);
      },
      end(): boolean {
        return bridgeEnd();
      },
      cancel() {
        bridgeCancel();
      },
    }),
    [resolve],
  );
}
