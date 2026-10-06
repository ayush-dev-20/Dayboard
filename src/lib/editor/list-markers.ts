import { LIST_MAX_DEPTH } from "./limits";

// The marker a list item shows, by depth and position (V2 feature 01 §6). It is chosen when the
// list is shown, never stored, so indenting, outdenting and pasting always give the right marker.
// The editor's CSS uses `list-style-type` for the same cycle; this function returns the same
// marker as text, for the plain-text and Markdown output of copy (feature 02).

export type ListStyle = "ordered" | "bullet";

/** Depth 1 is the outermost list. The pattern repeats every three levels. */
export function levelOf(depth: number): 1 | 2 | 3 {
  const clamped = Math.max(1, Math.min(depth, LIST_MAX_DEPTH));
  return (((clamped - 1) % 3) + 1) as 1 | 2 | 3;
}

/** 1 → a, 26 → z, 27 → aa, 28 → ab, 52 → az, 53 → ba. */
export function alphaLabel(n: number): string {
  let value = Math.max(1, Math.floor(n));
  let out = "";
  while (value > 0) {
    value -= 1;
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

/** 1 → i, 4 → iv, 39 → xxxix. Beyond 3,999 the number is shown as digits. */
export function romanLabel(n: number): string {
  let value = Math.max(1, Math.floor(n));
  if (value >= 4000) return String(value);
  let out = "";
  for (const [size, glyph] of ROMAN) {
    while (value >= size) {
      out += glyph;
      value -= size;
    }
  }
  return out;
}

const BULLETS = ["•", "◦", "▪"] as const;

/** The marker for the item at `ordinal` (1-based) of a list at `depth` (1-based). */
export function markerFor(style: ListStyle, depth: number, ordinal: number): string {
  const level = levelOf(depth);
  if (style === "bullet") return BULLETS[level - 1]!;
  if (level === 1) return `${Math.max(1, Math.floor(ordinal))}.`;
  return `${level === 2 ? alphaLabel(ordinal) : romanLabel(ordinal)}.`;
}
