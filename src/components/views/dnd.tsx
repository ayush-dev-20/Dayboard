"use client";

import { useState } from "react";
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Announcements,
} from "@dnd-kit/core";

// The one place the drag-and-drop library is configured (ADR 0008). Every drag in views (the Board's
// cards, the Calendar's days) uses these sensors, this collision rule and these announcements, so a
// drag works the same everywhere: a mouse, a long press on a touch screen, or the keyboard (Space
// to lift, arrow keys to move, Space to drop, Escape to cancel), with each step announced.

/** What a draggable or droppable carries in its `data`, for announcements and for the drop rule. */
export type DragData =
  | {
      type: "card";
      id: string;
      label: string;
      columnKey: string;
      index: number;
      count: number;
      columnLabel: string;
    }
  | { type: "column"; key: string; label: string; count: number }
  | { type: "day"; date: string; label: string };

/** Mouse after a small move (so a click still opens the item), touch after a long press, keyboard on Space. */
export function useDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      // Enter opens an item, so only Space lifts it.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
      coordinateGetter: jumpToNeighbour,
    }),
  );
}

/** The thing under the pointer; for the keyboard (no pointer), the nearest one. */
export const dropCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

/**
 * Arrow keys jump to the nearest drop target in that direction (a card or a column) instead of
 * nudging by a few pixels, so a keyboard drag crosses columns and rows in single steps.
 */
const jumpToNeighbour: KeyboardCoordinateGetter = (event, { context }) => {
  const { active, droppableRects, droppableContainers, collisionRect } = context;
  const code = event.code;
  if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(code)) return undefined;
  event.preventDefault();
  if (!active || !collisionRect) return undefined;

  const mine = {
    x: collisionRect.left + collisionRect.width / 2,
    y: collisionRect.top + collisionRect.height / 2,
  };
  let best: { x: number; y: number; distance: number } | null = null;

  for (const container of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(container.id);
    const data = container.data.current as DragData | undefined;
    if (!rect || !data) continue;
    // A card is not a target for itself.
    if (data.type === "card" && data.id === active.id) continue;

    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - mine.x;
    const dy = y - mine.y;
    const ahead =
      code === "ArrowRight"
        ? dx > 8
        : code === "ArrowLeft"
          ? dx < -8
          : code === "ArrowDown"
            ? dy > 8
            : dy < -8;
    if (!ahead) continue;
    // Prefer targets in line with the direction of travel.
    const along = code === "ArrowRight" || code === "ArrowLeft" ? Math.abs(dx) : Math.abs(dy);
    const across = code === "ArrowRight" || code === "ArrowLeft" ? Math.abs(dy) : Math.abs(dx);
    // A column holds its cards, so a card in the column wins over the column itself when both are in line.
    const penalty = data.type === "column" ? 400 : 0;
    const distance = along + across * 2 + penalty;
    if (!best || distance < best.distance) best = { x, y, distance };
  }

  return best
    ? { x: best.x - collisionRect.width / 2, y: best.y - collisionRect.height / 2 }
    : undefined;
};

const where = (data: DragData | undefined): string => {
  if (!data) return "nowhere";
  if (data.type === "card")
    return `${data.columnLabel || "the list"}, position ${data.index + 1} of ${data.count}`;
  if (data.type === "column")
    return `${data.label || "the list"}, ${data.count === 0 ? "empty" : `${data.count} ${data.count === 1 ? "card" : "cards"}`}`;
  return data.label;
};

/** What a screen reader hears while dragging. */
export const announcements: Announcements = {
  onDragStart({ active }) {
    const data = active.data.current as DragData | undefined;
    const label = data && "label" in data ? data.label : "item";
    return `Picked up ${label}. Use the arrow keys to move it, Space to drop, Escape to cancel.`;
  },
  onDragOver({ active, over }) {
    const label = (active.data.current as { label?: string } | undefined)?.label ?? "item";
    return over
      ? `${label} is over ${where(over.data.current as DragData | undefined)}.`
      : `${label} is not over a place it can be dropped.`;
  },
  onDragEnd({ active, over }) {
    const label = (active.data.current as { label?: string } | undefined)?.label ?? "item";
    return over
      ? `Dropped ${label} on ${where(over.data.current as DragData | undefined)}.`
      : `${label} was not moved.`;
  },
  onDragCancel({ active }) {
    const label = (active.data.current as { label?: string } | undefined)?.label ?? "item";
    return `Moving ${label} was cancelled.`;
  },
};

export const screenReaderInstructions = {
  draggable:
    "To pick up this item, press Space. While dragging, use the arrow keys to move it, Space to drop it, and Escape to cancel. Or use its menu: Move to.",
};

export type { DragEndEvent, DragOverEvent, DragStartEvent };

/**
 * A polite live region for the result of a move ("Moved to In progress, position 2"). The library
 * announces the drag itself; this says what the drop did, which the library cannot know.
 */
export function useLiveMessage() {
  const [message, setMessage] = useState("");
  const region = (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
  return { say: setMessage, region };
}
