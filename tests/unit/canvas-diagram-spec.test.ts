import { describe, expect, it } from "vitest";
import {
  DIAGRAM_CAPS,
  describeCounts,
  DiagramError,
  diagramSpecSchema,
  normalizeDiagram,
  plainText,
  type RawDiagram,
} from "@/lib/canvas/diagram-spec";

const base = (over: Partial<RawDiagram> = {}): RawDiagram => ({
  title: "Food delivery",
  layout: "architecture",
  sections: [
    { id: "clients", label: "Clients", tone: "blue" },
    { id: "services", label: "Services" },
  ],
  nodes: [
    { id: "app", label: "Customer app", kind: "client", tech: "React Native", section: "clients" },
    { id: "orders", label: "Order service", kind: "service", tech: "Node.js", section: "services" },
  ],
  edges: [{ from: "app", to: "orders", label: "order placed" }],
  ...over,
});

describe("reading what the model returned", () => {
  it("accepts a valid diagram, and ignores fields it was not asked for (positions, colours, links)", () => {
    const parsed = diagramSpecSchema.safeParse({
      ...base(),
      nodes: [
        {
          id: "app",
          label: "App",
          kind: "client",
          x: 10,
          y: 20,
          color: "#ff0000",
          link: "https://evil.example",
          section: "clients",
        },
      ],
      edges: [],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(Object.keys(parsed.data.nodes[0]!)).not.toContain("x");
    expect(Object.keys(parsed.data.nodes[0]!)).not.toContain("color");
    expect(Object.keys(parsed.data.nodes[0]!)).not.toContain("link");
  });

  it("refuses duplicate box ids, an id that is not usable, and a diagram with no boxes (so the repair retry runs)", () => {
    const twice = diagramSpecSchema.safeParse(
      base({
        nodes: [
          { id: "a", label: "A", kind: "service" },
          { id: "a", label: "B", kind: "service" },
        ],
      }),
    );
    expect(twice.success).toBe(false);
    if (!twice.success) expect(twice.error.issues[0]!.message).toMatch(/share the id "a"/);
    expect(
      diagramSpecSchema.safeParse(
        base({ nodes: [{ id: "Order Service", label: "A", kind: "service" }] }),
      ).success,
    ).toBe(false);
    expect(
      diagramSpecSchema.safeParse(base({ nodes: [{ id: "1abc", label: "A", kind: "service" }] }))
        .success,
    ).toBe(false);
    expect(diagramSpecSchema.safeParse(base({ nodes: [] })).success).toBe(false);
    expect(diagramSpecSchema.safeParse({ title: "x" }).success).toBe(false);
  });

  it("puts no maximum on a list or on text in the schema it sends the model", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      id: `n${i}`,
      label: "x".repeat(300),
      kind: "service",
    }));
    expect(diagramSpecSchema.safeParse(base({ nodes: many })).success).toBe(true);
  });
});

describe("normalizeDiagram", () => {
  it("returns a good diagram untouched, with nothing to say", () => {
    const { spec, warnings } = normalizeDiagram(base());
    expect(warnings).toEqual([]);
    expect(spec.nodes.map((n) => n.id)).toEqual(["app", "orders"]);
    expect(spec.edges).toEqual([{ from: "app", to: "orders", label: "order placed" }]);
    expect(spec.sections).toEqual([
      { id: "clients", label: "Clients", tone: "blue" },
      { id: "services", label: "Services" },
    ]);
  });

  it("drops a connection to a box that does not exist, a self-loop and a repeat, and says so in words", () => {
    const { spec, warnings } = normalizeDiagram(
      base({
        edges: [
          { from: "app", to: "orders" },
          { from: "app", to: "ghost" },
          { from: "ghost", to: "orders" },
          { from: "orders", to: "orders" },
          { from: "app", to: "orders", label: "again" },
        ],
      }),
    );
    expect(spec.edges).toHaveLength(1);
    expect(warnings).toEqual([
      "2 connections were left out because they pointed at boxes that don't exist.",
      "1 connection from a box to itself was left out.",
      "1 repeated connection was left out.",
    ]);
  });

  it("puts a box in an unknown section, or none, into Other", () => {
    const { spec, warnings } = normalizeDiagram(
      base({
        nodes: [
          { id: "a", label: "A", kind: "service", section: "nowhere" },
          { id: "b", label: "B", kind: "service" },
          { id: "c", label: "C", kind: "service", section: "services" },
        ],
        edges: [],
      }),
    );
    expect(spec.nodes.map((n) => n.section)).toEqual(["other", "other", "services"]);
    expect(spec.sections.map((s) => s.id)).toEqual(["clients", "services", "other"]);
    expect(spec.sections.at(-1)!.label).toBe("Other");
    expect(warnings).toContain("2 boxes had no section, so they were put in Other.");
  });

  it("never invents Other when every box has a section", () => {
    expect(normalizeDiagram(base()).spec.sections.some((s) => s.id === "other")).toBe(false);
  });

  it("drops what is over the caps and counts it", () => {
    const sections = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, label: `S${i}` }));
    const nodes = Array.from({ length: 70 }, (_, i) => ({
      id: `n${i}`,
      label: `Box ${i}`,
      kind: "service",
      section: "s0",
    }));
    const edges = Array.from({ length: 150 }, (_, i) => ({
      from: `n${i % 60}`,
      to: `n${(i + 1 + Math.floor(i / 60)) % 60}`,
    }));
    const { spec, warnings } = normalizeDiagram(base({ sections, nodes, edges }));
    expect(spec.nodes).toHaveLength(DIAGRAM_CAPS.nodes);
    expect(spec.sections.length).toBeLessThanOrEqual(DIAGRAM_CAPS.sections);
    expect(spec.edges.length).toBeLessThanOrEqual(DIAGRAM_CAPS.edges);
    expect(warnings.some((w) => /10 boxes were left out/.test(w))).toBe(true);
    expect(warnings.some((w) => /2 sections were left out/.test(w))).toBe(true);
  });

  it("cuts text to its limits, with a note, and removes control characters, links and Markdown", () => {
    const { spec, warnings } = normalizeDiagram(
      base({
        title: "**Big** `diagram`",
        nodes: [
          {
            id: "a",
            label: "Order\u0000 service see https://evil.example/x",
            kind: "service",
            tech: "T".repeat(80),
            note: "n".repeat(300),
            section: "services",
          },
        ],
        edges: [],
      }),
    );
    expect(spec.title).toBe("Big diagram");
    expect(spec.nodes[0]!.label).toBe("Order service see");
    expect([...spec.nodes[0]!.tech!].length).toBe(DIAGRAM_CAPS.tech);
    expect([...spec.nodes[0]!.note!].length).toBe(DIAGRAM_CAPS.note);
    expect(warnings).toContain("2 labels were shortened to fit.");
  });

  it("draws a kind it does not know as a service, and says so", () => {
    const { spec, warnings } = normalizeDiagram(
      base({
        nodes: [{ id: "a", label: "A", kind: "microservice", section: "services" }],
        edges: [],
      }),
    );
    expect(spec.nodes[0]!.kind).toBe("service");
    expect(warnings).toContain("1 box had a kind we don't draw, and was drawn as a service.");
  });

  it("ignores a colour that is not one of the eight tokens", () => {
    const { spec } = normalizeDiagram(
      base({
        sections: [
          { id: "clients", label: "Clients", tone: "#ff0000" },
          { id: "services", label: "S", tone: "teal" },
        ],
      }),
    );
    expect(spec.sections.map((s) => s.tone)).toEqual([undefined, "teal"]);
  });

  it("gives a flow no sections", () => {
    const { spec } = normalizeDiagram(base({ layout: "flow" }));
    expect(spec.sections).toEqual([]);
    expect(spec.nodes.every((n) => n.section === undefined)).toBe(true);
  });

  it("fails, with a plain reason, on duplicate ids or no usable box", () => {
    expect(() =>
      normalizeDiagram(
        base({
          nodes: [
            { id: "a", label: "A", kind: "service" },
            { id: "a", label: "B", kind: "service" },
          ],
        }),
      ),
    ).toThrow(DiagramError);
    expect(() =>
      normalizeDiagram(base({ nodes: [{ id: "a", label: "   ", kind: "service" }], edges: [] })),
    ).toThrow(/no boxes/);
  });

  it("leaves out a box that has no name, and the connections to it", () => {
    const { spec } = normalizeDiagram(
      base({
        nodes: [
          { id: "a", label: "A", kind: "service", section: "services" },
          { id: "b", label: "", kind: "service", section: "services" },
        ],
        edges: [{ from: "a", to: "b" }],
      }),
    );
    expect(spec.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(spec.edges).toEqual([]);
  });
});

describe("normalizeDiagram: arrows that follow the data", () => {
  const withQueue = (edges: RawDiagram["edges"]) =>
    base({
      nodes: [
        { id: "orders", label: "Order service", kind: "service", section: "services" },
        { id: "bus", label: "Order events", kind: "queue", tech: "Kafka", section: "services" },
        { id: "mail", label: "Email service", kind: "service", section: "services" },
      ],
      edges,
    });

  it("turns a consumer that points at its queue around, and says so", () => {
    const { spec, warnings } = normalizeDiagram(
      withQueue([
        { from: "orders", to: "bus", label: "publish order placed" },
        { from: "mail", to: "bus", label: "consumes order events" },
      ]),
    );
    expect(spec.edges).toEqual([
      { from: "orders", to: "bus", label: "publish order placed" },
      { from: "bus", to: "mail", label: "consumes order events" },
    ]);
    expect(warnings).toEqual([
      "1 connection was turned around so the arrow follows the data (a queue delivers to what reads from it).",
    ]);
  });

  it("leaves a producer alone, even into a queue", () => {
    const { spec, warnings } = normalizeDiagram(
      withQueue([
        { from: "orders", to: "bus", label: "order placed" },
        { from: "bus", to: "mail", label: "order placed" },
      ]),
    );
    expect(spec.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["orders>bus", "bus>mail"]);
    expect(warnings).toEqual([]);
  });

  it("says when a box has no connection", () => {
    const { warnings } = normalizeDiagram(
      withQueue([{ from: "orders", to: "bus", label: "order placed" }]),
    );
    expect(warnings).toEqual(["1 box has no connection, so it was drawn on its own."]);
  });
});

describe("plain text and counts", () => {
  it("cleans one string at a time", () => {
    expect(plainText("  a   b\t\nc ", 20)).toEqual({ text: "a b c", shortened: false });
    expect(plainText(5, 20)).toEqual({ text: "", shortened: false });
    expect(plainText("abcdefghij", 5)).toEqual({ text: "abcd…", shortened: true });
    expect(plainText("😀".repeat(10), 4).text).toBe("😀😀😀…");
  });

  it("says the counts in words", () => {
    expect(
      describeCounts({
        sections: Array(6).fill(0),
        nodes: Array(24).fill(0),
        edges: Array(31).fill(0),
      }),
    ).toBe("6 sections, 24 boxes, 31 connections");
    expect(describeCounts({ sections: [], nodes: [{}] as never, edges: [] })).toBe(
      "1 box, 0 connections",
    );
  });
});
