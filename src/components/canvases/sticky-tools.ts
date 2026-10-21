import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  buildStickySkeleton,
  duplicateStickies,
  readStickies,
  STICKY_COLORS,
  STICKY_FONT,
  STICKY_FONT_SIZE,
  STICKY_SHAPES,
  withStickyIds,
  type StickyNote,
  type StickyShape,
} from "@/lib/canvas/sticky";
import type { StickyInfoDTO } from "@/lib/canvas/dto";
import type { SceneElement } from "@/lib/canvas/types";
import type { ColorToken } from "@/lib/colors";
import { measuredLabel, type El } from "./refine-scene";

// What the browser does to sticky notes on the drawing (V3 feature 01 §13.5): make one, start typing on it, recolour and
// reshape it, keep its look and ids right, and bring the words and the done look in line with its task. Every function
// takes the Excalidraw API and changes the scene in one `updateScene`, so one Undo takes it back.

const bump = <T extends El>(e: T, over: Partial<El> = {}): T => ({
  ...e,
  ...over,
  version: (typeof e.version === "number" ? e.version : 1) + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
  updated: Date.now(),
});

const live = (api: ExcalidrawImperativeAPI) => api.getSceneElements() as unknown as El[];
const all = (api: ExcalidrawImperativeAPI) =>
  api.getSceneElementsIncludingDeleted() as unknown as El[];
const labelOf = (list: El[], containerId: string) =>
  list.find((e) => e.type === "text" && e.containerId === containerId && !e.isDeleted);

/** Makes a note at a point in the scene, selects it, and returns the task id and the element id. */
export async function createSticky(
  api: ExcalidrawImperativeAPI,
  input: { x: number; y: number; tone?: ColorToken; shape?: StickyShape },
): Promise<{ id: string; elementId: string }> {
  const lib = await import("@excalidraw/excalidraw");
  const id = crypto.randomUUID();
  const size = STICKY_SHAPES[input.shape ?? "square"];
  const made = lib.convertToExcalidrawElements([
    buildStickySkeleton({
      id,
      x: Math.round(input.x - size.width / 2),
      y: Math.round(input.y - size.height / 2),
      tone: input.tone,
      shape: input.shape,
    }),
  ] as never) as unknown as El[];
  const box = made.find((e) => e.type === "rectangle")!;
  api.updateScene({
    elements: [...all(api), ...made] as never[],
    appState: { selectedElementIds: { [box.id]: true } } as never,
    captureUpdate: "IMMEDIATELY" as never,
  });
  return { id, elementId: box.id };
}

/**
 * Opens a note for typing, as a double click on it would. Excalidraw has no call for this, so the double click is sent to its
 * canvas at the note's middle once the scene has settled.
 */
export function startTyping(api: ExcalidrawImperativeAPI, elementId: string): void {
  const attempt = (tries: number) => {
    const box = live(api).find((e) => e.id === elementId);
    const canvas = document.querySelector<HTMLCanvasElement>(".excalidraw canvas.interactive");
    if (!box || !canvas) {
      if (tries > 0) requestAnimationFrame(() => attempt(tries - 1));
      return;
    }
    const state = api.getAppState();
    const rect = canvas.getBoundingClientRect();
    const zoom = state.zoom.value;
    const clientX = rect.left + (box.x + box.width / 2 + state.scrollX) * zoom;
    const clientY = rect.top + (box.y + box.height / 2 + state.scrollY) * zoom;
    canvas.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY, detail: 2 }),
    );
  };
  requestAnimationFrame(() => requestAnimationFrame(() => attempt(10)));
}

/** A colour for these notes. */
export function recolour(
  api: ExcalidrawImperativeAPI,
  elementIds: readonly string[],
  tone: ColorToken,
): void {
  const ids = new Set(elementIds);
  api.updateScene({
    elements: all(api).map((e) =>
      ids.has(e.id) && e.type === "rectangle"
        ? bump(e, {
            backgroundColor: STICKY_COLORS[tone],
            customData: {
              ...e.customData,
              dayboard: {
                ...e.customData?.dayboard,
                sticky: { ...e.customData?.dayboard?.sticky, tone },
              },
            },
          })
        : e,
    ) as never[],
    captureUpdate: "IMMEDIATELY" as never,
  });
}

/** Square or rectangular: the note takes the shape's size from its top left, and its words are laid out again to fit. */
export async function reshape(
  api: ExcalidrawImperativeAPI,
  elementIds: readonly string[],
  shape: StickyShape,
): Promise<void> {
  const size = STICKY_SHAPES[shape];
  const ids = new Set(elementIds);
  const before = all(api);
  const next: El[] = [];
  for (const e of before) {
    if (ids.has(e.id) && e.type === "rectangle") {
      const box = bump(e, { width: size.width, height: size.height });
      next.push(box);
    } else next.push(e);
  }
  // The words follow the new size.
  const out: El[] = [];
  for (const e of next) {
    const box =
      e.type === "text" && typeof e.containerId === "string" && ids.has(e.containerId)
        ? next.find((c) => c.id === e.containerId)
        : undefined;
    if (box && !e.isDeleted) {
      const measured = await measuredLabel(
        box,
        String(e.originalText ?? e.text ?? ""),
        STICKY_FONT_SIZE,
      );
      out.push(
        measured
          ? bump(e, {
              text: measured.text,
              x: measured.x,
              y: measured.y,
              width: measured.width,
              height: measured.height,
            })
          : e,
      );
    } else out.push(e);
  }
  api.updateScene({ elements: out as never[], captureUpdate: "IMMEDIATELY" as never });
}

/** Whether a note is a square or a rectangle, by its size (a person may have resized it, so the nearest shape). */
export function shapeOf(note: Pick<StickyNote, "width" | "height">): StickyShape {
  return note.width / Math.max(1, note.height) > 1.25 ? "wide" : "square";
}

/**
 * Housekeeping after any change, in one step with no Undo entry: a copy of a note (Cmd/Ctrl+D, a paste) gets a task id of
 * its own, and the words typed on a note take the sticky font and size. Returns whether it changed anything.
 */
export async function maintain(api: ExcalidrawImperativeAPI): Promise<boolean> {
  const elements = live(api);
  const notes = readStickies(elements as unknown as SceneElement[]);
  let next = all(api);
  let changed = false;

  const copies = duplicateStickies(notes);
  if (copies.length > 0) {
    next = withStickyIds(
      next as unknown as SceneElement[],
      new Map(copies.map((n) => [n.elementId, crypto.randomUUID()])),
    ) as unknown as El[];
    changed = true;
  }

  const boxes = new Map(notes.map((n) => [n.elementId, n]));
  for (let i = 0; i < next.length; i += 1) {
    const e = next[i]!;
    if (
      e.type === "text" &&
      !e.isDeleted &&
      typeof e.containerId === "string" &&
      boxes.has(e.containerId) &&
      (e.fontFamily !== STICKY_FONT || e.fontSize !== STICKY_FONT_SIZE)
    ) {
      const box = next.find((c) => c.id === e.containerId)!;
      const measured = await measuredLabel(
        box,
        String(e.originalText ?? e.text ?? ""),
        STICKY_FONT_SIZE,
      );
      if (measured) {
        next[i] = bump(e, {
          fontFamily: STICKY_FONT,
          fontSize: STICKY_FONT_SIZE,
          text: measured.text,
          x: measured.x,
          y: measured.y,
          width: measured.width,
          height: measured.height,
          lineHeight: measured.lineHeight ?? e.lineHeight,
        });
        changed = true;
      }
    }
  }
  if (changed) api.updateScene({ elements: next as never[], captureUpdate: "NEVER" as never });
  return changed;
}

/** Applies the new task ids a save gave to notes whose id belonged to something else (a paste from another canvas). */
export function applyRemap(
  api: ExcalidrawImperativeAPI,
  remap: readonly { element: string; id: string }[],
): void {
  api.updateScene({
    elements: withStickyIds(
      all(api) as unknown as SceneElement[],
      new Map(remap.map((r) => [r.element, r.id])),
    ) as never[],
    captureUpdate: "NEVER" as never,
  });
}

const FADED = 55;

/**
 * Brings the drawing in line with the tasks (when the page opens, and after the task panel closes): a note whose task is
 * gone is taken off, one whose words were edited in the task panel shows them, and a finished note is dimmed. Changes
 * nothing when everything already matches. Returns whether it changed the scene.
 */
export async function reconcile(
  api: ExcalidrawImperativeAPI,
  infos: ReadonlyMap<string, StickyInfoDTO>,
  options: { removeMissing: boolean } = { removeMissing: false },
): Promise<boolean> {
  const notes = readStickies(live(api) as unknown as SceneElement[]);
  let next = all(api);
  let changed = false;

  for (const note of notes) {
    const info = infos.get(note.id);
    const boxIndex = next.findIndex((e) => e.id === note.elementId);
    const box = next[boxIndex];
    if (!box) continue;
    if (!info) {
      // Only when the tasks are known to be complete (the page just opened, or a save just went through): a note made a
      // moment ago has no task yet. The task was deleted elsewhere, so the note goes too.
      if (options.removeMissing) {
        next = next.map((e) =>
          e.id === box.id || (e.type === "text" && e.containerId === box.id)
            ? bump(e, { isDeleted: true })
            : e,
        );
        changed = true;
      }
      continue;
    }
    const closed = info.status === "DONE" || info.status === "CANCELLED";
    const opacity = closed ? FADED : 100;
    if (box.opacity !== opacity) {
      next[boxIndex] = bump(box, { opacity });
      changed = true;
    }
    const label = labelOf(next, box.id);
    if (info.text !== note.text) {
      // Words changed in the task panel.
      const measured = await measuredLabel(box, info.text, STICKY_FONT_SIZE);
      if (info.text === "") {
        if (label) {
          next = next.map((e) => (e.id === label.id ? bump(e, { isDeleted: true }) : e));
          changed = true;
        }
      } else if (measured && label) {
        next = next.map((e) =>
          e.id === label.id
            ? bump(e, {
                text: measured.text,
                originalText: info.text,
                x: measured.x,
                y: measured.y,
                width: measured.width,
                height: measured.height,
              })
            : e,
        );
        changed = true;
      } else if (measured) {
        const created = {
          ...measured,
          containerId: box.id,
          fontFamily: STICKY_FONT,
          originalText: info.text,
        };
        next = next.map((e) =>
          e.id === box.id
            ? bump(e, {
                boundElements: [...(e.boundElements ?? []), { id: created.id, type: "text" }],
              })
            : e,
        );
        next.push(created);
        changed = true;
      }
    }
  }
  if (changed) api.updateScene({ elements: next as never[], captureUpdate: "NEVER" as never });
  return changed;
}

/** Selects a note and brings it into view (Today's "Show on canvas"). */
export function focusSticky(api: ExcalidrawImperativeAPI, taskId: string): boolean {
  const note = readStickies(live(api) as unknown as SceneElement[]).find((n) => n.id === taskId);
  if (!note) return false;
  const element = live(api).find((e) => e.id === note.elementId);
  api.updateScene({
    appState: { selectedElementIds: { [note.elementId]: true } } as never,
    captureUpdate: "NEVER" as never,
  });
  api.scrollToContent(element as never, { fitToContent: false, animate: false } as never);
  return true;
}

/** Copies of these notes, just below and to the right, each with a task of its own; the copies are selected. */
export async function duplicateNotes(
  api: ExcalidrawImperativeAPI,
  notes: readonly StickyNote[],
): Promise<void> {
  if (notes.length === 0) return;
  const lib = await import("@excalidraw/excalidraw");
  const skeletons = notes.map((n) => ({
    ...buildStickySkeleton({
      id: crypto.randomUUID(),
      x: n.x + 24,
      y: n.y + 24,
      tone: n.tone,
      text: n.text || undefined,
    }),
    width: n.width,
    height: n.height,
  }));
  const made = lib.convertToExcalidrawElements(skeletons as never) as unknown as El[];
  const boxes = made.filter((e) => e.type === "rectangle");
  api.updateScene({
    elements: [...all(api), ...made] as never[],
    appState: {
      selectedElementIds: Object.fromEntries(boxes.map((b) => [b.id, true])),
    } as never,
    captureUpdate: "IMMEDIATELY" as never,
  });
}

/** Takes these notes (and their words) off the drawing; their tasks go to Trash with the next save. */
export function removeNotes(api: ExcalidrawImperativeAPI, elementIds: readonly string[]): void {
  const ids = new Set(elementIds);
  api.updateScene({
    elements: all(api).map((e) =>
      ids.has(e.id) ||
      (e.type === "text" && typeof e.containerId === "string" && ids.has(e.containerId))
        ? bump(e, { isDeleted: true })
        : e,
    ) as never[],
    appState: { selectedElementIds: {} } as never,
    captureUpdate: "IMMEDIATELY" as never,
  });
}
