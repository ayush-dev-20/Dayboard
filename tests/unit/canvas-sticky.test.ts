import { describe, expect, it } from "vitest";
import { buildOutline } from "@/lib/canvas/outline";
import { sanitizeScene } from "@/lib/canvas/schema";
import {
  buildStickySkeleton,
  DEFAULT_STICKY_TONE,
  duplicateStickies,
  EMPTY_STICKY_TITLE,
  joinStickyText,
  readStickies,
  splitStickyText,
  STICKY_COLORS,
  STICKY_LIMITS,
  STICKY_SHAPES,
  StickyError,
  withStickyIds,
} from "@/lib/canvas/sticky";
import { COLOR_TOKENS } from "@/lib/colors";
import type { SceneElement } from "@/lib/canvas/types";

const A = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const B = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

/** A note as Excalidraw would hold it: the rectangle and its bound text. */
function note(
  id: string,
  text: string,
  over: Record<string, unknown> = {},
  elementId = `box-${id}`,
) {
  const skeleton = buildStickySkeleton({ id, x: 10, y: 20, tone: "blue" });
  const box = { ...skeleton, id: elementId, ...over } as SceneElement;
  const elements: SceneElement[] = [box];
  if (text) {
    elements.push({
      id: `${elementId}-text`,
      type: "text",
      containerId: elementId,
      text,
      originalText: text,
      isDeleted: false,
    });
  }
  return elements;
}

describe("a new note", () => {
  it("is a coloured rectangle that names its task, in the chosen shape", () => {
    const square = buildStickySkeleton({ id: A, x: 5, y: 6 });
    expect(square).toMatchObject({
      type: "rectangle",
      x: 5,
      y: 6,
      width: STICKY_SHAPES.square.width,
      height: STICKY_SHAPES.square.height,
      backgroundColor: STICKY_COLORS[DEFAULT_STICKY_TONE],
      fillStyle: "solid",
      customData: { dayboard: { sticky: { id: A, tone: DEFAULT_STICKY_TONE } } },
    });
    expect(square).not.toHaveProperty("label");
    const wide = buildStickySkeleton({
      id: B,
      x: 0,
      y: 0,
      shape: "wide",
      tone: "pink",
      text: "Hi",
    });
    expect(wide).toMatchObject({ width: 300, height: 180, backgroundColor: STICKY_COLORS.pink });
    expect(wide.label).toMatchObject({ text: "Hi", fontFamily: 2, fontSize: 20 });
  });

  it("has exactly the eight colour tokens as colours, and yellow by default", () => {
    expect(Object.keys(STICKY_COLORS).sort()).toEqual([...COLOR_TOKENS].sort());
    expect(STICKY_COLORS.amber).toBe("#ffec99");
    expect(DEFAULT_STICKY_TONE).toBe("amber");
  });
});

describe("reading notes off a scene", () => {
  it("finds notes with their words, colour and place, in order", () => {
    const notes = readStickies([...note(A, "Call Sam", {}, "e1"), ...note(B, "", {}, "e2")]);
    expect(notes).toEqual([
      expect.objectContaining({
        id: A,
        elementId: "e1",
        text: "Call Sam",
        tone: "blue",
        x: 10,
        y: 20,
      }),
      expect.objectContaining({ id: B, elementId: "e2", text: "" }),
    ]);
  });

  it("ignores deleted notes, rectangles that are not notes, a bad id, and a sticky mark on anything but a rectangle", () => {
    const plain = { id: "r", type: "rectangle", x: 0, y: 0, width: 5, height: 5 } as SceneElement;
    const badId = note("not-a-uuid", "x", {}, "bad");
    const arrow = { ...note(A, "", {}, "arrow")[0]!, type: "arrow" } as SceneElement;
    const deleted = note(B, "gone", { isDeleted: true }, "del");
    expect(readStickies([plain, ...badId, arrow, ...deleted])).toEqual([]);
  });

  it("uses the label's original text, and ignores a label that is deleted", () => {
    const els = note(A, "wrapped\nlines");
    (els[1] as Record<string, unknown>).text = "wrapped lines";
    expect(readStickies(els)[0]!.text).toBe("wrapped\nlines");
    (els[1] as Record<string, unknown>).isDeleted = true;
    expect(readStickies(els)[0]!.text).toBe("");
  });

  it("finds notes that share a task id: the first keeps it, the later ones are the copies", () => {
    const notes = readStickies([
      ...note(A, "one", {}, "e1"),
      ...note(A, "two", {}, "e2"),
      ...note(B, "", {}, "e3"),
    ]);
    expect(duplicateStickies(notes).map((n) => n.elementId)).toEqual(["e2"]);
  });

  it("gives notes new task ids without touching the originals", () => {
    const els = [...note(A, "one", {}, "e1"), ...note(A, "two", {}, "e2")];
    const out = withStickyIds(els, new Map([["e2", B]]));
    expect(readStickies(out).map((n) => n.id)).toEqual([A, B]);
    expect(readStickies(els).map((n) => n.id)).toEqual([A, A]);
  });
});

describe("a note's words and its task", () => {
  it("the first line is the title and the rest the description", () => {
    expect(splitStickyText("Call the plumber")).toEqual({
      title: "Call the plumber",
      description: null,
    });
    expect(splitStickyText("Plan trip\nbook flights\n\nask Sam")).toEqual({
      title: "Plan trip",
      description: "book flights\n\nask Sam",
    });
  });

  it("an empty note has the placeholder title and no description, and comes back as no words", () => {
    expect(splitStickyText("  \n ")).toEqual({ title: EMPTY_STICKY_TITLE, description: null });
    expect(joinStickyText(EMPTY_STICKY_TITLE, null)).toBe("");
    expect(joinStickyText(EMPTY_STICKY_TITLE, "kept")).toBe(`${EMPTY_STICKY_TITLE}\nkept`);
  });

  it("cuts the title at 500 and keeps the tail; refuses more than 600 characters", () => {
    const out = splitStickyText(`${"a".repeat(550)}\nmore`);
    expect(out.title).toHaveLength(STICKY_LIMITS.title);
    expect(out.description).toBe(`${"a".repeat(50)}\nmore`);
    expect(() => splitStickyText("a".repeat(601))).toThrow(StickyError);
    expect(splitStickyText("a".repeat(600)).title).toHaveLength(500);
  });

  it("strips control characters and normalises line ends, and the words round-trip", () => {
    expect(splitStickyText("one\r\ntwo\u0007")).toEqual({ title: "one", description: "two" });
    const { title, description } = splitStickyText("Plan trip\nbook flights");
    expect(joinStickyText(title, description)).toBe("Plan trip\nbook flights");
  });
});

describe("what a saved scene keeps", () => {
  const scene = (customData: unknown, type = "rectangle") => ({
    v: 1,
    elements: [{ id: "x1", type, x: 0, y: 0, width: 10, height: 10, customData }],
    appState: {},
  });
  const kept = (s: unknown) =>
    (sanitizeScene(s).elements[0]!.customData as { dayboard?: { sticky?: unknown } } | undefined)
      ?.dayboard?.sticky;

  it("keeps a sticky mark on a rectangle: a UUID and one of the eight colours", () => {
    expect(kept(scene({ dayboard: { sticky: { id: A.toUpperCase(), tone: "violet" } } }))).toEqual({
      id: A,
      tone: "violet",
    });
    expect(kept(scene({ dayboard: { sticky: { id: A } } }))).toEqual({ id: A });
  });

  it("drops a bad id, a bad colour, extra keys, and the mark on anything but a rectangle", () => {
    expect(kept(scene({ dayboard: { sticky: { id: "nope", tone: "blue" } } }))).toBeUndefined();
    expect(kept(scene({ dayboard: { sticky: { id: A, tone: "#ff0000" } } }))).toEqual({ id: A });
    expect(kept(scene({ dayboard: { sticky: { id: A, evil: "<script>" } } }))).toEqual({ id: A });
    expect(kept(scene({ dayboard: { sticky: { id: A } } }, "ellipse"))).toBeUndefined();
    expect(kept(scene({ dayboard: { sticky: "x" } }))).toBeUndefined();
  });
});

describe("the Outline", () => {
  it("does not list a sticky note as a box (it has its own section)", () => {
    const outline = buildOutline({ v: 1, elements: note(A, "Call Sam"), appState: {} });
    expect(outline.boxes).toEqual([]);
  });
});
