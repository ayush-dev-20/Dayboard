import { describe, expect, it } from "vitest";
import type { DiagramSpec } from "@/lib/canvas/diagram-spec";
import { layoutDiagram } from "@/lib/canvas/layout";
import { readDiagram } from "@/lib/canvas/read-back";
import { buildDiagramSkeletons } from "@/lib/canvas/scene-builder";
import type { SceneElement } from "@/lib/canvas/types";

// Turns the skeletons into the elements Excalidraw would make (a bound text per label, arrows bound to boxes) without a
// browser, so reading a diagram back off a canvas can be checked: what was drawn is what is read.

const spec: DiagramSpec = {
  title: "Shop",
  layout: "architecture",
  sections: [
    { id: "edge", label: "Edge" },
    { id: "services", label: "Services" },
  ],
  nodes: [
    { id: "api", label: "API gateway", kind: "gateway", tech: "Kong", section: "edge" },
    { id: "orders", label: "Order service", kind: "service", tech: "Node.js", section: "services" },
    { id: "bus", label: "Order events", kind: "queue", tech: "Kafka", section: "services" },
  ],
  edges: [
    { from: "api", to: "orders", label: "place order" },
    { from: "orders", to: "bus", label: "order placed", dashed: true },
  ],
};

function draw(source: DiagramSpec, suffix = ""): SceneElement[] {
  const { skeletons } = buildDiagramSkeletons(layoutDiagram(source));
  const out: SceneElement[] = [];
  for (const s of skeletons) {
    const { label, ...rest } = s as { label?: { text: string } } & Record<string, unknown>;
    const id = `${String(rest.id)}${suffix}`;
    const rename = (v: unknown) => (typeof v === "string" ? `${v}${suffix}` : v);
    const element = {
      ...rest,
      id,
      frameId: null,
      ...(rest.start
        ? { startBinding: { elementId: rename((rest.start as { id: string }).id) } }
        : {}),
      ...(rest.end ? { endBinding: { elementId: rename((rest.end as { id: string }).id) } } : {}),
      ...(rest.type === "arrow" && rest.startArrowhead ? { startArrowhead: "arrow" } : {}),
    } as unknown as SceneElement;
    out.push(element);
    if (label) {
      out.push({
        id: `${id}-text`,
        type: "text",
        containerId: id,
        text: label.text,
        originalText: label.text,
      });
    }
  }
  // Frame membership as Excalidraw keeps it: a box names its frame.
  for (const s of skeletons) {
    if (s.type !== "frame") continue;
    for (const child of (s as unknown as { children: string[] }).children) {
      const box = out.find((e) => e.id === `${child}${suffix}`);
      if (box) box.frameId = `${String(s.id)}${suffix}`;
    }
  }
  return out;
}

describe("readDiagram", () => {
  it("reads back what was drawn: sections, boxes with their technology, and connections with their words", () => {
    const read = readDiagram(draw(spec))!;
    expect(read.spec.layout).toBe("architecture");
    expect(read.spec.sections.map((s) => s.label)).toEqual(["Edge", "Services"]);
    expect(read.spec.nodes).toEqual([
      { id: "api", label: "API gateway", kind: "gateway", tech: "Kong", section: "edge" },
      {
        id: "orders",
        label: "Order service",
        kind: "service",
        tech: "Node.js",
        section: "services",
      },
      { id: "bus", label: "Order events", kind: "queue", tech: "Kafka", section: "services" },
    ]);
    expect(read.spec.edges).toEqual([
      { from: "api", to: "orders", label: "place order" },
      { from: "orders", to: "bus", label: "order placed", dashed: true },
    ]);
    expect(read.boxes.get("orders")).toBe("box-orders");
  });

  it("leaves out what a person deleted, and a frame with nothing left in it", () => {
    const elements = draw(spec).map((e) =>
      e.id === "box-api" || e.id === "box-api-text" ? { ...e, isDeleted: true } : e,
    );
    const read = readDiagram(elements)!;
    expect(read.spec.nodes.map((n) => n.id)).toEqual(["orders", "bus"]);
    expect(read.spec.sections.map((s) => s.id)).toEqual(["services"]);
    // The arrow that started at the deleted box is not a connection any more.
    expect(read.spec.edges).toEqual([
      { from: "orders", to: "bus", label: "order placed", dashed: true },
    ]);
  });

  it("follows a box a person moved into another frame", () => {
    const elements = draw(spec).map((e) =>
      e.id === "box-orders" ? { ...e, frameId: "frame-edge" } : e,
    );
    const read = readDiagram(elements)!;
    expect(read.spec.nodes.find((n) => n.id === "orders")?.section).toBe("edge");
  });

  it("keeps two diagrams on one canvas apart even when both used the same ids", () => {
    const read = readDiagram([...draw(spec), ...draw(spec, "-2")])!;
    expect(read.spec.nodes.map((n) => n.id)).toEqual([
      "api",
      "orders",
      "bus",
      "api-2",
      "orders-2",
      "bus-2",
    ]);
    expect(read.spec.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      "api>orders",
      "orders>bus",
      "api-2>orders-2",
      "orders-2>bus-2",
    ]);
  });

  it("ignores cards and hand-drawn shapes, and finds nothing on a canvas without an AI diagram", () => {
    const hand = [
      { id: "r1", type: "rectangle", x: 0, y: 0 },
      { id: "t1", type: "text", containerId: "r1", text: "My idea" },
      {
        id: "card",
        type: "rectangle",
        customData: { dayboard: { ref: { type: "note", id: "n1" } } },
      },
    ] as SceneElement[];
    expect(readDiagram(hand)).toBeNull();
    expect(readDiagram([])).toBeNull();
    expect(readDiagram([...draw(spec), ...hand])!.spec.nodes).toHaveLength(3);
  });
});
