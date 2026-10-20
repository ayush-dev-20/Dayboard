import type { ColorToken } from "@/lib/colors";
import type { NodeKind } from "./diagram-spec";
import type { LaidOut } from "./layout";

// From a layout to a drawing (V3 feature 01 §5). This builds Excalidraw *element skeletons*: plain objects with the
// box, frame and arrow a diagram needs, each arrow naming the two boxes it is attached to. It is pure, so the tests
// check the bindings. A thin client step (`diagram-scene.ts`) hands the skeletons to Excalidraw's
// `convertToExcalidrawElements`, which measures the text and attaches the arrows. The server never imports Excalidraw:
// it checks the finished scene with `sanitizeScene` when the person confirms.

export type Skeleton = {
  type: "rectangle" | "ellipse" | "diamond" | "frame" | "arrow";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [field: string]: unknown;
};

/** Stroke and fill for each colour token (light theme; Excalidraw inverts them in dark mode). */
export const TONES: Record<ColorToken, { stroke: string; fill: string }> = {
  slate: { stroke: "#495057", fill: "#f1f3f5" },
  red: { stroke: "#e03131", fill: "#ffe3e3" },
  amber: { stroke: "#e8590c", fill: "#fff4e6" },
  green: { stroke: "#2f9e44", fill: "#ebfbee" },
  teal: { stroke: "#0c8599", fill: "#e3fafc" },
  blue: { stroke: "#1971c2", fill: "#e7f5ff" },
  violet: { stroke: "#6741d9", fill: "#f3f0ff" },
  pink: { stroke: "#c2255c", fill: "#fff0f6" },
};

/** What each kind of box looks like. A database is teal, a cache amber, a queue violet, an outside system slate with a dashed outline, a gateway blue; the rest take their section's tone, or none. */
export const KIND_STYLE: Record<
  NodeKind,
  { shape: "rectangle" | "ellipse" | "diamond"; tone: ColorToken | null; dashed: boolean }
> = {
  client: { shape: "rectangle", tone: null, dashed: false },
  gateway: { shape: "rectangle", tone: "blue", dashed: false },
  service: { shape: "rectangle", tone: null, dashed: false },
  database: { shape: "rectangle", tone: "teal", dashed: false },
  cache: { shape: "rectangle", tone: "amber", dashed: false },
  queue: { shape: "rectangle", tone: "violet", dashed: false },
  storage: { shape: "rectangle", tone: "teal", dashed: false },
  external: { shape: "rectangle", tone: "slate", dashed: true },
  actor: { shape: "ellipse", tone: null, dashed: false },
  process: { shape: "rectangle", tone: null, dashed: false },
  decision: { shape: "diamond", tone: null, dashed: false },
  "start-end": { shape: "ellipse", tone: null, dashed: false },
};

/**
 * The font of an AI diagram's labels: Excalidraw's "Helvetica" (2), a system sans. The hand-drawn font loads on first
 * use, so a label measured before it arrived was measured too narrow and its last letters were cut off; a system font is
 * always there, so what is measured is what is drawn. (A person's own text keeps the hand-drawn font.)
 */
export const DIAGRAM_FONT = 2;

/** Only arrows up to this long carry their label: on a long arrow across sections the labels pile up into noise. */
const LABEL_MAX_LENGTH = 260;

export const boxId = (nodeId: string) => `box-${nodeId}`;
export const frameId = (sectionId: string) => `frame-${sectionId}`;

export type BuiltDiagram = {
  skeletons: Skeleton[];
  /** Everything that was made, for a caller that wants to select or measure it. */
  bounds: { x: number; y: number; width: number; height: number };
};

/**
 * The skeletons of a laid-out diagram, moved by `offset`. Every one carries `customData.dayboard` (`ai: true`), so
 * refining and the Outline can read the diagram back. A box's label is its name, and its technology on a second line:
 * colour is never the only signal.
 */
export function buildDiagramSkeletons(
  laid: LaidOut,
  options: {
    offsetX?: number;
    offsetY?: number;
    sectionTones?: Map<string, ColorToken | null>;
  } = {},
): BuiltDiagram {
  const dx = options.offsetX ?? 0;
  const dy = options.offsetY ?? 0;
  const frameTone = new Map(laid.frames.map((f) => [f.id, f.tone]));

  const boxes: Skeleton[] = laid.boxes.map((box) => {
    const style = KIND_STYLE[box.kind];
    const sectionTone = box.section ? (frameTone.get(box.section) ?? null) : null;
    const tone: ColorToken = style.tone ?? sectionTone ?? "slate";
    const colours = TONES[tone];
    return {
      type: style.shape,
      id: boxId(box.id),
      x: box.x + dx,
      y: box.y + dy,
      width: box.w,
      height: box.h,
      strokeColor: colours.stroke,
      backgroundColor: colours.fill,
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: style.dashed ? "dashed" : "solid",
      roughness: 0,
      roundness: style.shape === "rectangle" ? { type: 3 } : null,
      label: {
        text: box.tech ? `${box.label}\n${box.tech}` : box.label,
        fontSize: 16,
        fontFamily: DIAGRAM_FONT,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: "#1e1e1e",
      },
      customData: {
        dayboard: {
          id: box.id,
          kind: box.kind,
          ...(box.section ? { section: box.section } : {}),
          ai: true,
        },
      },
    };
  });

  const frames: Skeleton[] = laid.frames.map((frame) => ({
    type: "frame",
    id: frameId(frame.id),
    x: frame.x + dx,
    y: frame.y + dy,
    width: frame.w,
    height: frame.h,
    name: frame.label,
    children: frame.boxIds.map(boxId),
    customData: { dayboard: { id: frame.id, section: frame.id, ai: true } },
  }));

  const arrows: Skeleton[] = laid.arrows.map((arrow) => ({
    type: "arrow",
    id: `edge-${arrow.from}-${arrow.to}`.slice(0, 64),
    x: arrow.x1 + dx,
    y: arrow.y1 + dy,
    width: Math.abs(arrow.x2 - arrow.x1),
    height: Math.abs(arrow.y2 - arrow.y1),
    points: [
      [0, 0],
      [arrow.x2 - arrow.x1, arrow.y2 - arrow.y1],
    ],
    // Attached at both ends: moving a box moves its arrows.
    start: { id: boxId(arrow.from) },
    end: { id: boxId(arrow.to) },
    startArrowhead: arrow.both ? "arrow" : null,
    endArrowhead: "arrow",
    strokeColor: "#868e96",
    strokeWidth: 1,
    strokeStyle: arrow.dashed ? "dashed" : "solid",
    roughness: 0,
    ...(arrow.label && Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1) <= LABEL_MAX_LENGTH
      ? {
          label: {
            text: arrow.label,
            fontSize: 14,
            fontFamily: DIAGRAM_FONT,
            strokeColor: "#1e1e1e",
          },
        }
      : {}),
    customData: { dayboard: { ai: true } },
  }));

  return {
    // Frames before the boxes they hold, arrows last (so an arrow's two boxes exist when it names them).
    skeletons: [...frames, ...boxes, ...arrows],
    bounds: { x: dx, y: dy, width: laid.width, height: laid.height },
  };
}
