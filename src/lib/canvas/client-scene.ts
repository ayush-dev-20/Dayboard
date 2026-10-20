import { stripUnsupported } from "./schema";
import { MAX_SCENE_BYTES, type Scene, type SceneElement } from "./types";

// What the browser sends when it saves (V3 feature 01 §7). The server checks everything again; this only keeps an
// unsupported thing a person pasted (a picture, an embed) from stopping autosave, and says so once.

type LiveElement = { type?: unknown; isDeleted?: unknown };
type LiveAppState = { viewBackgroundColor?: unknown; gridModeEnabled?: unknown };

export type BuiltScene =
  { ok: true; scene: Scene; removed: string[] } | { ok: false; message: string; removed: string[] };

export function buildSceneToSave(
  elements: readonly LiveElement[],
  appState: LiveAppState,
): BuiltScene {
  const { kept, removed } = stripUnsupported(elements);
  const live = kept.filter((e) => e.isDeleted !== true) as unknown as SceneElement[];
  const scene: Scene = {
    v: 1,
    elements: live,
    appState: {
      ...(typeof appState.viewBackgroundColor === "string"
        ? { viewBackgroundColor: appState.viewBackgroundColor }
        : {}),
      ...(typeof appState.gridModeEnabled === "boolean"
        ? { gridModeEnabled: appState.gridModeEnabled }
        : {}),
    },
  };
  if (JSON.stringify(scene).length > MAX_SCENE_BYTES) {
    return { ok: false, message: "This canvas is too big to save. Remove some drawings.", removed };
  }
  return { ok: true, scene, removed };
}

/** The words for what was left out of a save. */
export function describeRemoved(removed: string[]): string {
  const images = removed.some((t) => t === "image");
  const embeds = removed.some((t) => t === "embeddable" || t === "iframe" || t === "magicframe");
  if (images && !embeds) return "Images aren't supported on a canvas yet, so they weren't saved.";
  if (embeds && !images)
    return "Embedded pages aren't supported on a canvas yet, so they weren't saved.";
  return "Images and embedded pages aren't supported on a canvas yet, so they weren't saved.";
}

// The draft kept on the device when a save fails (like a note's): `canvas-draft:{id}`.
export type CanvasDraft = { baseVersion: number; at: number; scene: Scene };
const draftKey = (id: string) => `canvas-draft:${id}`;

export function readCanvasDraft(id: string): CanvasDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const draft = JSON.parse(raw) as CanvasDraft;
    return draft && typeof draft.at === "number" && draft.scene?.v === 1 ? draft : null;
  } catch {
    return null;
  }
}

export function writeCanvasDraft(id: string, draft: CanvasDraft): void {
  try {
    window.localStorage.setItem(draftKey(id), JSON.stringify(draft));
  } catch {
    // Storage full or off: the edit stays in the page.
  }
}

export function clearCanvasDraft(id: string): void {
  try {
    window.localStorage.removeItem(draftKey(id));
  } catch {
    // Nothing to clear.
  }
}
