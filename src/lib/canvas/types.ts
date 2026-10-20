// The shapes a canvas is stored and sent in (V3 feature 01 §2). Plain types, so the browser, the server and the tests
// share them. The scene is Excalidraw's, cut down to a whitelist by `sanitizeScene` (schema.ts).

export const CANVAS_KINDS = ["DRAWING", "BOARD"] as const;
export type CanvasKind = (typeof CANVAS_KINDS)[number];

/** One element of a drawing. Only whitelisted fields survive `sanitizeScene`; the rest of Excalidraw's fields are dropped. */
export type SceneElement = {
  id: string;
  type: "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "text" | "frame" | "freedraw";
  [field: string]: unknown;
};

export type Scene = {
  v: 1;
  elements: SceneElement[];
  appState: { viewBackgroundColor?: string; gridModeEnabled?: boolean };
};

export const EMPTY_SCENE: Scene = { v: 1, elements: [], appState: {} };

/** What `customData.dayboard` may hold: how a diagram's parts are read back (refine, outline). */
export type DayboardData = {
  id?: string;
  kind?: string;
  section?: string;
  ref?: { type: "note" | "task" | "project"; id: string };
  ai?: true;
};

/** A person may keep this many canvases (both kinds), so one account cannot fill the free database. */
export const CANVAS_LIMIT = 100;
export const MAX_SCENE_BYTES = 1_000_000;
export const MAX_ELEMENTS = 2_000;
export const MAX_SCENE_TEXT = 20_000;
export const MAX_TITLE = 300;
