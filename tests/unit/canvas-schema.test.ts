import { describe, expect, it } from "vitest";
import { buildOutline, describeBox, describeConnection } from "@/lib/canvas/outline";
import {
  isAllowedSceneLink,
  projectScene,
  sanitizeScene,
  SceneError,
  stripUnsupported,
} from "@/lib/canvas/schema";
import { MAX_ELEMENTS, type Scene } from "@/lib/canvas/types";

const NOTE = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const base = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  ...extra,
});
const scene = (elements: unknown[], appState: unknown = {}) => ({ v: 1, elements, appState });

describe("sanitizeScene", () => {
  it("keeps every allowed element type", () => {
    const types = ["rectangle", "ellipse", "diamond", "arrow", "line", "text", "frame", "freedraw"];
    const out = sanitizeScene(scene(types.map((t, i) => base(`e${i}`, t))));
    expect(out.elements.map((e) => e.type)).toEqual(types);
    expect(out.v).toBe(1);
  });

  it("refuses images, embeds, iframes and anything unknown, naming what it can", () => {
    for (const type of ["image", "embeddable", "iframe", "magicframe"]) {
      expect(() => sanitizeScene(scene([base("a", type)]))).toThrow(SceneError);
    }
    expect(() => sanitizeScene(scene([base("a", "image")]))).toThrow(/Images and embedded pages/);
    expect(() => sanitizeScene(scene([base("a", "spaceship")]))).toThrow(SceneError);
    expect(() => sanitizeScene(scene(["not an element"]))).toThrow(SceneError);
  });

  it("refuses a scene that is not a scene", () => {
    for (const bad of [null, 5, "x", [], {}, { v: 2, elements: [] }, { v: 1, elements: "no" }]) {
      expect(() => sanitizeScene(bad)).toThrow(SceneError);
    }
  });

  it("keeps only known fields and drops the rest", () => {
    const out = sanitizeScene(
      scene([
        base("a", "rectangle", { onClick: "alert(1)", __proto__: { x: 1 }, extra: { deep: 1 } }),
      ]),
    );
    const keys = Object.keys(out.elements[0]!);
    expect(keys).not.toContain("onClick");
    expect(keys).not.toContain("extra");
    expect(keys).toContain("strokeColor");
  });

  it("drops removed elements, which only the browser's undo history needs", () => {
    const out = sanitizeScene(
      scene([base("a", "rectangle"), base("b", "rectangle", { isDeleted: true })]),
    );
    expect(out.elements.map((e) => e.id)).toEqual(["a"]);
  });

  it("clamps numbers and caps strings", () => {
    const out = sanitizeScene(
      scene([
        base("a", "rectangle", {
          x: 9e9,
          y: -9e9,
          width: 9e9,
          height: -5,
          opacity: 500,
          strokeWidth: 9999,
          angle: 1e9,
        }),
        base("t", "text", { text: "x".repeat(5000), fontSize: 99999 }),
      ]),
    );
    const [rect, txt] = out.elements as unknown as [
      Record<string, number>,
      Record<string, unknown>,
    ];
    expect(rect).toMatchObject({
      x: 1_000_000,
      y: -1_000_000,
      width: 100_000,
      height: 0,
      opacity: 100,
      strokeWidth: 64,
    });
    expect(Math.abs(rect.angle!)).toBeLessThanOrEqual(100);
    expect((txt.text as string).length).toBe(2000);
    expect(txt.fontSize).toBe(400);
  });

  it("rejects non-finite numbers by using the default", () => {
    const out = sanitizeScene(scene([base("a", "rectangle", { x: Number.NaN, width: "wide" })]));
    expect(out.elements[0]).toMatchObject({ x: 0, width: 0 });
  });

  it("removes control characters but keeps line breaks", () => {
    const out = sanitizeScene(scene([base("t", "text", { text: "a\u0000b\nc\u0007d" })]));
    expect(out.elements[0]!.text).toBe("ab\ncd");
  });

  it("keeps safe links and removes the rest", () => {
    const ok = [
      "https://example.com/x",
      "http://example.com",
      "mailto:a@example.com",
      `/notes/${NOTE}`,
      `/projects/${NOTE}`,
      `/tasks?task=${NOTE}`,
    ];
    for (const link of ok) {
      expect(sanitizeScene(scene([base("a", "rectangle", { link })])).elements[0]!.link, link).toBe(
        link,
      );
    }
    const bad = [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "ftp://x",
      "/notes/not-a-uuid",
      `/notes/${NOTE}/edit`,
      `/settings/account`,
      `//evil.example/x`,
      `/tasks?task=${NOTE}&x=1`,
      "https://" + "a".repeat(3000),
    ];
    for (const link of bad) {
      expect(
        sanitizeScene(scene([base("a", "rectangle", { link })])).elements[0]!.link,
        link,
      ).toBeNull();
    }
    expect(isAllowedSceneLink(5)).toBe(false);
  });

  it("strips customData to the dayboard key and its known fields", () => {
    const out = sanitizeScene(
      scene([
        base("a", "rectangle", {
          customData: {
            evil: { x: 1 },
            dayboard: {
              id: "order-service",
              kind: "service",
              section: "services",
              ai: true,
              ref: { type: "note", id: NOTE },
              secret: "x",
            },
          },
        }),
        base("b", "rectangle", {
          customData: { dayboard: { id: "Bad Id!", ref: { type: "user", id: NOTE }, ai: "yes" } },
        }),
        base("c", "rectangle", { customData: { other: 1 } }),
      ]),
    );
    expect(out.elements[0]!.customData).toEqual({
      dayboard: {
        id: "order-service",
        kind: "service",
        section: "services",
        ai: true,
        ref: { type: "note", id: NOTE },
      },
    });
    expect(out.elements[1]!.customData).toBeUndefined();
    expect(out.elements[2]!.customData).toBeUndefined();
  });

  it("keeps arrow bindings and points, clamped", () => {
    const out = sanitizeScene(
      scene([
        base("a", "arrow", {
          points: [
            [0, 0],
            [9e9, 5],
            ["x", 1],
          ],
          startBinding: { elementId: "box-1", focus: 99, gap: 4 },
          endBinding: { elementId: "bad id", focus: 0, gap: 1 },
          endArrowhead: "arrow",
        }),
      ]),
    );
    const arrow = out.elements[0]!;
    expect(arrow.points).toEqual([
      [0, 0],
      [1_000_000, 5],
    ]);
    expect(arrow.startBinding).toMatchObject({ elementId: "box-1", focus: 10, gap: 4 });
    expect(arrow.endBinding).toBeNull();
    expect(arrow.endArrowhead).toBe("arrow");
  });

  it("limits the size and the number of elements", () => {
    const many = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => base(`e${i}`, "rectangle"));
    expect(() => sanitizeScene(scene(many))).toThrow(/too big to save/);
    expect(() =>
      sanitizeScene(
        scene([base("t", "text", { text: "x".repeat(2_000), junk: "y".repeat(1_100_000) })]),
      ),
    ).toThrow(/too big to save/);
    const exactly = Array.from({ length: MAX_ELEMENTS }, (_, i) => base(`e${i}`, "rectangle"));
    expect(sanitizeScene(scene(exactly)).elements).toHaveLength(MAX_ELEMENTS);
  });

  it("refuses duplicate ids and unsafe ids", () => {
    expect(() => sanitizeScene(scene([base("a", "rectangle"), base("a", "ellipse")]))).toThrow(
      SceneError,
    );
    expect(() => sanitizeScene(scene([base("a b", "rectangle")]))).toThrow(SceneError);
    expect(() => sanitizeScene(scene([base("", "rectangle")]))).toThrow(SceneError);
  });

  it("keeps the two app settings it knows and drops the rest", () => {
    const out = sanitizeScene(
      scene([], {
        viewBackgroundColor: "#ffffff",
        gridModeEnabled: true,
        zoom: { value: 2 },
        collaborators: [],
      }),
    );
    expect(out.appState).toEqual({ viewBackgroundColor: "#ffffff", gridModeEnabled: true });
    expect(sanitizeScene(scene([], { viewBackgroundColor: "url(javascript:x)" })).appState).toEqual(
      {},
    );
  });

  it("is the same when run twice", () => {
    const once = sanitizeScene(
      scene([base("a", "rectangle", { link: "javascript:x" }), base("b", "text", { text: "hi" })]),
    );
    expect(sanitizeScene(once)).toEqual(once);
  });
});

describe("stripUnsupported", () => {
  it("keeps what the server accepts and reports what it removed", () => {
    const { kept, removed } = stripUnsupported([
      { type: "rectangle" },
      { type: "image" },
      { type: "embeddable" },
      { type: "image", isDeleted: true },
      { type: "text" },
    ]);
    expect(kept.map((e) => e.type)).toEqual(["rectangle", "image", "text"]);
    expect(removed.sort()).toEqual(["embeddable", "image"]);
  });
});

describe("the search text", () => {
  it("is the title, text elements and frame names, built from the scene", () => {
    const s = sanitizeScene(
      scene([
        base("f", "frame", { name: "Services" }),
        base("t", "text", { text: "Order service\nNode.js" }),
        base("r", "rectangle"),
      ]),
    );
    expect(projectScene("Checkout", s)).toEqual({
      text: "Checkout\nServices\nOrder service\nNode.js",
      elementCount: 3,
    });
  });

  it("is cut to 20,000 characters", () => {
    const long = sanitizeScene(
      scene(
        Array.from({ length: 30 }, (_, i) => base(`t${i}`, "text", { text: "word ".repeat(200) })),
      ),
    );
    expect(projectScene("", long).text.length).toBe(20_000);
  });
});

describe("the outline", () => {
  const diagram: Scene = sanitizeScene(
    scene([
      base("frame-1", "frame", { name: "Services" }),
      base("box-1", "rectangle", {
        frameId: "frame-1",
        boundElements: [{ id: "label-1", type: "text" }],
      }),
      base("label-1", "text", { text: "Order service\nNode.js", containerId: "box-1" }),
      base("box-2", "rectangle", { frameId: "frame-1" }),
      base("label-2", "text", { text: "Orders DB\nPostgreSQL", containerId: "box-2" }),
      base("arrow-1", "arrow", {
        startBinding: { elementId: "box-1", focus: 0, gap: 1 },
        endBinding: { elementId: "box-2", focus: 0, gap: 1 },
      }),
      base("label-3", "text", { text: "writes orders", containerId: "arrow-1" }),
      base("solo", "rectangle"),
      base("card", "rectangle", {
        link: `/notes/${NOTE}`,
        customData: { dayboard: { ref: { type: "note", id: NOTE } } },
      }),
      base("label-4", "text", { text: "Design doc", containerId: "card" }),
      base("free", "text", { text: "Remember the retries" }),
    ]),
  );

  it("lists sections with their boxes, the technology, connections, cards and free text", () => {
    const outline = buildOutline(diagram);
    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0]!.name).toBe("Services");
    expect(outline.sections[0]!.boxes.map(describeBox)).toEqual([
      "Order service, Node.js",
      "Orders DB, PostgreSQL",
    ]);
    expect(outline.connections.map(describeConnection)).toEqual([
      "Order service to Orders DB: writes orders",
    ]);
    expect(outline.boxes.map((b) => b.label)).toEqual(["Design doc"]);
    expect(outline.boxes[0]!.card).toEqual({ type: "note", id: NOTE });
    expect(outline.texts).toEqual(["Remember the retries"]);
  });

  it("leaves out decoration with no words, and arrows that do not join two boxes", () => {
    const outline = buildOutline(diagram);
    expect(outline.boxes.some((b) => b.id === "solo")).toBe(false);
    const loose = buildOutline(
      sanitizeScene(
        scene([base("a1", "arrow", { startBinding: { elementId: "nope", focus: 0, gap: 0 } })]),
      ),
    );
    expect(loose.connections).toEqual([]);
  });

  it("reads the same boxes and connections as the scene holds", () => {
    const outline = buildOutline(diagram);
    const shapesWithText = diagram.elements.filter(
      (e) => e.type === "text" && e.containerId && e.containerId !== "arrow-1",
    ).length;
    const listed = outline.sections.flatMap((s) => s.boxes).length + outline.boxes.length;
    expect(listed).toBe(shapesWithText);
    expect(outline.connections).toHaveLength(
      diagram.elements.filter((e) => e.type === "arrow").length,
    );
  });
});
