"use client";

import { createContext, useContext } from "react";

/** Where an editor is used. The slash menu and node views read it (feature 01 §4, §7). */
export type EditorContextValue = {
  /** `note` for the note editor, `task` for a task description. */
  surface: "note" | "task";
  /** The note or task id; null for a note that is not created yet. Keys per-device UI state. */
  ownerId: string | null;
  /** The browser has no connection. */
  offline: boolean;
  /** File storage is set up: images and files can be added (feature 09). */
  filesEnabled: boolean;
  /**
   * A note that is not created yet becomes real (its first save happens now) and its id comes
   * back, so a sub-note can be made under it. Absent where the owner always exists (task
   * descriptions).
   */
  ensureOwner?: () => Promise<string | null>;
};

export const DEFAULT_EDITOR_CONTEXT: EditorContextValue = {
  surface: "note",
  ownerId: null,
  offline: false,
  filesEnabled: false,
};

const EditorSurfaceContext = createContext<EditorContextValue>(DEFAULT_EDITOR_CONTEXT);

export const EditorSurfaceProvider = EditorSurfaceContext.Provider;
export const useEditorSurface = () => useContext(EditorSurfaceContext);

/**
 * The editor is created once, so its extensions read the context through this holder, which the
 * component keeps current. (A holder object rather than a ref: the extensions are built while
 * rendering, and only read the value later, from events.)
 */
export function createContextHolder(initial: EditorContextValue) {
  let value = initial;
  return {
    get: () => value,
    set: (next: EditorContextValue) => {
      value = next;
    },
  };
}
