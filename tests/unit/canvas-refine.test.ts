import { describe, expect, it } from "vitest";
import type { DiagramSpec } from "@/lib/canvas/diagram-spec";
import { applyRefine, describeRefine, describeRefineApplied } from "@/lib/canvas/refine";

const spec: DiagramSpec = {
  title: "Shop",
  layout: "architecture",
  sections: [{ id: "services", label: "Services" }],
  nodes: [
    { id: "api", label: "API", kind: "gateway", tech: "Kong", section: "services" },
    { id: "orders", label: "Order service", kind: "service", tech: "Node.js", section: "services" },
    {
      id: "db",
      label: "Orders database",
      kind: "database",
      tech: "PostgreSQL",
      section: "services",
    },
  ],
  edges: [
    { from: "api", to: "orders", label: "place order" },
    { from: "orders", to: "db", label: "SQL" },
  ],
};

describe("applyRefine", () => {
  it("adds a box and the connection it needs, and says so in words it wrote itself", () => {
    const result = applyRefine(spec, {
      ops: [
        { op: "addNode", id: "cache", label: "Cache", kind: "cache", tech: "Redis" },
        { op: "addEdge", from: "orders", to: "cache", label: "reads, writes" },
      ],
    });
    expect(result.summary).toBe("Adds 1 box and 1 connection");
    expect(result.warnings).toEqual([]);
    expect(result.spec.nodes.map((n) => n.id)).toEqual(["api", "orders", "db", "cache"]);
    expect(result.spec.edges).toHaveLength(3);
    expect(result.ops.map((o) => o.op)).toEqual(["addNode", "addEdge"]);
  });

  it("leaves out a change to a box that is not there, a repeated connection and a taken id, and says why", () => {
    const result = applyRefine(spec, {
      ops: [
        { op: "addEdge", from: "orders", to: "ghost" },
        { op: "addEdge", from: "api", to: "orders" },
        { op: "addNode", id: "db", label: "Another database", kind: "database" },
        { op: "updateNode", id: "ghost", label: "Nope" },
        { op: "removeEdge", from: "db", to: "api" },
      ],
    });
    expect(result.ops).toEqual([]);
    expect(result.summary).toBe("Nothing to change");
    expect(result.warnings).toEqual([
      "3 changes were left out because they named boxes or connections that aren't in the diagram.",
      "1 new box was left out because its id was already used.",
      "1 connection was left out because it is already in the diagram.",
    ]);
  });

  it("renames a box, counts one changed label, and ignores a rename to the same words", () => {
    const result = applyRefine(spec, {
      ops: [
        { op: "updateNode", id: "orders", label: "Checkout service" },
        { op: "updateNode", id: "api", label: "API" },
      ],
    });
    expect(result.summary).toBe("Changes 1 label");
    expect(result.spec.nodes.find((n) => n.id === "orders")?.label).toBe("Checkout service");
    expect(result.ops).toEqual([{ op: "updateNode", id: "orders", label: "Checkout service" }]);
    expect(result.warnings.join(" ")).toMatch(/change nothing/);
  });

  it("removes a box with its connections, and counts both", () => {
    const result = applyRefine(spec, { ops: [{ op: "removeNode", id: "db" }] });
    expect(result.summary).toBe("Removes 1 box and 1 connection");
    expect(result.spec.nodes.map((n) => n.id)).toEqual(["api", "orders"]);
    expect(result.spec.edges).toEqual([{ from: "api", to: "orders", label: "place order" }]);
  });

  it("never removes the last box", () => {
    const one: DiagramSpec = { ...spec, nodes: [spec.nodes[0]!], edges: [] };
    const result = applyRefine(one, { ops: [{ op: "removeNode", id: "api" }] });
    expect(result.ops).toEqual([]);
    expect(result.spec.nodes).toHaveLength(1);
  });

  it("warns about a new box with no connection, and about a change it does not know", () => {
    const result = applyRefine(spec, {
      ops: [
        { op: "addNode", id: "audit", label: "Audit log", kind: "nonsense" },
        { op: "repaint", id: "api" },
      ],
    });
    expect(result.spec.nodes.at(-1)).toMatchObject({ id: "audit", kind: "service" });
    expect(result.warnings.join(" ")).toMatch(/don't know how to make it/);
    expect(result.warnings.join(" ")).toMatch(/1 new box has no connection/);
  });

  it("cleans the text the model wrote and refuses ids a connection could not name", () => {
    const result = applyRefine(spec, {
      ops: [
        { op: "addNode", id: "Bad Id", label: "x", kind: "service" },
        {
          op: "addNode",
          id: "ok",
          label: "**Bold** [link](https://evil.example)",
          kind: "service",
        },
      ],
    });
    expect(result.spec.nodes.map((n) => n.id)).toEqual(["api", "orders", "db", "ok"]);
    expect(result.spec.nodes.at(-1)?.label).not.toMatch(/https?:|\*/);
  });

  it("takes at most 40 changes in one request", () => {
    const ops = Array.from({ length: 45 }, (_, i) => ({
      op: "addNode",
      id: `n${i}`,
      label: `Box ${i}`,
      kind: "service",
    }));
    const result = applyRefine(spec, { ops });
    expect(result.counts.addedBoxes).toBe(40);
    expect(result.warnings.join(" ")).toMatch(/at most 40/);
  });

  it("does not change the diagram it was given", () => {
    const before = JSON.stringify(spec);
    applyRefine(spec, {
      ops: [
        { op: "removeNode", id: "db" },
        { op: "updateNode", id: "api", label: "Edge" },
      ],
    });
    expect(JSON.stringify(spec)).toBe(before);
  });
});

describe("describing a refine", () => {
  it("reads like a sentence and is numbers only", () => {
    expect(
      describeRefine({
        addedBoxes: 1,
        addedConnections: 2,
        changedBoxes: 1,
        removedBoxes: 0,
        removedConnections: 0,
      }),
    ).toBe("Adds 1 box and 2 connections; changes 1 label");
    expect(
      describeRefineApplied({
        addedBoxes: 0,
        addedConnections: 0,
        changedBoxes: 0,
        removedBoxes: 2,
        removedConnections: 3,
      }),
    ).toBe("Refined a diagram: removes 2 boxes and 3 connections");
  });
});
