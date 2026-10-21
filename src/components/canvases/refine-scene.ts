import type { DiagramSpec } from "@/lib/canvas/diagram-spec";
import { arrowBetween, layoutDiagram } from "@/lib/canvas/layout";
import type { ReadBack } from "@/lib/canvas/read-back";
import type { RefineOp } from "@/lib/canvas/refine";
import { arrowSkeleton, DIAGRAM_FONT } from "@/lib/canvas/scene-builder";
import type { SceneElement } from "@/lib/canvas/types";
import { diagramToScene } from "./diagram-scene";

// The browser's half of "Refine with AI" and "Arrange again" (V3 feature 01 §7). Both take the elements on the canvas and
// give back the elements it should have next; the caller puts them on the canvas in one step, so one Undo takes it back.
// Nothing here moves or removes anything the change does not name: new parts go into an Additions frame beside the
// diagram, a removed box takes only its own label and connections with it, and Arrange again moves only what the AI drew.

export type El = SceneElement & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ADDITIONS = "additions";
const bump = <T extends El>(e: T, over: Partial<El> = {}): T => ({
  ...e,
  ...over,
  version: (typeof e.version === "number" ? e.version : 1) + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
  updated: Date.now(),
});
const gone = (e: El) => bump(e, { isDeleted: true });

type Bound = { id: string; type: string };
const boundOf = (e: El): Bound[] => (Array.isArray(e.boundElements) ? e.boundElements : []);

export type RefineApplied = {
  /** Everything for `updateScene`, deleted elements included. */
  elements: SceneElement[];
  /** What was added, to select and show. */
  added: SceneElement[];
};

/** The label of a box as Excalidraw measures it: asks it to make one and keeps the text it measured. */
export async function measuredLabel(box: El, text: string, fontSize = 16): Promise<El | null> {
  const lib = await import("@excalidraw/excalidraw");
  const made = lib.convertToExcalidrawElements([
    {
      type: "rectangle",
      id: "measure",
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      label: {
        text,
        fontSize,
        fontFamily: DIAGRAM_FONT,
        textAlign: "center",
        verticalAlign: "middle",
      },
    },
  ] as never) as unknown as El[];
  return made.find((e) => e.type === "text") ?? null;
}

/**
 * Carries a checked list of changes onto the canvas. `final` is the diagram after the changes (from `applyRefine`);
 * `read` is what was read off the canvas before, so each id in an op leads to the shape that draws it.
 */
export async function applyRefineToCanvas(
  current: readonly SceneElement[],
  read: ReadBack,
  ops: readonly RefineOp[],
  final: DiagramSpec,
  origin: { x: number; y: number },
): Promise<RefineApplied> {
  const byId = new Map<string, El>((current as El[]).map((e) => [e.id, e]));
  const replace = (e: El) => byId.set(e.id, e);
  const textOf = (containerId: string) =>
    [...byId.values()].find(
      (e) => e.type === "text" && e.containerId === containerId && !e.isDeleted,
    );

  /** Removes an arrow, its label, and its place in the two boxes it joined. */
  const removeArrow = (arrowId: string) => {
    const arrow = byId.get(arrowId);
    if (!arrow || arrow.isDeleted) return;
    replace(gone(arrow));
    const label = textOf(arrowId);
    if (label) replace(gone(label));
    for (const side of ["startBinding", "endBinding"] as const) {
      const box = byId.get(arrow[side]?.elementId);
      if (box) replace(bump(box, { boundElements: boundOf(box).filter((b) => b.id !== arrowId) }));
    }
  };

  for (const op of ops) {
    if (op.op === "removeEdge") {
      const id = read.arrows.get(`${op.from}>${op.to}`);
      if (id) removeArrow(id);
    } else if (op.op === "removeNode") {
      const boxId = read.boxes.get(op.id);
      const box = boxId ? byId.get(boxId) : undefined;
      if (!box) continue;
      // Every connection that touched the box goes with it, whoever drew it.
      for (const b of boundOf(box)) if (b.type === "arrow") removeArrow(b.id);
      const label = textOf(box.id);
      if (label) replace(gone(label));
      replace(gone(byId.get(box.id)!));
    }
  }

  // A renamed box: the new words are measured by Excalidraw so the label fits and stays centred.
  for (const op of ops) {
    if (op.op !== "updateNode") continue;
    const boxId = read.boxes.get(op.id);
    const box = boxId ? byId.get(boxId) : undefined;
    const node = final.nodes.find((n) => n.id === op.id);
    const label = box ? textOf(box.id) : undefined;
    if (!box || !node || !label) continue;
    const text = node.tech ? `${node.label}\n${node.tech}` : node.label;
    const measured = await measuredLabel(box, text);
    if (!measured) continue;
    replace(
      bump(label, {
        text: measured.text,
        originalText: text,
        x: measured.x,
        y: measured.y,
        width: measured.width,
        height: measured.height,
      }),
    );
  }

  // New parts: the boxes (and the connections among them) in an Additions frame beside the diagram.
  const added: El[] = [];
  const addedIds = new Set(
    ops.flatMap((op) =>
      op.op === "addNode" && final.nodes.some((n) => n.id === op.node.id) ? [op.node.id] : [],
    ),
  );
  const newBoxes = new Map<string, El>();
  if (addedIds.size > 0) {
    const nodes = final.nodes
      .filter((n) => addedIds.has(n.id))
      .map((n) => ({ ...n, section: ADDITIONS }));
    const internal = final.edges.filter((e) => addedIds.has(e.from) && addedIds.has(e.to));
    const spec: DiagramSpec = {
      title: "Additions",
      layout: "architecture",
      sections: [{ id: ADDITIONS, label: "Additions" }],
      nodes,
      edges: internal,
    };
    const built = await diagramToScene(spec, origin);
    for (const e of built.elements as El[]) {
      added.push(e);
      const data = e.customData?.dayboard;
      if (data?.id && e.type !== "frame" && e.type !== "arrow" && data.kind)
        newBoxes.set(data.id, e);
    }
  }

  // The other new connections: between a new box and one that was already there, or between two that were. They are
  // attached by hand, because Excalidraw can only attach arrows to boxes it is converting in the same call.
  const lib = await import("@excalidraw/excalidraw");
  const boxFor = (id: string): El | undefined =>
    newBoxes.get(id) ?? (read.boxes.has(id) ? byId.get(read.boxes.get(id)!) : undefined);
  const wanted = ops.flatMap((op) => (op.op === "addEdge" ? [op.edge] : []));
  for (const edge of wanted) {
    if (addedIds.has(edge.from) && addedIds.has(edge.to)) continue; // drawn with the Additions frame
    const a = boxFor(edge.from);
    const b = boxFor(edge.to);
    if (!a || !b || a.isDeleted || b.isDeleted) continue;
    if (!final.edges.some((e) => e.from === edge.from && e.to === edge.to)) continue;
    const arrow = arrowBetween(
      { x: a.x, y: a.y, w: a.width, h: a.height },
      { x: b.x, y: b.y, w: b.width, h: b.height },
    );
    const skeleton = arrowSkeleton(
      {
        from: edge.from,
        to: edge.to,
        label: edge.label ?? null,
        dashed: Boolean(edge.dashed),
        both: false,
        ...arrow,
      },
      0,
      0,
      false,
    );
    const made = lib.convertToExcalidrawElements([skeleton] as never) as unknown as El[];
    const line = made.find((e) => e.type === "arrow");
    if (!line) continue;
    line.frameId = null;
    line.startBinding = { elementId: a.id, focus: 0, gap: 1 };
    line.endBinding = { elementId: b.id, focus: 0, gap: 1 };
    for (const e of made) if (e.type === "text") e.frameId = null;
    const tie = (box: El) => {
      const next = bump(box, { boundElements: [...boundOf(box), { id: line.id, type: "arrow" }] });
      if (newBoxes.get(box.customData?.dayboard?.id) === box) {
        added[added.indexOf(box)] = next;
        newBoxes.set(box.customData.dayboard.id, next);
      } else replace(next);
      return next;
    };
    tie(a);
    tie(b);
    added.push(...made);
  }

  const kept = [...byId.values()];
  return { elements: [...kept, ...added], added };
}

/**
 * Lays the AI-drawn parts out again, the way a fresh diagram of the same boxes would be, starting where they start now.
 * Only the AI's boxes, frames, arrows and their labels move; a card, a sticky and anything hand-drawn stays exactly where it
 * is. Returns the elements for one `updateScene` (one undo step).
 */
export function arrangeAgain(current: readonly SceneElement[], read: ReadBack): SceneElement[] {
  const spec: DiagramSpec = { ...read.spec, sections: [...read.spec.sections] };
  if (spec.layout === "architecture") {
    // A box in no frame gets a lane of its own, so nothing is left out of the layout.
    const known = new Set(spec.sections.map((s) => s.id));
    const loose = spec.nodes.some((n) => !n.section || !known.has(n.section));
    if (loose) {
      spec.sections.push({ id: "other", label: "Other" });
      spec.nodes = spec.nodes.map((n) =>
        n.section && known.has(n.section) ? n : { ...n, section: "other" },
      );
    }
  }
  const laid = layoutDiagram(spec);

  const byId = new Map<string, El>((current as El[]).map((e) => [e.id, e]));
  const ai = [...read.boxes.values(), ...read.sections.values()]
    .map((id) => byId.get(id))
    .filter((e): e is El => Boolean(e));
  const left = Math.min(...ai.map((e) => e.x));
  const top = Math.min(...ai.map((e) => e.y));
  const textOf = (containerId: string) =>
    [...byId.values()].find(
      (e) => e.type === "text" && e.containerId === containerId && !e.isDeleted,
    );
  const next = new Map<string, El>();

  for (const box of laid.boxes) {
    const el = byId.get(read.boxes.get(box.id) ?? "");
    if (!el) continue;
    const moved = bump(el, { x: box.x + left, y: box.y + top, width: box.w, height: box.h });
    next.set(el.id, moved);
    const label = textOf(el.id);
    if (label) {
      next.set(
        label.id,
        bump(label, {
          x: moved.x + (moved.width - label.width) / 2,
          y: moved.y + (moved.height - label.height) / 2,
        }),
      );
    }
  }
  for (const frame of laid.frames) {
    const el = byId.get(read.sections.get(frame.id) ?? "");
    if (!el) continue;
    next.set(
      el.id,
      bump(el, { x: frame.x + left, y: frame.y + top, width: frame.w, height: frame.h }),
    );
  }
  for (const arrow of laid.arrows) {
    const el = byId.get(read.arrows.get(`${arrow.from}>${arrow.to}`) ?? "");
    if (!el) continue;
    const dx = arrow.x2 - arrow.x1;
    const dy = arrow.y2 - arrow.y1;
    next.set(
      el.id,
      bump(el, {
        x: arrow.x1 + left,
        y: arrow.y1 + top,
        width: Math.abs(dx),
        height: Math.abs(dy),
        points: [
          [0, 0],
          [dx, dy],
        ],
      }),
    );
    const label = textOf(el.id);
    if (label) {
      next.set(
        label.id,
        bump(label, {
          x: arrow.x1 + left + dx / 2 - label.width / 2,
          y: arrow.y1 + top + dy / 2 - label.height / 2,
        }),
      );
    }
  }
  return (current as El[]).map((e) => next.get(e.id) ?? e);
}
