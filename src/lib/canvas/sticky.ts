import { COLOR_TOKENS, type ColorToken } from "@/lib/colors";
import type { SceneElement } from "./types";

// Sticky notes on a drawing (V3 feature 01 §13). A sticky note is a rectangle with a bound text label and
// `customData.dayboard.sticky = { id, tone }`, where `id` is the id of the task the note carries. This module is the
// pure half: how a note is built, how notes are read back off a scene, how its words map to a task's title and
// description, and the rules that keep ids unique. It is shared by the browser, the server and the tests.

export const STICKY_LIMITS = { perCanvas: 500, text: 600, title: 500 } as const;

/** A task needs a title, so a note with no words carries this one and shows as empty on the drawing. */
export const EMPTY_STICKY_TITLE = "Untitled sticky";

export const DEFAULT_STICKY_TONE: ColorToken = "amber";

/** Eight preset colours (the app's colour tokens), as soft fills. No custom colours (Miro has none either). */
export const STICKY_COLORS: Record<ColorToken, string> = {
  slate: "#dee2e6",
  red: "#ffc9c9",
  amber: "#ffec99",
  green: "#b2f2bb",
  teal: "#99e9f2",
  blue: "#a5d8ff",
  violet: "#d0bfff",
  pink: "#fcc2d7",
};

/** What a colour is called to a person who cannot see it (amber is the yellow note). */
export const STICKY_COLOR_NAMES: Record<ColorToken, string> = {
  slate: "Grey",
  red: "Red",
  amber: "Yellow",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  violet: "Violet",
  pink: "Pink",
};

export const STICKY_SHAPES = {
  square: { width: 200, height: 200 },
  wide: { width: 300, height: 180 },
} as const;
export type StickyShape = keyof typeof STICKY_SHAPES;

/** Helvetica (Excalidraw's system sans), like the AI diagrams: it is measured correctly before any font has loaded. */
export const STICKY_FONT = 2;
export const STICKY_FONT_SIZE = 20;
export const STICKY_INK = "#1e1e1e";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isStickyId = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
export const isStickyTone = (value: unknown): value is ColorToken =>
  typeof value === "string" && (COLOR_TOKENS as readonly string[]).includes(value);

// ---- Words ---------------------------------------------------------------------------------------------------------------

export class StickyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StickyError";
  }
}

const cleanText = (raw: string) =>
  raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();

/**
 * A note's words as a task holds them: the first line is the title (cut at 500, the tail kept in the description), the
 * rest the description. No words at all is the placeholder title. More than 600 characters is refused.
 */
export function splitStickyText(raw: string): { title: string; description: string | null } {
  const text = cleanText(raw);
  if (!text) return { title: EMPTY_STICKY_TITLE, description: null };
  if ([...text].length > STICKY_LIMITS.text) {
    throw new StickyError(`A sticky note can have ${STICKY_LIMITS.text} characters at most.`);
  }
  const newline = text.indexOf("\n");
  const first = (newline === -1 ? text : text.slice(0, newline)).trim();
  const rest = newline === -1 ? "" : text.slice(newline + 1).trim();
  const title = [...first].slice(0, STICKY_LIMITS.title).join("");
  // A first line cut at 500 keeps its tail, so nothing typed is lost.
  const overflow = [...first].slice(STICKY_LIMITS.title).join("");
  const description = [overflow, rest].filter(Boolean).join("\n");
  return { title, description: description || null };
}

/** The words on the note again, from the task's title and description (the placeholder title is no words). */
export function joinStickyText(title: string, description: string | null): string {
  if (title === EMPTY_STICKY_TITLE && !description) return "";
  return description ? `${title}\n${description}` : title;
}

// ---- Building a note ----------------------------------------------------------------------------------------------------

export type StickySkeleton = {
  type: "rectangle";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [field: string]: unknown;
};

/** The element skeleton of a new note; Excalidraw's `convertToExcalidrawElements` makes the real element (and its label). */
export function buildStickySkeleton(input: {
  /** The id of the task the note carries. */
  id: string;
  x: number;
  y: number;
  tone?: ColorToken;
  shape?: StickyShape;
  text?: string;
}): StickySkeleton {
  const tone = input.tone ?? DEFAULT_STICKY_TONE;
  const size = STICKY_SHAPES[input.shape ?? "square"];
  return {
    type: "rectangle",
    id: `sticky-${input.id}`,
    x: input.x,
    y: input.y,
    width: size.width,
    height: size.height,
    strokeColor: "transparent",
    backgroundColor: STICKY_COLORS[tone],
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    roundness: null,
    ...(input.text
      ? {
          label: {
            text: input.text,
            fontSize: STICKY_FONT_SIZE,
            fontFamily: STICKY_FONT,
            textAlign: "center",
            verticalAlign: "middle",
            strokeColor: STICKY_INK,
          },
        }
      : {}),
    customData: { dayboard: { sticky: { id: input.id, tone } } },
  };
}

// ---- Reading notes back --------------------------------------------------------------------------------------------------

export type StickyNote = {
  /** The task's id. */
  id: string;
  /** The canvas element that draws it. */
  elementId: string;
  tone: ColorToken;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const stickyData = (e: SceneElement) =>
  (e.customData as { dayboard?: { sticky?: { id?: unknown; tone?: unknown } } } | undefined)
    ?.dayboard?.sticky;

/** The sticky notes on a scene, in element order. Deleted elements and anything that is not a note are left out. */
export function readStickies(elements: readonly SceneElement[]): StickyNote[] {
  const labels = new Map<string, string>();
  for (const e of elements) {
    if (e.type === "text" && e.isDeleted !== true && typeof e.containerId === "string") {
      const words = typeof e.originalText === "string" ? e.originalText : e.text;
      labels.set(e.containerId, typeof words === "string" ? words : "");
    }
  }
  const out: StickyNote[] = [];
  for (const e of elements) {
    if (e.type !== "rectangle" || e.isDeleted === true) continue;
    const data = stickyData(e);
    if (!data || !isStickyId(data.id)) continue;
    out.push({
      id: data.id,
      elementId: e.id,
      tone: isStickyTone(data.tone) ? data.tone : DEFAULT_STICKY_TONE,
      text: labels.get(e.id) ?? "",
      x: Number(e.x) || 0,
      y: Number(e.y) || 0,
      width: Number(e.width) || 0,
      height: Number(e.height) || 0,
    });
  }
  return out;
}

/** Notes that share a task id: a duplicate or a paste. The first keeps the id; every later one is listed. */
export function duplicateStickies(notes: readonly StickyNote[]): StickyNote[] {
  const seen = new Set<string>();
  const out: StickyNote[] = [];
  for (const note of notes) {
    if (seen.has(note.id)) out.push(note);
    else seen.add(note.id);
  }
  return out;
}

/** The scene with these notes (by element id) pointing at new task ids. Pure: returns new elements, changes nothing in place. */
export function withStickyIds<T extends SceneElement>(
  elements: readonly T[],
  newIds: ReadonlyMap<string, string>,
): T[] {
  return elements.map((e) => {
    const next = newIds.get(e.id);
    if (!next) return e;
    const data = (e.customData as { dayboard?: Record<string, unknown> } | undefined)?.dayboard;
    return {
      ...e,
      customData: {
        ...(e.customData as Record<string, unknown> | undefined),
        dayboard: { ...data, sticky: { ...(stickyData(e) ?? {}), id: next } },
      },
    };
  });
}
