import type { DiagramSpec } from "@/lib/canvas/diagram-spec";
import { layoutDiagram } from "@/lib/canvas/layout";
import { buildDiagramSkeletons } from "@/lib/canvas/scene-builder";
import type { SceneElement } from "@/lib/canvas/types";

// The browser's half of "Draw with AI" (V3 feature 01 §5): lay the checked diagram out, build element skeletons, and let
// Excalidraw turn them into real elements (it measures the text and attaches each arrow to its two boxes). Excalidraw
// is imported here and nowhere in the server's code; it is already loaded when a preview is on screen.

export type DiagramScene = {
  /** Full Excalidraw elements, ready for a read-only preview or `updateScene`. */
  elements: SceneElement[];
  width: number;
  height: number;
};

export async function diagramToScene(
  spec: DiagramSpec,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): Promise<DiagramScene> {
  const lib = await import("@excalidraw/excalidraw");
  const laid = layoutDiagram(spec);
  const { skeletons } = buildDiagramSkeletons(laid, { offsetX: origin.x, offsetY: origin.y });
  // Ids are made fresh, so adding a diagram twice to one canvas never repeats an id.
  const converted = lib.convertToExcalidrawElements(
    skeletons as never,
  ) as unknown as SceneElement[];
  // An arrow between two sections belongs to neither: Excalidraw would clip it to the frame it started in.
  const arrowIds = new Set(converted.filter((e) => e.type === "arrow").map((e) => e.id));
  const elements = converted.map((e) =>
    e.type === "arrow" || (e.type === "text" && arrowIds.has(String(e.containerId)))
      ? { ...e, frameId: null }
      : e,
  );
  return { elements, width: laid.width, height: laid.height };
}

/** The counts the audit row is built from: sections, boxes and connections of what the person confirmed. */
export function diagramCounts(spec: DiagramSpec) {
  return {
    sections: spec.sections.length,
    boxes: spec.nodes.length,
    connections: spec.edges.length,
  };
}
