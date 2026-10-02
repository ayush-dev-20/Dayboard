"use client";

import { useRef } from "react";
import {
  clampWidth,
  resetSheetWidth,
  setSheetWidth,
  SHEET_MIN_WIDTH,
  SHEET_MAX_WIDTH,
} from "./sheet-state";

const STEP = 16;
const BIG_STEP = 48;

/**
 * The drag edge on the panel's left side. Drag with a mouse or finger, or focus it and use the
 * Left and Right arrow keys (Shift for bigger steps); double-click or Home restores the default.
 */
export function SheetResizeHandle({ width }: { width: number }) {
  const dragging = useRef(false);
  // A plain click (or the two clicks of a double-click) must not nudge the width.
  const startX = useRef(0);
  const moved = useRef(false);

  function fromPointer(clientX: number, persist: boolean) {
    setSheetWidth(window.innerWidth - clientX, persist);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize task panel"
      aria-valuemin={SHEET_MIN_WIDTH}
      aria-valuemax={SHEET_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        dragging.current = true;
        moved.current = false;
        startX.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        if (!moved.current && Math.abs(event.clientX - startX.current) < 3) return;
        moved.current = true;
        fromPointer(event.clientX, false);
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (moved.current) fromPointer(event.clientX, true);
      }}
      onDoubleClick={resetSheetWidth}
      onKeyDown={(event) => {
        const step = event.shiftKey ? BIG_STEP : STEP;
        // The panel grows toward the left, so Left makes it wider.
        if (event.key === "ArrowLeft") setSheetWidth(clampWidth(width + step, window.innerWidth));
        else if (event.key === "ArrowRight")
          setSheetWidth(clampWidth(width - step, window.innerWidth));
        else if (event.key === "Home") resetSheetWidth();
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
      className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors duration-[120ms] group-hover:bg-primary group-focus-visible:bg-primary group-active:bg-primary" />
    </div>
  );
}
