import { isAllowedLink } from "@/lib/editor/schema";
import {
  MAX_ELEMENTS,
  MAX_SCENE_BYTES,
  MAX_SCENE_TEXT,
  type DayboardData,
  type Scene,
  type SceneElement,
} from "./types";

// What a canvas may hold (V3 feature 01 §2.1, docs/decisions/0017). `sanitizeScene` is the only way a scene reaches the
// database: it keeps known fields of known element types, clamps numbers, caps strings, and refuses anything else. It
// is pure, so the browser uses the same checks before it saves. Excalidraw's own fields are cut down to this list, so a
// newer Excalidraw cannot slip a field in.

export class SceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneError";
  }
}

export const ALLOWED_ELEMENT_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "text",
  "frame",
  "freedraw",
] as const;
/** Refused by name, so the message can say what is not supported. */
const REFUSED_TYPES = new Set(["image", "embeddable", "iframe", "magicframe"]);

const TOO_BIG = "This canvas is too big to save. Remove some drawings.";
const COORD = 1_000_000;
const SIZE = 100_000;
const MAX_POINTS = 5_000;
const MAX_TEXT = 2_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function num(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/** Plain text: control characters removed (a line break and a tab stay), cut to a length. */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max);
}

const COLOR = /^(#[0-9a-fA-F]{3,8}|transparent|[a-zA-Z]{3,24}|rgba?\([0-9., %]{5,40}\))$/;
function color(value: unknown): string | undefined {
  return typeof value === "string" && COLOR.test(value) ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** In-app addresses a card may carry (`/notes/{uuid}`, `/projects/{uuid}`, `/tasks?task={uuid}`). */
const IN_APP_LINK =
  /^\/(?:notes\/[0-9a-f-]{36}|projects\/[0-9a-f-]{36}|tasks\?task=[0-9a-f-]{36})$/i;

export function isAllowedSceneLink(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (IN_APP_LINK.test(value) && UUID.test(value.slice(-36))) return true;
  return isAllowedLink(value);
}

function sanitizeDayboard(raw: unknown): DayboardData | undefined {
  if (!isRecord(raw)) return undefined;
  const out: DayboardData = {};
  const id = text(raw.id, 64);
  if (id && /^[a-z][a-z0-9-]{0,31}$/.test(id)) out.id = id;
  const kind = text(raw.kind, 24);
  if (kind && /^[a-z][a-z-]{0,23}$/.test(kind)) out.kind = kind;
  const section = text(raw.section, 64);
  if (section && /^[a-z][a-z0-9-]{0,31}$/.test(section)) out.section = section;
  if (
    isRecord(raw.ref) &&
    (raw.ref.type === "note" || raw.ref.type === "task" || raw.ref.type === "project") &&
    typeof raw.ref.id === "string" &&
    UUID.test(raw.ref.id)
  ) {
    out.ref = { type: raw.ref.type, id: raw.ref.id };
  }
  if (raw.ai === true) out.ai = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

function points(value: unknown): [number, number][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: [number, number][] = [];
  for (const point of value.slice(0, MAX_POINTS)) {
    if (!Array.isArray(point)) continue;
    const x = num(point[0], -COORD, COORD);
    const y = num(point[1], -COORD, COORD);
    if (x !== undefined && y !== undefined) out.push([x, y]);
  }
  return out;
}

function binding(value: unknown) {
  if (!isRecord(value)) return null;
  const elementId = text(value.elementId, 64);
  if (!elementId || !SAFE_ID.test(elementId)) return null;
  const out: Record<string, unknown> = {
    elementId,
    focus: num(value.focus, -10, 10) ?? 0,
    gap: num(value.gap, 0, 10_000) ?? 0,
  };
  if (Array.isArray(value.fixedPoint) && value.fixedPoint.length === 2) {
    const a = num(value.fixedPoint[0], -10, 10);
    const b = num(value.fixedPoint[1], -10, 10);
    if (a !== undefined && b !== undefined) out.fixedPoint = [a, b];
  }
  return out;
}

const ARROWHEADS = [
  "arrow",
  "bar",
  "dot",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
] as const;

function sanitizeElement(raw: unknown): SceneElement | null {
  if (!isRecord(raw)) throw new SceneError("This canvas has something that can't be saved.");
  const type = raw.type;
  if (typeof type === "string" && REFUSED_TYPES.has(type)) {
    throw new SceneError(
      "Images and embedded pages aren't supported on a canvas yet. Remove them to save.",
    );
  }
  const known = oneOf(type, ALLOWED_ELEMENT_TYPES);
  if (!known) throw new SceneError("This canvas has something that can't be saved.");
  // Removed elements are not kept: they only matter to the undo history, which the browser holds itself.
  if (raw.isDeleted === true) return null;

  const id = text(raw.id, 64);
  if (!id || !SAFE_ID.test(id))
    throw new SceneError("This canvas has something that can't be saved.");

  const out: SceneElement = {
    id,
    type: known,
    x: num(raw.x, -COORD, COORD) ?? 0,
    y: num(raw.y, -COORD, COORD) ?? 0,
    width: num(raw.width, 0, SIZE) ?? 0,
    height: num(raw.height, 0, SIZE) ?? 0,
    angle: num(raw.angle, -100, 100) ?? 0,
    strokeColor: color(raw.strokeColor) ?? "#1e1e1e",
    backgroundColor: color(raw.backgroundColor) ?? "transparent",
    fillStyle:
      oneOf(raw.fillStyle, ["solid", "hachure", "cross-hatch", "zigzag"] as const) ?? "solid",
    strokeWidth: num(raw.strokeWidth, 0, 64) ?? 1,
    strokeStyle: oneOf(raw.strokeStyle, ["solid", "dashed", "dotted"] as const) ?? "solid",
    roughness: num(raw.roughness, 0, 3) ?? 1,
    opacity: num(raw.opacity, 0, 100) ?? 100,
    seed: num(raw.seed, 0, 2_147_483_647) ?? 1,
    version: num(raw.version, 0, 2_147_483_647) ?? 1,
    versionNonce: num(raw.versionNonce, 0, 2_147_483_647) ?? 0,
    isDeleted: false,
    locked: raw.locked === true,
  };
  if (typeof raw.index === "string" && /^[A-Za-z0-9]{1,64}$/.test(raw.index)) out.index = raw.index;
  const updated = num(raw.updated, 0, 8_640_000_000_000_000);
  if (updated !== undefined) out.updated = updated;
  if (Array.isArray(raw.groupIds)) {
    out.groupIds = raw.groupIds
      .map((g) => text(g, 64))
      .filter((g): g is string => Boolean(g))
      .slice(0, 20);
  } else out.groupIds = [];
  const frameId = text(raw.frameId, 64);
  out.frameId = frameId && SAFE_ID.test(frameId) ? frameId : null;
  if (isRecord(raw.roundness)) {
    const kind = num(raw.roundness.type, 1, 4);
    if (kind !== undefined) {
      const value = num(raw.roundness.value, 0, 1_000);
      out.roundness = value === undefined ? { type: kind } : { type: kind, value };
    } else out.roundness = null;
  } else out.roundness = null;
  out.boundElements = Array.isArray(raw.boundElements)
    ? raw.boundElements
        .flatMap((b) => {
          if (!isRecord(b)) return [];
          const bid = text(b.id, 64);
          const btype = oneOf(b.type, ["arrow", "text"] as const);
          return bid && SAFE_ID.test(bid) && btype ? [{ id: bid, type: btype }] : [];
        })
        .slice(0, 200)
    : null;

  // A link is kept only when it is safe; otherwise it is removed.
  out.link = isAllowedSceneLink(raw.link) ? raw.link : null;
  const dayboard = isRecord(raw.customData) ? sanitizeDayboard(raw.customData.dayboard) : undefined;
  if (dayboard) out.customData = { dayboard };

  switch (known) {
    case "text": {
      out.text = text(raw.text, MAX_TEXT) ?? "";
      out.originalText = text(raw.originalText, MAX_TEXT) ?? out.text;
      out.fontSize = num(raw.fontSize, 1, 400) ?? 20;
      out.fontFamily = num(raw.fontFamily, 1, 20) ?? 5;
      out.textAlign = oneOf(raw.textAlign, ["left", "center", "right"] as const) ?? "left";
      out.verticalAlign = oneOf(raw.verticalAlign, ["top", "middle", "bottom"] as const) ?? "top";
      out.lineHeight = num(raw.lineHeight, 0.5, 5) ?? 1.25;
      out.autoResize = raw.autoResize !== false;
      const container = text(raw.containerId, 64);
      out.containerId = container && SAFE_ID.test(container) ? container : null;
      break;
    }
    case "arrow":
    case "line": {
      out.points = points(raw.points) ?? [];
      out.startBinding = binding(raw.startBinding);
      out.endBinding = binding(raw.endBinding);
      out.startArrowhead = oneOf(raw.startArrowhead, ARROWHEADS) ?? null;
      out.endArrowhead = known === "arrow" ? (oneOf(raw.endArrowhead, ARROWHEADS) ?? null) : null;
      if (known === "arrow") out.elbowed = raw.elbowed === true;
      else out.polygon = raw.polygon === true;
      break;
    }
    case "freedraw": {
      out.points = points(raw.points) ?? [];
      out.pressures = Array.isArray(raw.pressures)
        ? raw.pressures.slice(0, MAX_POINTS).map((p) => num(p, 0, 1) ?? 0)
        : [];
      out.simulatePressure = raw.simulatePressure !== false;
      break;
    }
    case "frame": {
      out.name = text(raw.name, 200) ?? null;
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * Checks a scene and returns the version that may be stored. Throws a `SceneError` with a plain message when the scene
 * is too big, or holds an image, an embed or an element it does not know.
 */
export function sanitizeScene(input: unknown): Scene {
  if (!isRecord(input) || input.v !== 1 || !Array.isArray(input.elements)) {
    throw new SceneError("This canvas couldn't be read.");
  }
  // A size check on the raw input first, so a huge scene is not walked at all.
  let bytes: number;
  try {
    bytes = JSON.stringify(input).length;
  } catch {
    throw new SceneError("This canvas couldn't be read.");
  }
  if (bytes > MAX_SCENE_BYTES || input.elements.length > MAX_ELEMENTS * 2)
    throw new SceneError(TOO_BIG);

  const elements: SceneElement[] = [];
  const seen = new Set<string>();
  for (const raw of input.elements) {
    const element = sanitizeElement(raw);
    if (!element) continue;
    if (seen.has(element.id))
      throw new SceneError("This canvas has something that can't be saved.");
    seen.add(element.id);
    elements.push(element);
  }
  if (elements.length > MAX_ELEMENTS) throw new SceneError(TOO_BIG);

  const app = isRecord(input.appState) ? input.appState : {};
  const appState: Scene["appState"] = {};
  const background = color(app.viewBackgroundColor);
  if (background) appState.viewBackgroundColor = background;
  if (typeof app.gridModeEnabled === "boolean") appState.gridModeEnabled = app.gridModeEnabled;
  return { v: 1, elements, appState };
}

/**
 * What the browser strips before saving, so a pasted picture or an embed does not stop autosave: returns the live
 * elements the server would accept, and the types it left out (so the person can be told once).
 */
export function stripUnsupported<T extends { type?: unknown; isDeleted?: unknown }>(
  elements: readonly T[],
): { kept: T[]; removed: string[] } {
  const kept: T[] = [];
  const removed = new Set<string>();
  for (const element of elements) {
    if (element.isDeleted === true) {
      kept.push(element);
      continue;
    }
    if (oneOf(element.type, ALLOWED_ELEMENT_TYPES)) kept.push(element);
    else removed.add(typeof element.type === "string" ? element.type : "unknown");
  }
  return { kept, removed: [...removed] };
}

/**
 * The plain text kept for search: the title, text elements (cards and labels) and frame names. Built from the checked
 * scene, never from anything the client sent. Cut to `MAX_SCENE_TEXT`.
 */
export function projectScene(title: string, scene: Scene): { text: string; elementCount: number } {
  const parts: string[] = [];
  if (title.trim()) parts.push(title.trim());
  for (const element of scene.elements) {
    if (element.type === "text" && typeof element.text === "string" && element.text.trim()) {
      parts.push(element.text.trim());
    } else if (
      element.type === "frame" &&
      typeof element.name === "string" &&
      element.name.trim()
    ) {
      parts.push(element.name.trim());
    }
  }
  return {
    text: parts.join("\n").slice(0, MAX_SCENE_TEXT),
    elementCount: scene.elements.length,
  };
}
