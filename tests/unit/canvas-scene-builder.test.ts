import { describe, expect, it } from "vitest";
import { sanitizeScene } from "@/lib/canvas/schema";
import {
  boxId,
  buildDiagramSkeletons,
  frameId,
  KIND_STYLE,
  TONES,
} from "@/lib/canvas/scene-builder";
import { layoutDiagram } from "@/lib/canvas/layout";
import { NODE_KINDS, type DiagramSpec } from "@/lib/canvas/diagram-spec";

const spec: DiagramSpec = {
  title: "Orders",
  layout: "architecture",
  sections: [
    { id: "services", label: "Services", tone: "blue" },
    { id: "data", label: "Data" },
  ],
  nodes: [
    { id: "orders", label: "Order service", kind: "service", tech: "Node.js", section: "services" },
    { id: "db", label: "Orders DB", kind: "database", tech: "PostgreSQL", section: "data" },
    { id: "cache", label: "Cache", kind: "cache", tech: "Redis", section: "data" },
    { id: "stripe", label: "Payments", kind: "external", section: "data" },
  ],
  edges: [
    { from: "orders", to: "db", label: "writes orders" },
    { from: "orders", to: "cache", dashed: true },
    { from: "orders", to: "stripe", both: true },
  ],
};

const built = buildDiagramSkeletons(layoutDiagram(spec));
const byId = new Map(built.skeletons.map((s) => [s.id, s]));
const arrows = built.skeletons.filter((s) => s.type === "arrow");

describe("the skeletons of a diagram", () => {
  it("make a frame per section, a shape per box and an arrow per connection", () => {
    expect(built.skeletons.filter((s) => s.type === "frame")).toHaveLength(2);
    expect(built.skeletons.filter((s) => s.type === "rectangle")).toHaveLength(4);
    expect(arrows).toHaveLength(3);
  });

  it("attach every arrow to two boxes that are in the output", () => {
    for (const arrow of arrows) {
      const start = (arrow.start as { id: string }).id;
      const end = (arrow.end as { id: string }).id;
      expect(byId.has(start), start).toBe(true);
      expect(byId.has(end), end).toBe(true);
      expect(byId.get(start)!.type).not.toBe("arrow");
    }
    expect(
      arrows.map((a) => [(a.start as { id: string }).id, (a.end as { id: string }).id]),
    ).toEqual([
      [boxId("orders"), boxId("db")],
      [boxId("orders"), boxId("cache")],
      [boxId("orders"), boxId("stripe")],
    ]);
  });

  it("list their children on each frame, and every child exists", () => {
    const frame = byId.get(frameId("data"))!;
    expect(frame.children).toEqual([boxId("db"), boxId("cache"), boxId("stripe")]);
    for (const child of frame.children as string[]) expect(byId.has(child)).toBe(true);
    expect(frame.name).toBe("Data");
  });

  it("name the box and its technology on two lines, so colour is never the only signal", () => {
    expect((byId.get(boxId("orders"))!.label as { text: string }).text).toBe(
      "Order service\nNode.js",
    );
    expect((byId.get(boxId("stripe"))!.label as { text: string }).text).toBe("Payments");
  });

  it("colour by kind: a database teal, a cache amber, an outside system slate and dashed, a section's tone for the rest", () => {
    expect(byId.get(boxId("db"))!.strokeColor).toBe(TONES.teal.stroke);
    expect(byId.get(boxId("cache"))!.strokeColor).toBe(TONES.amber.stroke);
    expect(byId.get(boxId("stripe"))).toMatchObject({
      strokeColor: TONES.slate.stroke,
      strokeStyle: "dashed",
    });
    expect(byId.get(boxId("orders"))!.strokeColor).toBe(TONES.blue.stroke);
    expect(KIND_STYLE.gateway.tone).toBe("blue");
    expect(KIND_STYLE.queue.tone).toBe("violet");
    for (const kind of NODE_KINDS) expect(KIND_STYLE[kind]).toBeDefined();
  });

  it("draw a decision as a diamond and a start or end as an ellipse", () => {
    const flow = buildDiagramSkeletons(
      layoutDiagram({
        title: "Flow",
        layout: "flow",
        sections: [],
        nodes: [
          { id: "go", label: "Start", kind: "start-end" },
          { id: "ok", label: "Paid?", kind: "decision" },
        ],
        edges: [{ from: "go", to: "ok" }],
      }),
    );
    expect(flow.skeletons.map((s) => s.type)).toEqual(["ellipse", "diamond", "arrow"]);
  });

  it("carry customData.dayboard on every element, marked as AI-drawn", () => {
    for (const s of built.skeletons) {
      const data = (s.customData as { dayboard?: { ai?: boolean } }).dayboard;
      expect(data?.ai, s.id).toBe(true);
    }
    expect(byId.get(boxId("db"))!.customData).toEqual({
      dayboard: { id: "db", kind: "database", section: "data", ai: true },
    });
  });

  it("give dashed and two-way arrows their style, and a label to the one that has one", () => {
    expect(arrows[1]).toMatchObject({ strokeStyle: "dashed" });
    expect(arrows[2]).toMatchObject({ startArrowhead: "arrow", endArrowhead: "arrow" });
    expect(arrows[0]!.startArrowhead).toBeNull();
    expect((arrows[0]!.label as { text: string }).text).toBe("writes orders");
    expect(arrows[1]!.label).toBeUndefined();
  });

  it("move everything by an offset, for 'Add to this canvas'", () => {
    const moved = buildDiagramSkeletons(layoutDiagram(spec), { offsetX: 1000, offsetY: 500 });
    expect(moved.skeletons[0]!.x - built.skeletons[0]!.x).toBe(1000);
    expect(moved.skeletons[0]!.y - built.skeletons[0]!.y).toBe(500);
    expect(moved.bounds).toMatchObject({ x: 1000, y: 500 });
  });

  it("give ids the scene check accepts", () => {
    // What Excalidraw makes from these still carries the ids and customData, so the saved scene passes the whitelist.
    const elements = built.skeletons.map((s) => ({
      ...s,
      label: undefined,
      start: undefined,
      end: undefined,
      children: undefined,
      points: undefined,
      version: 1,
    }));
    const clean = sanitizeScene({
      v: 1,
      elements: elements.filter((e) => e.type !== "arrow"),
      appState: {},
    });
    expect(clean.elements).toHaveLength(6);
    const data = clean.elements.map(
      (e) => (e.customData as { dayboard?: unknown } | undefined)?.dayboard,
    );
    expect(data.every(Boolean)).toBe(true);
  });
});
