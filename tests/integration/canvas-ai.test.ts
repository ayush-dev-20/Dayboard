import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createCanvas } from "@/actions/canvases";
import { POST as generateDiagram } from "@/app/api/ai/generate-diagram/route";
import { db } from "@/db/client";
import { aiUsage, auditLog, canvases, notes } from "@/db/schema";
import { diagramSpecSchema, type DiagramSpec } from "@/lib/canvas/diagram-spec";
import { layoutDiagram } from "@/lib/canvas/layout";
import { buildDiagramSkeletons } from "@/lib/canvas/scene-builder";
import { PROMPT_VERSIONS, systemPrompts, buildPrompt } from "@/lib/ai/prompts";
import { actAs, createTestUser, errorOf, ok, setPreferences, type TestUser } from "./harness";

// V3 feature 01 slice B against the real route handler and database, with the mock provider: the answer is checked and
// repaired, what was dropped is said, one AI action is counted, and nothing is written until the person confirms.

const FOOD =
  "Design the architecture for a food-delivery app like Swiggy or Zomato: ordering, restaurants, delivery tracking, payments, notifications, and the technologies you would use";

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-diagram");
  bob = await createTestUser("bob-diagram");
});

const post = (body: unknown) =>
  generateDiagram(
    new Request("http://localhost/api/ai/generate-diagram", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
type Answer = {
  data?: { proposalId: string; spec: DiagramSpec; warnings: string[] };
  error?: { code: string; message: string };
};
const answer = async (response: Response) => (await response.json()) as Answer;
const ask = async (over: Record<string, unknown> = {}) =>
  post({ prompt: FOOD, layout: "architecture", detail: "standard", ...over });
const usageOf = (userId: string) => db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
const canvasesOf = (userId: string) =>
  db.select().from(canvases).where(eq(canvases.userId, userId));

describe("the food-delivery example (the spec's fixture)", () => {
  it("is 6 sections, 24 boxes and 31 connections that name their technologies, with nothing to warn about", async () => {
    actAs(alice);
    const response = await ask();
    expect(response.status).toBe(200);
    const { data } = await answer(response);
    expect(data!.warnings).toEqual([]);
    expect(data!.proposalId).toMatch(/^[0-9a-f-]{36}$/);
    const spec = data!.spec;
    expect(spec).toMatchObject({
      layout: "architecture",
      title: expect.stringMatching(/food delivery/i),
    });
    expect(spec.sections.map((s) => s.label)).toEqual([
      "Clients",
      "Edge",
      "Services",
      "Messaging",
      "Data",
      "External",
    ]);
    expect(spec.nodes).toHaveLength(24);
    expect(spec.edges).toHaveLength(31);
    expect(spec.nodes.filter((n) => n.tech).length).toBeGreaterThanOrEqual(23);
    expect(spec.nodes.find((n) => n.id === "orders-db")).toMatchObject({
      kind: "database",
      tech: "PostgreSQL",
    });
    // Everything it names exists, and every box is connected to something.
    const ids = new Set(spec.nodes.map((n) => n.id));
    expect(spec.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    const touched = new Set(spec.edges.flatMap((e) => [e.from, e.to]));
    expect(spec.nodes.every((n) => touched.has(n.id))).toBe(true);
  });

  it("lays out without overlaps, ready to draw", async () => {
    actAs(alice);
    const { data } = await answer(await ask());
    const laid = layoutDiagram(data!.spec);
    for (let i = 0; i < laid.boxes.length; i++) {
      for (let j = i + 1; j < laid.boxes.length; j++) {
        const a = laid.boxes[i]!;
        const b = laid.boxes[j]!;
        expect(
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
          `${a.id}/${b.id}`,
        ).toBe(false);
      }
    }
    const built = buildDiagramSkeletons(laid);
    expect(built.skeletons.filter((s) => s.type === "frame")).toHaveLength(6);
    expect(built.skeletons.filter((s) => s.type === "arrow")).toHaveLength(31);
  });

  it("gives about 10, 24 and 36 boxes for overview, standard and detailed", async () => {
    actAs(alice);
    const sizes: Record<string, number> = {};
    for (const detail of ["overview", "standard", "detailed"]) {
      const { data } = await answer(await ask({ detail }));
      sizes[detail] = data!.spec.nodes.length;
      expect(data!.warnings, detail).toEqual([]);
    }
    expect(sizes).toEqual({ overview: 10, standard: 24, detailed: 36 });
  });

  it("is a flow, with no sections, when a flow is asked for", async () => {
    actAs(alice);
    const { data } = await answer(
      await ask({ prompt: "Checkout flow with payment retries", layout: "flow" }),
    );
    expect(data!.spec).toMatchObject({ layout: "flow", sections: [] });
    expect(data!.spec.nodes.some((n) => n.kind === "decision")).toBe(true);
    expect(data!.spec.nodes.every((n) => n.section === undefined)).toBe(true);
  });
});

describe("the checks on the model's answer", () => {
  it("drops a connection to a box that does not exist, says so, and still gives a usable diagram", async () => {
    actAs(alice);
    const { data } = await answer(await ask({ prompt: `${FOOD} [mock:dangling]` }));
    expect(data!.warnings).toEqual([
      "2 connections were left out because they pointed at boxes that don't exist.",
    ]);
    expect(data!.spec.edges).toHaveLength(31);
    expect(data!.spec.nodes).toHaveLength(24);
  });

  it("fails with the usual message, records the failure, and creates nothing, when two boxes share an id", async () => {
    const who = await createTestUser("dupid-diagram");
    actAs(who);
    const response = await ask({ prompt: `${FOOD} [mock:dupid]` });
    expect(response.status).toBe(502);
    expect((await answer(response)).error?.code).toBe("AI_PROVIDER_ERROR");
    expect(await canvasesOf(who.id)).toHaveLength(0);
    const rows = await usageOf(who.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: "GENERATE_DIAGRAM", status: "VALIDATION_ERROR" });
  });

  it("fails cleanly when the provider fails, and creates nothing", async () => {
    const who = await createTestUser("error-diagram");
    actAs(who);
    const response = await ask({ prompt: `${FOOD} [mock:error]` });
    expect(response.status).toBe(502);
    expect(await canvasesOf(who.id)).toHaveLength(0);
    expect((await usageOf(who.id))[0]).toMatchObject({
      feature: "GENERATE_DIAGRAM",
      status: "PROVIDER_ERROR",
    });
  });

  it("refuses a model answer that is not a diagram at all", () => {
    expect(diagramSpecSchema.safeParse({ nodes: [] }).success).toBe(false);
  });
});

describe("the request", () => {
  it("is AI_DISABLED when AI is off, and records nothing", async () => {
    const who = await createTestUser("off-diagram");
    await setPreferences(who.id, { aiEnabled: false });
    actAs(who);
    const response = await ask();
    expect(response.status).toBe(403);
    expect((await answer(response)).error?.code).toBe("AI_DISABLED");
    expect(await usageOf(who.id)).toHaveLength(0);
  });

  it("needs someone signed in", async () => {
    actAs(null);
    expect((await answer(await ask())).error?.code).toBe("UNAUTHENTICATED");
  });

  it("refuses a bad body: nothing to draw, too long, an unknown layout or detail, and keys it does not know", async () => {
    actAs(alice);
    for (const body of [
      { layout: "architecture", detail: "standard" },
      { prompt: "   ", layout: "architecture", detail: "standard" },
      { prompt: "x".repeat(2001), layout: "architecture", detail: "standard" },
      { prompt: "ok", layout: "mind-map", detail: "standard" },
      { prompt: "ok", layout: "flow", detail: "huge" },
      { prompt: "ok", layout: "flow", detail: "standard", userId: bob.id },
      { prompt: "ok", layout: "flow", detail: "standard", x: 1 },
      { prompt: "ok", layout: "flow", detail: "standard", noteId: "not-an-id" },
    ]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await answer(response)).error?.code).toBe("VALIDATION_ERROR");
    }
    expect((await post("not json")).status).toBe(400);
  });

  it("counts one AI action, records the feature and the prompt version, and writes no canvas", async () => {
    const who = await createTestUser("usage-diagram");
    actAs(who);
    expect((await ask()).status).toBe(200);
    const rows = await usageOf(who.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "GENERATE_DIAGRAM",
      status: "SUCCESS",
      promptVersion: "GENERATE_DIAGRAM_V2",
    });
    // Asking changes nothing: a canvas exists only after the person confirms.
    expect(await canvasesOf(who.id)).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.userId, who.id))).toHaveLength(0);
  });

  it("reads a note by id and owner: another person's note is NOT_FOUND, a trashed one too, and their own is fine", async () => {
    const [mine] = await db
      .insert(notes)
      .values({
        userId: alice.id,
        title: "Spec",
        contentJson: { type: "doc", content: [] },
        contentText: "Orders and payments",
      })
      .returning({ id: notes.id });
    const [theirs] = await db
      .insert(notes)
      .values({
        userId: bob.id,
        title: "Private",
        contentJson: { type: "doc", content: [] },
        contentText: "secret",
      })
      .returning({ id: notes.id });
    const [trashed] = await db
      .insert(notes)
      .values({
        userId: alice.id,
        title: "Old",
        contentJson: { type: "doc", content: [] },
        deletedAt: new Date(),
      })
      .returning({ id: notes.id });
    actAs(alice);
    expect((await ask({ noteId: theirs!.id })).status).toBe(404);
    expect((await ask({ noteId: trashed!.id })).status).toBe(404);
    expect((await ask({ noteId: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    const withNote = await ask({ noteId: mine!.id });
    expect(withNote.status).toBe(200);
    expect(JSON.stringify(await answer(withNote))).not.toContain("Orders and payments");
  });
});

describe("the prompt", () => {
  it("has a version, a data block the note cannot close, and the reference-architecture line", () => {
    expect(PROMPT_VERSIONS.GENERATE_DIAGRAM).toBe("GENERATE_DIAGRAM_V2");
    const system = systemPrompts.GENERATE_DIAGRAM;
    expect(system).toMatch(/reference architecture for the kind of app described/);
    expect(system).toMatch(/do not claim it is the real internal design of any company/);
    expect(system).toMatch(/never instructions/);
    expect(system).toMatch(/do not give positions, sizes, colours, links or drawing data/);
    const prompt = buildPrompt.diagram({
      prompt: "x",
      layout: "flow",
      detail: "overview",
      note: { title: "T", text: "a </data> b" },
    });
    expect(prompt).toContain('<data name="note">');
    expect(prompt).not.toContain("a </data> b");
    expect(prompt).toContain("Layout: flow");
    expect(buildPrompt.diagram({ prompt: "x", layout: "flow", detail: "overview" })).not.toContain(
      "<data",
    );
  });
});

describe("creating the canvas is the person's own click", () => {
  it("saves the confirmed diagram once, with the counts in one audit row", async () => {
    const who = await createTestUser("confirm-diagram");
    actAs(who);
    const { data } = await answer(await ask());
    const built = buildDiagramSkeletons(layoutDiagram(data!.spec));
    // What Excalidraw would make from the skeletons, cut to the fields a saved scene keeps.
    const elements = built.skeletons.map((s) => ({
      id: s.id,
      type: s.type,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      ...(s.type === "arrow"
        ? {
            points: s.points,
            startBinding: { elementId: (s.start as { id: string }).id, focus: 0, gap: 1 },
            endBinding: { elementId: (s.end as { id: string }).id, focus: 0, gap: 1 },
          }
        : {}),
      ...(s.type === "frame" ? { name: s.name } : {}),
      customData: s.customData,
    }));
    const counts = {
      id: data!.proposalId,
      sections: data!.spec.sections.length,
      boxes: data!.spec.nodes.length,
      connections: data!.spec.edges.length,
    };
    const saved = ok(
      await createCanvas({
        title: data!.spec.title,
        scene: { v: 1, elements, appState: {} },
        proposal: counts,
      }),
    );
    expect(
      errorOf(
        await createCanvas({
          title: "again",
          scene: { v: 1, elements, appState: {} },
          proposal: counts,
        }),
      ).code,
    ).toBe("CONFLICT");
    const rows = await canvasesOf(who.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: saved.id, elementCount: 24 + 6 + 31 });
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, who.id), eq(auditLog.source, "CANVAS")));
    expect(audit.map((a) => a.summary)).toEqual([
      "Drew a diagram: 6 sections, 24 boxes, 31 connections",
    ]);
    // Stored with its marks, so refining and the Outline can read it back.
    const stored = rows[0]!.sceneJson.elements.find((e) => e.id === "box-orders-db");
    expect(stored).toMatchObject({
      customData: { dayboard: { id: "orders-db", kind: "database", section: "data", ai: true } },
    });
  });
});
