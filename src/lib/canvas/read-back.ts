import {
  DIAGRAM_CAPS,
  DIAGRAM_ID,
  NODE_KINDS,
  type DiagramSpec,
  type NodeKind,
} from "./diagram-spec";
import type { DayboardData, SceneElement } from "./types";

// Reading an AI-drawn diagram back off a canvas (V3 feature 01 §5, §7), for "Refine with AI" and "Arrange again". The
// drawing is the source of truth: what a person moved, renamed or deleted is what the next change starts from. Only parts
// the AI drew count (`customData.dayboard.ai`); a card, a sticky and anything hand-drawn is left alone and left out.
// Pure over plain elements, so the tests need no browser.

export type ReadBack = {
  spec: DiagramSpec;
  /** The canvas element behind each id in `spec`, so a change can be carried to the right shape. */
  boxes: Map<string, string>;
  sections: Map<string, string>;
  /** The arrow behind each connection, keyed `from>to`. */
  arrows: Map<string, string>;
};

const dayboard = (e: SceneElement): DayboardData | undefined =>
  (e.customData as { dayboard?: DayboardData } | undefined)?.dayboard;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const live = (e: SceneElement) => e.isDeleted !== true;
const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);

/** An id that is unique among those taken: a second diagram on one canvas may reuse "api-gateway". */
function unique(wanted: string, taken: Set<string>): string {
  const base = DIAGRAM_ID.test(wanted) ? wanted : "box";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, 32 - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The AI-drawn diagram on a canvas, or null when there is none (a canvas of hand-drawn shapes has nothing to refine). */
export function readDiagram(elements: readonly SceneElement[]): ReadBack | null {
  const all = elements.filter(live);
  const texts = new Map<string, string>();
  for (const e of all) {
    if (e.type === "text" && typeof e.containerId === "string") {
      texts.set(e.containerId, str(e.originalText) || str(e.text));
    }
  }

  const sectionIds = new Set<string>();
  const sectionOf = new Map<string, string>(); // canvas frame id -> section id
  const sections: DiagramSpec["sections"] = [];
  const sectionElements = new Map<string, string>();
  for (const e of all) {
    if (e.type !== "frame" || dayboard(e)?.ai !== true) continue;
    const id = unique(dayboard(e)?.section ?? dayboard(e)?.id ?? "section", sectionIds);
    sectionIds.add(id);
    sectionOf.set(e.id, id);
    sectionElements.set(id, e.id);
    sections.push({ id, label: str(e.name).trim() || "Section" });
  }

  const nodeIds = new Set<string>();
  const nodeOf = new Map<string, string>(); // canvas box id -> node id
  const boxes = new Map<string, string>();
  const nodes: DiagramSpec["nodes"] = [];
  for (const e of all) {
    const data = dayboard(e);
    if (!SHAPES.has(e.type) || data?.ai !== true || !data.kind) continue;
    const lines = (texts.get(e.id) ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    const id = unique(data.id ?? "box", nodeIds);
    nodeIds.add(id);
    nodeOf.set(e.id, id);
    boxes.set(id, e.id);
    const kind: NodeKind = (NODE_KINDS as readonly string[]).includes(data.kind)
      ? (data.kind as NodeKind)
      : "service";
    // The frame a box sits in now wins over the one it was drawn in: a person may have moved it.
    const frame = typeof e.frameId === "string" ? sectionOf.get(e.frameId) : undefined;
    const tech = lines.slice(1).join(", ");
    nodes.push({
      id,
      label: lines[0]!,
      kind,
      ...(tech ? { tech } : {}),
      ...(frame ? { section: frame } : {}),
    });
  }
  if (nodes.length === 0) return null;

  const pairs = new Set<string>();
  const arrows = new Map<string, string>();
  const edges: DiagramSpec["edges"] = [];
  for (const e of all) {
    if (e.type !== "arrow" || dayboard(e)?.ai !== true) continue;
    const start = (e.startBinding as { elementId?: string } | null)?.elementId;
    const end = (e.endBinding as { elementId?: string } | null)?.elementId;
    const from = start ? nodeOf.get(start) : undefined;
    const to = end ? nodeOf.get(end) : undefined;
    if (!from || !to || from === to || pairs.has(`${from}>${to}`)) continue;
    pairs.add(`${from}>${to}`);
    arrows.set(`${from}>${to}`, e.id);
    const label = (texts.get(e.id) ?? "").replace(/\s+/g, " ").trim();
    edges.push({
      from,
      to,
      ...(label ? { label: label.slice(0, DIAGRAM_CAPS.edgeLabel) } : {}),
      ...(e.strokeStyle === "dashed" ? { dashed: true } : {}),
      ...(e.startArrowhead ? { both: true } : {}),
    });
  }

  const used = new Set(nodes.flatMap((n) => (n.section ? [n.section] : [])));
  return {
    spec: {
      title: "Diagram",
      layout: sections.length > 0 ? "architecture" : "flow",
      // A frame with no boxes left in it is not part of the diagram.
      sections: sections.filter((s) => used.has(s.id)),
      nodes: nodes.slice(0, DIAGRAM_CAPS.nodes),
      edges: edges.slice(0, DIAGRAM_CAPS.edges),
    },
    boxes,
    sections: sectionElements,
    arrows,
  };
}
