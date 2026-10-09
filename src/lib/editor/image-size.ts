import { IMAGE_MIN_SIZE, IMAGE_WIDTH_MAX } from "./limits";

// The arithmetic of resizing a picture in a note (V2 feature 09 §6, "Resizing"). A picture keeps its
// proportions, is centred, never goes below the minimum in width or in height, and never goes above
// the width of its column. Pure: widths are whole pixels, `aspect` is width divided by height.

/** The narrowest the picture may be: 64 px wide, and wide enough to be 64 px tall. */
export function minWidthFor(aspect: number, column: number): number {
  const wanted = Math.max(IMAGE_MIN_SIZE, Math.ceil(IMAGE_MIN_SIZE * safeAspect(aspect)));
  // A column narrower than the minimum wins (a phone in a narrow window).
  return column > 0 ? Math.min(wanted, Math.floor(column)) : wanted;
}

/** The widest the picture may be: its column. */
export function maxWidthFor(column: number): number {
  return column > 0 ? Math.min(Math.floor(column), IMAGE_WIDTH_MAX) : IMAGE_WIDTH_MAX;
}

const safeAspect = (aspect: number) => (Number.isFinite(aspect) && aspect > 0 ? aspect : 1);

/** A width kept inside the limits, as a whole number. */
export function clampWidth(width: number, aspect: number, column: number): number {
  const min = minWidthFor(aspect, column);
  const max = Math.max(min, maxWidthFor(column));
  if (!Number.isFinite(width)) return max;
  return Math.min(max, Math.max(min, Math.round(width)));
}

/**
 * The width while an edge handle is dragged by `dx` pixels (to the right is positive). The picture
 * is centred, so an edge that follows the pointer moves the width by twice the distance: dragging
 * the right handle right, or the left handle left, makes it larger.
 */
export function dragWidth(
  startWidth: number,
  dx: number,
  side: "left" | "right",
  aspect: number,
  column: number,
): number {
  const grow = side === "right" ? dx : -dx;
  return clampWidth(startWidth + grow * 2, aspect, column);
}

/** Keyboard steps on the handle: 16 px, or 64 px with Shift. Null means the key is not a resize key. */
export function keyboardWidth(
  key: string,
  shift: boolean,
  current: number,
  aspect: number,
  column: number,
): number | null {
  const step = shift ? 64 : 16;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clampWidth(current + step, aspect, column);
    case "ArrowLeft":
    case "ArrowDown":
      return clampWidth(current - step, aspect, column);
    case "Home":
      return minWidthFor(aspect, column);
    case "End":
      return maxWidthFor(column);
    default:
      return null;
  }
}
