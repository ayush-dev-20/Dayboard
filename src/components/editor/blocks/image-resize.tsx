"use client";

import { useEffect, useRef, useState } from "react";
import {
  clampWidth,
  dragWidth,
  keyboardWidth,
  maxWidthFor,
  minWidthFor,
} from "@/lib/editor/image-size";
import { cn } from "@/lib/utils";

// The box around a picture that can be resized by its edge handles (V2 feature 09 §6, "Resizing"):
// a thin bar on each side, a drag that follows the pointer, one saved change when the pointer is
// released, and the same thing from the keyboard on the right-hand handle. The sizes and limits are
// in `src/lib/editor/image-size.ts`.

type Props = {
  /** The stored width in pixels, or null for the picture's own size (at most the column). */
  width: number | null;
  /** Width divided by height of the picture. */
  aspect: number;
  /** The picture's own width, when known, to say what an unsized picture is showing. */
  naturalWidth: number | null;
  editable: boolean;
  /** The block is selected in the editor: the handles stay visible. */
  selected: boolean;
  /** A new width in pixels, or null to go back to the picture's own size. */
  onResize: (width: number | null) => void;
  children: React.ReactNode;
};

type Side = "left" | "right";

export function ResizableFrame({
  width,
  aspect,
  naturalWidth,
  editable,
  selected,
  onResize,
  children,
}: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [column, setColumn] = useState(0);
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ side: Side; startX: number; startWidth: number } | null>(null);
  const dragging = live !== null;

  // The column is the block's own parent: the picture is never wider than it.
  useEffect(() => {
    const parent = frame.current?.parentElement;
    if (!parent) return;
    const read = () => setColumn(parent.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  // Esc during a drag puts the old size back.
  useEffect(() => {
    if (!dragging) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      drag.current = null;
      setLive(null);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [dragging]);

  const shown = live ?? width;
  // What the picture is showing now, for the slider's value.
  const current = Math.round(
    shown !== null
      ? Math.min(shown, column > 0 ? column : shown)
      : Math.min(naturalWidth ?? column, column > 0 ? column : (naturalWidth ?? 0)),
  );

  function start(side: Side) {
    return (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      // Keeps the editor from selecting text or starting a drag of the whole block.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const startWidth = frame.current?.getBoundingClientRect().width ?? current;
      drag.current = { side, startX: event.clientX, startWidth };
      setLive(Math.round(startWidth));
    };
  }

  function move(event: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    setLive(dragWidth(d.startWidth, event.clientX - d.startX, d.side, aspect, column));
  }

  function end(event: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const final = dragWidth(d.startWidth, event.clientX - d.startX, d.side, aspect, column);
    setLive(null);
    // One change per drag, so one undo takes it back; nothing is saved when it did not move.
    if (final !== Math.round(d.startWidth)) onResize(final);
  }

  function cancel() {
    drag.current = null;
    setLive(null);
  }

  function key(event: React.KeyboardEvent<HTMLElement>) {
    const next = keyboardWidth(event.key, event.shiftKey, current, aspect, column);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onResize(next);
  }

  const min = minWidthFor(aspect, column);
  const max = Math.max(min, maxWidthFor(column));

  const handle = (side: Side) => (
    <div
      data-resize-handle={side}
      // The left bar is for the pointer only; the right one is the slider for the keyboard.
      {...(side === "right"
        ? {
            role: "slider",
            tabIndex: 0,
            "aria-label": "Resize picture",
            "aria-orientation": "horizontal" as const,
            "aria-valuemin": min,
            "aria-valuemax": max,
            "aria-valuenow": clampWidth(current, aspect, column),
            "aria-valuetext": `${current} pixels wide`,
            onKeyDown: key,
          }
        : { "aria-hidden": true })}
      draggable={false}
      onPointerDown={start(side)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
      onMouseDown={(event) => event.preventDefault()}
      onDoubleClick={() => onResize(null)}
      className={cn(
        "absolute inset-y-0 z-10 flex w-5 cursor-ew-resize touch-none items-center justify-center outline-none [@media(pointer:coarse)]:w-11",
        side === "left" ? "left-0" : "right-0",
        "opacity-0 transition-opacity duration-[120ms] group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100",
        (selected || dragging) && "opacity-100",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none h-12 max-h-1/2 w-1.5 rounded-full bg-foreground/70 ring-2 ring-background [[role=slider]:focus-visible>&]:ring-ring"
      />
    </div>
  );

  return (
    <div
      ref={frame}
      className="group image-frame relative mx-auto w-fit max-w-full"
      style={shown !== null ? { width: `${shown}px` } : undefined}
    >
      {children}
      {editable ? (
        <>
          {handle("left")}
          {handle("right")}
        </>
      ) : null}
    </div>
  );
}
