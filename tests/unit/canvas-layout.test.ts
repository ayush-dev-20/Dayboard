import { describe, expect, it } from "vitest";
import { normalizeDiagram, type DiagramSpec, type RawDiagram } from "@/lib/canvas/diagram-spec";
import { layoutDiagram, LAYOUT, rankByLongestPath, type LaidOut } from "@/lib/canvas/layout";

const node = (id: string, section?: string, label = id): DiagramSpec["nodes"][number] => ({
  id,
  label,
  kind: "service",
  ...(section ? { section } : {}),
});

function architecture(
  sections: string[],
  nodes: DiagramSpec["nodes"],
  edges: DiagramSpec["edges"] = [],
): DiagramSpec {
  return {
    title: "T",
    layout: "architecture",
    sections: sections.map((id) => ({ id, label: id })),
    nodes,
    edges,
  };
}

const flow = (nodes: string[], edges: [string, string][]): DiagramSpec => ({
  title: "Flow",
  layout: "flow",
  sections: [],
  nodes: nodes.map((id) => node(id)),
  edges: edges.map(([from, to]) => ({ from, to })),
});

const overlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function checkGuarantees(out: LaidOut) {
  // No two boxes overlap.
  for (let i = 0; i < out.boxes.length; i++) {
    for (let j = i + 1; j < out.boxes.length; j++) {
      expect(
        overlap(out.boxes[i]!, out.boxes[j]!),
        `${out.boxes[i]!.id} and ${out.boxes[j]!.id}`,
      ).toBe(false);
    }
  }
  // Every box is inside its section's frame; frames never overlap.
  for (const frame of out.frames) {
    for (const id of frame.boxIds) {
      const box = out.boxes.find((b) => b.id === id)!;
      expect(box.x).toBeGreaterThanOrEqual(frame.x + LAYOUT.framePadding);
      expect(box.y).toBeGreaterThanOrEqual(frame.y + LAYOUT.frameTitle);
      expect(box.x + box.w).toBeLessThanOrEqual(frame.x + frame.w - LAYOUT.framePadding);
      expect(box.y + box.h).toBeLessThanOrEqual(frame.y + frame.h - LAYOUT.framePadding);
    }
  }
  for (let i = 0; i < out.frames.length; i++) {
    for (let j = i + 1; j < out.frames.length; j++) {
      expect(overlap(out.frames[i]!, out.frames[j]!), `frames ${i} and ${j}`).toBe(false);
    }
  }
  // It fits, and every box has a size within the limits.
  expect(out.width).toBeLessThanOrEqual(LAYOUT.maxSide);
  expect(out.height).toBeLessThanOrEqual(LAYOUT.maxSide);
  for (const b of out.boxes) {
    expect(b.w).toBeGreaterThanOrEqual(LAYOUT.minBoxWidth);
    expect(b.w).toBeLessThanOrEqual(LAYOUT.maxBoxWidth);
    expect(b.h).toBeGreaterThanOrEqual(LAYOUT.minBoxHeight);
  }
  // Every arrow starts and ends on a box that exists.
  const ids = new Set(out.boxes.map((b) => b.id));
  for (const a of out.arrows) {
    expect(ids.has(a.from) && ids.has(a.to)).toBe(true);
  }
}

describe("ranking", () => {
  it("is the longest path, with back edges ignored and input order kept for ties", () => {
    const rank = rankByLongestPath(
      ["a", "b", "c", "d"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "c" },
        { from: "c", to: "a" }, // closes a cycle: ignored
      ],
    );
    expect([...rank.entries()]).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 0],
    ]);
  });

  it("handles a self-contained chain of ten thousand without overflowing", () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => `n${i}`);
    const edges = ids.slice(1).map((id, i) => ({ from: ids[i]!, to: id }));
    expect(rankByLongestPath(ids, edges).get("n9999")).toBe(9_999);
  });
});

describe("an architecture", () => {
  it("puts sections in order of the connections between them, four to a row", () => {
    const spec = architecture(
      ["data", "clients", "services", "edge", "external", "queue"],
      ["data", "clients", "services", "edge", "external", "queue"].map((s) => node(`${s}-box`, s)),
      [
        { from: "clients-box", to: "edge-box" },
        { from: "edge-box", to: "services-box" },
        { from: "services-box", to: "data-box" },
        { from: "services-box", to: "external-box" },
      ],
    );
    const out = layoutDiagram(spec);
    // clients(0) edge(1) services(2) data(3) external(3) queue(0 with no connections): by rank, then input order.
    expect(out.frames.map((f) => f.id)).toEqual([
      "clients",
      "queue",
      "edge",
      "services",
      "data",
      "external",
    ]);
    const rows = [...new Set(out.frames.map((f) => f.y))];
    expect(rows).toHaveLength(2);
    expect(out.frames.filter((f) => f.y === rows[0])).toHaveLength(4);
    checkGuarantees(out);
  });

  it("fills a section with one, two or three columns by how many boxes it has", () => {
    const boxesIn = (n: number) => Array.from({ length: n }, (_, i) => node(`b${i}`, "s"));
    const columnsOf = (n: number) =>
      new Set(layoutDiagram(architecture(["s"], boxesIn(n))).boxes.map((b) => b.x)).size;
    expect([1, 4].map(columnsOf)).toEqual([1, 1]);
    expect([5, 8].map(columnsOf)).toEqual([2, 2]);
    expect([9, 20].map(columnsOf)).toEqual([3, 3]);
  });

  it("is deterministic: the same spec gives the same layout", () => {
    const spec = architecture(
      ["a", "b"],
      [node("x", "a"), node("y", "b"), node("z", "b")],
      [
        { from: "x", to: "y" },
        { from: "y", to: "z" },
      ],
    );
    expect(JSON.stringify(layoutDiagram(spec))).toBe(
      JSON.stringify(layoutDiagram(structuredClone(spec))),
    );
  });

  it("copes with a cycle, a single box, disconnected groups and a section with no boxes", () => {
    const cycle = architecture(
      ["a", "b"],
      [node("x", "a"), node("y", "b")],
      [
        { from: "x", to: "y" },
        { from: "y", to: "x" },
      ],
    );
    checkGuarantees(layoutDiagram(cycle));
    const single = layoutDiagram(architecture(["a"], [node("only", "a")]));
    expect(single.boxes).toHaveLength(1);
    checkGuarantees(single);
    const groups = architecture(
      ["a", "b", "c"],
      [node("a1", "a"), node("b1", "b"), node("c1", "c")],
    );
    checkGuarantees(layoutDiagram(groups));
    const empty = layoutDiagram(architecture(["a", "empty"], [node("a1", "a")]));
    expect(empty.frames).toHaveLength(2);
    checkGuarantees(empty);
  });

  it("wraps thirteen sections onto a fourth row without overlapping", () => {
    const sections = Array.from({ length: 13 }, (_, i) => `s${i}`);
    const out = layoutDiagram(
      architecture(
        sections,
        sections.map((s) => node(`${s}-box`, s)),
      ),
    );
    expect(new Set(out.frames.map((f) => f.y)).size).toBe(4);
    checkGuarantees(out);
  });

  it("makes room for very long labels and technologies", () => {
    const long = "x".repeat(200);
    const spec = architecture(
      ["a"],
      [{ ...node("one", "a", long), tech: long }, node("two", "a", "short")],
    );
    const out = layoutDiagram(spec);
    expect(out.boxes[0]!.w).toBe(LAYOUT.maxBoxWidth);
    expect(out.boxes[0]!.h).toBeGreaterThan(LAYOUT.minBoxHeight);
    checkGuarantees(out);
  });

  it("lays out sixty boxes, in a hundred connections, in under 100 ms", () => {
    const sections = ["a", "b", "c", "d", "e", "f"];
    const nodes = Array.from({ length: 60 }, (_, i) =>
      node(`n${i}`, sections[i % 6], `Service number ${i}`),
    );
    const edges = Array.from({ length: 100 }, (_, i) => ({
      from: `n${i % 60}`,
      to: `n${(i * 7 + 3) % 60}`,
    })).filter((e) => e.from !== e.to);
    const spec = architecture(sections, nodes, edges);
    layoutDiagram(spec); // warm
    const started = performance.now();
    const out = layoutDiagram(spec);
    expect(performance.now() - started).toBeLessThan(100);
    expect(out.boxes).toHaveLength(60);
    checkGuarantees(out);
  });

  it("attaches each arrow to the facing sides of its two boxes", () => {
    const spec = architecture(
      ["a", "b"],
      [node("left", "a"), node("right", "b")],
      [{ from: "left", to: "right", label: "SQL", dashed: true, both: true }],
    );
    const out = layoutDiagram(spec);
    const [left, right] = [out.boxes[0]!, out.boxes[1]!];
    const arrow = out.arrows[0]!;
    expect(arrow).toMatchObject({ label: "SQL", dashed: true, both: true });
    expect(arrow.x1).toBe(left.x + left.w);
    expect(arrow.x2).toBe(right.x);
    expect(arrow.y1).toBe(left.y + left.h / 2);
  });
});

describe("a flow", () => {
  it("ranks into columns, stacks a rank, and breaks a cycle at its closing edge", () => {
    const out = layoutDiagram(
      flow(
        ["start", "check", "pay", "retry", "done"],
        [
          ["start", "check"],
          ["check", "pay"],
          ["pay", "retry"],
          ["retry", "pay"],
          ["pay", "done"],
          ["check", "retry"],
        ],
      ),
    );
    const x = (id: string) => out.boxes.find((b) => b.id === id)!.x;
    expect(x("start")).toBeLessThan(x("check"));
    expect(x("check")).toBeLessThan(x("pay"));
    expect(out.frames).toEqual([]);
    checkGuarantees(out);
  });

  it("can turn the page: ranks become rows", () => {
    const spec = flow(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["b", "c"],
      ],
    );
    const across = layoutDiagram(spec, { direction: "horizontal" });
    const down = layoutDiagram(spec, { direction: "vertical" });
    expect(across.boxes.map((b) => b.y)).toEqual([
      across.boxes[0]!.y,
      across.boxes[0]!.y,
      across.boxes[0]!.y,
    ]);
    expect(down.boxes.map((b) => b.y)[0]).toBeLessThan(down.boxes.map((b) => b.y)[1]!);
    checkGuarantees(down);
  });

  it("keeps a single box and disconnected boxes apart", () => {
    checkGuarantees(layoutDiagram(flow(["only"], [])));
    const out = layoutDiagram(flow(["a", "b", "c", "d"], [["a", "b"]]));
    expect(out.boxes).toHaveLength(4);
    checkGuarantees(out);
  });
});

describe("what the model returns goes through the checks before it is laid out", () => {
  it("lays out a normalized diagram with the dropped parts gone", () => {
    const raw: RawDiagram = {
      title: "x",
      layout: "architecture",
      sections: [{ id: "svc", label: "Services" }],
      nodes: [
        { id: "a", label: "A", kind: "service", section: "svc" },
        { id: "b", label: "B", kind: "database" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "ghost" },
      ],
    };
    const { spec } = normalizeDiagram(raw);
    const out = layoutDiagram(spec);
    expect(out.arrows).toHaveLength(1);
    expect(out.frames.map((f) => f.id)).toEqual(["svc", "other"]);
    checkGuarantees(out);
  });
});
