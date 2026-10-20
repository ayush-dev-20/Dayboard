import type { ColorToken } from "@/lib/colors";
import type { DiagramSpec, NodeKind } from "./diagram-spec";

// Where everything goes (V3 feature 01 §4). The model places nothing: this turns a checked `DiagramSpec` into positions.
// Pure, dependency-free and deterministic (the same spec always gives the same layout, with no randomness). It runs in
// the browser, and in the tests, which hold it to its guarantees: no two boxes overlap, every box is inside its section,
// frames never overlap, the whole diagram fits in 20,000 px, and 60 boxes lay out in well under 100 ms.

export type LayoutBox = {
  id: string;
  label: string;
  tech: string | null;
  note: string | null;
  kind: NodeKind;
  section: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LayoutFrame = {
  id: string;
  label: string;
  tone: ColorToken | null;
  x: number;
  y: number;
  w: number;
  h: number;
  boxIds: string[];
};

export type LayoutArrow = {
  from: string;
  to: string;
  label: string | null;
  dashed: boolean;
  both: boolean;
  /** Start and end on the edges of the two boxes. The arrow is attached to them, so moving a box moves it. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type LaidOut = {
  layout: DiagramSpec["layout"];
  frames: LayoutFrame[];
  boxes: LayoutBox[];
  arrows: LayoutArrow[];
  width: number;
  height: number;
};

export const LAYOUT = {
  minBoxWidth: 160,
  maxBoxWidth: 240,
  minBoxHeight: 64,
  boxGap: 32,
  frameGap: 48,
  framePadding: 24,
  frameTitle: 36,
  flowGap: 80,
  sectionsPerRow: 4,
  maxSide: 20_000,
} as const;

const CHAR = 9; // an estimate of a 16 px label's width per character
const TECH_CHAR = 8;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const length = (text: string | null | undefined) => [...(text ?? "")].length;

/** A box's size, from its words: wide enough for the label or the technology (up to a limit), tall enough for the lines. */
function boxSize(node: { label: string; tech?: string | null }): { w: number; h: number } {
  const text = Math.max(length(node.label) * CHAR, length(node.tech) * TECH_CHAR);
  const w = clamp(Math.ceil(text + 32), LAYOUT.minBoxWidth, LAYOUT.maxBoxWidth);
  const inner = w - 32;
  const labelLines = Math.max(1, Math.ceil((length(node.label) * CHAR) / inner));
  const techLines = node.tech ? Math.ceil((length(node.tech) * TECH_CHAR) / inner) : 0;
  return { w, h: Math.max(LAYOUT.minBoxHeight, 24 + labelLines * 22 + techLines * 18) };
}

/**
 * Ranks by longest path, ignoring back edges found by a depth-first walk in input order (so a cycle is broken at the
 * edge that closes it). Ties keep input order because ids are visited in the order given.
 */
export function rankByLongestPath(
  ids: string[],
  edges: { from: string; to: string }[],
): Map<string, number> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) out.get(edge.from)?.push(edge.to);

  const state = new Map<string, 0 | 1 | 2>(); // 0 = not seen, 1 = on the path, 2 = done
  const forward = new Map<string, string[]>(ids.map((id) => [id, []]));
  const finish: string[] = [];
  // An explicit stack, so a long chain cannot overflow the call stack.
  for (const start of ids) {
    if (state.get(start)) continue;
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    state.set(start, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const targets = out.get(top.id) ?? [];
      if (top.next < targets.length) {
        const to = targets[top.next]!;
        top.next += 1;
        const seen = state.get(to) ?? 0;
        if (seen === 1) continue; // closes a cycle: a back edge, ignored
        forward.get(top.id)!.push(to);
        if (seen === 0) {
          state.set(to, 1);
          stack.push({ id: to, next: 0 });
        }
      } else {
        state.set(top.id, 2);
        finish.push(top.id);
        stack.pop();
      }
    }
  }

  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  // Reverse finishing order is a topological order of the forward edges.
  for (const id of [...finish].reverse()) {
    for (const to of forward.get(id) ?? []) {
      rank.set(to, Math.max(rank.get(to) ?? 0, (rank.get(id) ?? 0) + 1));
    }
  }
  return rank;
}

function arrowBetween(a: LayoutBox, b: LayoutBox) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  const dx = bx - ax;
  const dy = by - ay;
  // The sides that face each other: across when the boxes are further apart sideways than up and down.
  if (Math.abs(dx) >= Math.abs(dy)) {
    const right = dx >= 0;
    return {
      x1: right ? a.x + a.w : a.x,
      y1: ay,
      x2: right ? b.x : b.x + b.w,
      y2: by,
    };
  }
  const down = dy >= 0;
  return {
    x1: ax,
    y1: down ? a.y + a.h : a.y,
    x2: bx,
    y2: down ? b.y : b.y + b.h,
  };
}

function arrowsFor(spec: DiagramSpec, boxes: Map<string, LayoutBox>): LayoutArrow[] {
  return spec.edges.flatMap((edge) => {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) return [];
    return [
      {
        from: edge.from,
        to: edge.to,
        label: edge.label ?? null,
        dashed: Boolean(edge.dashed),
        both: Boolean(edge.both),
        ...arrowBetween(from, to),
      },
    ];
  });
}

function toBox(node: DiagramSpec["nodes"][number], size: { w: number; h: number }): LayoutBox {
  return {
    id: node.id,
    label: node.label,
    tech: node.tech ?? null,
    note: node.note ?? null,
    kind: node.kind,
    section: node.section ?? null,
    x: 0,
    y: 0,
    ...size,
  };
}

function layoutArchitecture(spec: DiagramSpec): LaidOut {
  const sectionOf = new Map(spec.nodes.map((n) => [n.id, n.section ?? ""]));
  const sectionIds = spec.sections.map((s) => s.id);

  // 1. Order the sections by rank: how far along the connections between sections each one is.
  const crossing = spec.edges
    .map((e) => ({ from: sectionOf.get(e.from) ?? "", to: sectionOf.get(e.to) ?? "" }))
    .filter((e) => e.from !== e.to && e.from !== "" && e.to !== "");
  const rank = rankByLongestPath(sectionIds, crossing);
  const order = spec.sections
    .map((section, index) => ({ section, index, rank: rank.get(section.id) ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.section);

  // 2 and 4. Each section: its boxes in input order, in one, two or three columns, inside a padded frame.
  type Prepared = {
    frame: LayoutFrame;
    boxes: LayoutBox[];
  };
  const prepared: Prepared[] = order.map((section) => {
    const members = spec.nodes.filter((n) => n.section === section.id);
    const sized = members.map((n) => toBox(n, boxSize(n)));
    const columns = sized.length <= 4 ? 1 : sized.length <= 8 ? 2 : 3;
    const rows = Math.max(1, Math.ceil(sized.length / columns));
    const columnWidth = sized.reduce<number>((max, b) => Math.max(max, b.w), LAYOUT.minBoxWidth);
    const rowHeights: number[] = Array.from({ length: rows }, (_, r) =>
      sized
        .filter((_, i) => i % rows === r)
        .reduce<number>((max, b) => Math.max(max, b.h), LAYOUT.minBoxHeight),
    );
    const innerWidth = columns * columnWidth + (columns - 1) * LAYOUT.boxGap;
    const innerHeight = rowHeights.reduce((sum, h) => sum + h, 0) + (rows - 1) * LAYOUT.boxGap;
    const frame: LayoutFrame = {
      id: section.id,
      label: section.label,
      tone: section.tone ?? null,
      x: 0,
      y: 0,
      w: innerWidth + 2 * LAYOUT.framePadding,
      h: LAYOUT.frameTitle + innerHeight + 2 * LAYOUT.framePadding,
      boxIds: sized.map((b) => b.id),
    };
    // Fill a column from the top, then the next column.
    sized.forEach((box, i) => {
      const column = Math.floor(i / rows);
      const row = i % rows;
      box.x = LAYOUT.framePadding + column * (columnWidth + LAYOUT.boxGap);
      box.y =
        LAYOUT.frameTitle +
        LAYOUT.framePadding +
        rowHeights.slice(0, row).reduce((sum, h) => sum + h + LAYOUT.boxGap, 0);
      // Centre a box that is narrower than its column.
      box.x += Math.floor((columnWidth - box.w) / 2);
    });
    return { frame, boxes: sized };
  });

  // 3. Frames left to right, four to a row, then the next row.
  let y = 0;
  let width = 0;
  const frames: LayoutFrame[] = [];
  const boxes: LayoutBox[] = [];
  for (let start = 0; start < prepared.length; start += LAYOUT.sectionsPerRow) {
    const row = prepared.slice(start, start + LAYOUT.sectionsPerRow);
    let x = 0;
    for (const { frame, boxes: members } of row) {
      frame.x = x;
      frame.y = y;
      for (const box of members) {
        box.x += x;
        box.y += y;
        boxes.push(box);
      }
      frames.push(frame);
      x += frame.w + LAYOUT.frameGap;
    }
    width = Math.max(width, x - LAYOUT.frameGap);
    y += Math.max(...row.map((p) => p.frame.h)) + LAYOUT.frameGap;
  }
  const height = Math.max(0, y - LAYOUT.frameGap);

  const byId = new Map(boxes.map((b) => [b.id, b]));
  return { layout: "architecture", frames, boxes, arrows: arrowsFor(spec, byId), width, height };
}

function layoutFlow(spec: DiagramSpec, direction: "horizontal" | "vertical"): LaidOut {
  const ids = spec.nodes.map((n) => n.id);
  const rank = rankByLongestPath(ids, spec.edges);
  const sized = spec.nodes.map((n) => toBox(n, boxSize(n)));

  const ranks = new Map<number, LayoutBox[]>();
  for (const box of sized) {
    const r = rank.get(box.id) ?? 0;
    ranks.set(r, [...(ranks.get(r) ?? []), box]);
  }
  const levels = [...ranks.keys()].sort((a, b) => a - b);

  // A rank is a column (or a row, when the page is turned); its boxes stack in input order, centred on each other.
  const horizontal = direction === "horizontal";
  const across = (b: LayoutBox) => (horizontal ? b.w : b.h);
  const along = (b: LayoutBox) => (horizontal ? b.h : b.w);
  const stackLengths = levels.map((level) => {
    const members = ranks.get(level)!;
    return members.reduce((sum, b) => sum + along(b), 0) + (members.length - 1) * LAYOUT.flowGap;
  });
  const longest = Math.max(...stackLengths);

  let cursor = 0;
  let width = 0;
  let height = 0;
  levels.forEach((level, i) => {
    const members = ranks.get(level)!;
    const thickness = Math.max(...members.map(across));
    let offset = Math.floor((longest - stackLengths[i]!) / 2);
    for (const box of members) {
      if (horizontal) {
        box.x = cursor + Math.floor((thickness - box.w) / 2);
        box.y = offset;
      } else {
        box.y = cursor + Math.floor((thickness - box.h) / 2);
        box.x = offset;
      }
      offset += along(box) + LAYOUT.flowGap;
      width = Math.max(width, box.x + box.w);
      height = Math.max(height, box.y + box.h);
    }
    cursor += thickness + LAYOUT.flowGap;
  });

  const byId = new Map(sized.map((b) => [b.id, b]));
  return { layout: "flow", frames: [], boxes: sized, arrows: arrowsFor(spec, byId), width, height };
}

/** Lays out a checked diagram. `direction` turns a flow's page (columns or rows); an architecture ignores it. */
export function layoutDiagram(
  spec: DiagramSpec,
  options: { direction?: "horizontal" | "vertical" } = {},
): LaidOut {
  return spec.layout === "flow"
    ? layoutFlow(spec, options.direction ?? "horizontal")
    : layoutArchitecture(spec);
}
