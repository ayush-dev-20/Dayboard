import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addCardTarget,
  archiveCanvas,
  createCanvas,
  deleteCanvas,
  findCanvasesToLink,
  findTasksToLinkToCanvas,
  linkTaskCanvas,
  permanentlyDeleteCanvas,
  restoreCanvas,
  saveCanvas,
  unlinkTaskCanvas,
  updateCanvasMeta,
} from "@/actions/canvases";
import { permanentlyDeleteTrashItem, restoreTrashItem } from "@/actions/trash";
import { db } from "@/db/client";
import {
  getCanvas,
  latestCanvases,
  listArchivedCanvases,
  listCanvases,
  listLinkedCanvases,
  listLinkedTasks,
} from "@/db/queries/canvases";
import { searchWorkspace } from "@/db/queries/search";
import { listTrash, trashCounts } from "@/db/queries/trash";
import { emptyTrash } from "@/db/mutations/trash";
import { auditLog, canvases, notes, projects, taskCanvases, tasks } from "@/db/schema";
import { CANVAS_LIMIT } from "@/lib/canvas/types";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V3 feature 01 slice A against a real database: ownership on every route, saving with a version and a server-built
// search text, Trash and search, links between tasks and canvases, and the audit row of an AI diagram.

const DAY_PREFS = { timezone: "UTC", startOfDay: "06:00" };
const NOTE = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const GONE = "00000000-0000-4000-8000-000000000000";

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-canvas");
  bob = await createTestUser("bob-canvas");
});

const rect = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  ...extra,
});
const text = (id: string, value: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 20,
  text: value,
  ...extra,
});
const scene = (elements: unknown[]) => ({ v: 1, elements, appState: {} });

async function make(who: TestUser, over: Record<string, unknown> = {}) {
  actAs(who);
  return ok(await createCanvas({ title: "Untitled", ...over }));
}
async function task(
  who: TestUser,
  title = "Plan launch",
  over: Partial<typeof tasks.$inferInsert> = {},
) {
  const [row] = await db
    .insert(tasks)
    .values({ userId: who.id, title, sortOrder: 0, ...over })
    .returning({ id: tasks.id });
  return row!.id;
}
const rowOf = async (id: string) =>
  (await db.select().from(canvases).where(eq(canvases.id, id)))[0]!;

describe("create and save", () => {
  it("creates an empty drawing, and one with a scene whose text the server builds", async () => {
    const empty = await make(alice, { title: "Sketch" });
    expect(await rowOf(empty.id)).toMatchObject({
      kind: "DRAWING",
      version: 1,
      elementCount: 0,
      sceneText: "Sketch",
      boardJson: null,
    });
    const drawn = await make(alice, {
      title: "Checkout",
      scene: scene([text("t1", "Order service"), rect("r1")]),
    });
    expect(await rowOf(drawn.id)).toMatchObject({
      elementCount: 2,
      sceneText: "Checkout\nOrder service",
    });
  });

  it("refuses a forbidden scene and a client-sent search text or person", async () => {
    actAs(alice);
    const image = errorOf(
      await createCanvas({ scene: scene([{ id: "i1", type: "image", x: 0, y: 0 }]) }),
    );
    expect(image.code).toBe("VALIDATION_ERROR");
    expect(image.message).toMatch(/Images and embedded pages/);
    expect(errorOf(await createCanvas({ sceneText: "forged" })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await createCanvas({ userId: bob.id })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await createCanvas({ kind: "BOARD" })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await createCanvas({ title: "x".repeat(301) })).code).toBe("VALIDATION_ERROR");
  });

  it("saves at the version it started from, and a stale save is a conflict that changes nothing", async () => {
    const c = await make(alice);
    const first = ok(
      await saveCanvas({ id: c.id, version: 1, scene: scene([text("t1", "First draft")]) }),
    );
    expect(first).toMatchObject({ outcome: "saved", version: 2 });
    const stale = ok(
      await saveCanvas({ id: c.id, version: 1, scene: scene([text("t1", "Stale")]) }),
    );
    expect(stale).toEqual({ outcome: "conflict", version: 2 });
    const row = await rowOf(c.id);
    expect(row.sceneText).toContain("First draft");
    expect(row.version).toBe(2);
    expect(ok(await saveCanvas({ id: c.id, version: 2, scene: scene([]) }))).toMatchObject({
      outcome: "saved",
      version: 3,
    });
  });

  it("rebuilds the text copy and the element count on the server, ignoring any the client sends", async () => {
    const c = await make(alice, { title: "Doc" });
    expect(
      errorOf(
        await saveCanvas({
          id: c.id,
          version: 1,
          scene: scene([]),
          sceneText: "forged",
          elementCount: 99,
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
    ok(
      await saveCanvas({
        id: c.id,
        version: 1,
        scene: scene([
          text("t1", "Hello"),
          { ...rect("f1"), type: "frame", name: "Services" },
          rect("r1", { isDeleted: true }),
        ]),
      }),
    );
    expect(await rowOf(c.id)).toMatchObject({ sceneText: "Doc\nHello\nServices", elementCount: 2 });
  });

  it("refuses a scene that is too big or holds an image, and leaves the saved one alone", async () => {
    const c = await make(alice);
    ok(await saveCanvas({ id: c.id, version: 1, scene: scene([text("t1", "keep me")]) }));
    const big = Array.from({ length: 2001 }, (_, i) => rect(`r${i}`));
    expect(errorOf(await saveCanvas({ id: c.id, version: 2, scene: scene(big) })).message).toMatch(
      /too big/,
    );
    expect(
      errorOf(
        await saveCanvas({
          id: c.id,
          version: 2,
          scene: scene([{ id: "e", type: "embeddable", x: 0, y: 0 }]),
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
    expect((await rowOf(c.id)).sceneText).toContain("keep me");
    expect((await rowOf(c.id)).version).toBe(2);
  });

  it("removes unsafe links and strips customData when saving", async () => {
    const c = await make(alice);
    ok(
      await saveCanvas({
        id: c.id,
        version: 1,
        scene: scene([
          rect("a", { link: "javascript:alert(1)", customData: { evil: 1 } }),
          rect("b", {
            link: `/notes/${NOTE}`,
            customData: { dayboard: { ref: { type: "note", id: NOTE } }, other: 1 },
          }),
        ]),
      }),
    );
    const stored = (await rowOf(c.id)).sceneJson as unknown as {
      elements: { link: string | null; customData?: unknown }[];
    };
    expect(stored.elements[0]).toMatchObject({ link: null });
    expect(stored.elements[0]!.customData).toBeUndefined();
    expect(stored.elements[1]).toMatchObject({
      link: `/notes/${NOTE}`,
      customData: { dayboard: { ref: { type: "note", id: NOTE } } },
    });
  });
});

describe("rename, emoji, project and archive", () => {
  it("renames without bumping the version, and rebuilds the text", async () => {
    const c = await make(alice, { title: "Old", scene: scene([text("t1", "Body")]) });
    ok(await updateCanvasMeta({ id: c.id, title: "New name" }));
    expect(await rowOf(c.id)).toMatchObject({
      title: "New name",
      version: 1,
      sceneText: "New name\nBody",
    });
  });

  it("sets the project only to one of the person's own", async () => {
    const [mine] = await db
      .insert(projects)
      .values({ userId: alice.id, name: "Home", color: "slate" as never })
      .returning({ id: projects.id });
    const [theirs] = await db
      .insert(projects)
      .values({ userId: bob.id, name: "Theirs", color: "slate" as never })
      .returning({ id: projects.id });
    const c = await make(alice);
    ok(await updateCanvasMeta({ id: c.id, projectId: mine!.id, emoji: "🧭" }));
    expect(await rowOf(c.id)).toMatchObject({ projectId: mine!.id, emoji: "🧭" });
    expect(errorOf(await updateCanvasMeta({ id: c.id, projectId: theirs!.id })).code).toBe(
      "NOT_FOUND",
    );
    expect(errorOf(await createCanvas({ projectId: theirs!.id })).code).toBe("NOT_FOUND");
    ok(await updateCanvasMeta({ id: c.id, projectId: null }));
  });

  it("archives and unarchives; archived ones are listed apart", async () => {
    const c = await make(alice, { title: "Archive me" });
    ok(await archiveCanvas({ id: c.id, archived: true }));
    expect((await listCanvases(alice.id)).some((x) => x.id === c.id)).toBe(false);
    expect((await listArchivedCanvases(alice.id)).find((x) => x.id === c.id)).toMatchObject({
      archived: true,
    });
    ok(await archiveCanvas({ id: c.id, archived: false }));
    expect((await listCanvases(alice.id)).some((x) => x.id === c.id)).toBe(true);
  });

  it("lists the latest five for the sidebar, newest first", async () => {
    const who = await createTestUser("latest-canvas");
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await make(who, { title: `Canvas ${n}` });
      await new Promise((r) => setTimeout(r, 5));
    }
    const latest = await latestCanvases(who.id, 5);
    expect(latest.map((c) => c.title)).toEqual([
      "Canvas 6",
      "Canvas 5",
      "Canvas 4",
      "Canvas 3",
      "Canvas 2",
    ]);
  });
});

describe("ownership: another person's canvas is not found, by any route", () => {
  it("answers NOT_FOUND to read, save, rename, archive, delete, restore and permanent delete", async () => {
    const mine = await make(alice, { title: "Private" });
    actAs(bob);
    expect(await getCanvas(bob.id, mine.id)).toBeNull();
    expect((await listCanvases(bob.id)).some((c) => c.id === mine.id)).toBe(false);
    expect(errorOf(await saveCanvas({ id: mine.id, version: 1, scene: scene([]) })).code).toBe(
      "NOT_FOUND",
    );
    expect(errorOf(await updateCanvasMeta({ id: mine.id, title: "Mine now" })).code).toBe(
      "NOT_FOUND",
    );
    expect(errorOf(await archiveCanvas({ id: mine.id, archived: true })).code).toBe("NOT_FOUND");
    expect(errorOf(await deleteCanvas({ id: mine.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await restoreCanvas({ id: mine.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await permanentlyDeleteCanvas({ id: mine.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await restoreTrashItem({ type: "canvas", id: mine.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await permanentlyDeleteTrashItem({ type: "canvas", id: mine.id })).code).toBe(
      "NOT_FOUND",
    );
    expect(await rowOf(mine.id)).toMatchObject({
      title: "Private",
      version: 1,
      deletedAt: null,
      archivedAt: null,
    });
  });

  it("answers UNAUTHENTICATED when nobody is signed in", async () => {
    actAs(null);
    expect(errorOf(await createCanvas({})).code).toBe("UNAUTHENTICATED");
    expect(errorOf(await saveCanvas({ id: GONE, version: 1 })).code).toBe("UNAUTHENTICATED");
    expect(errorOf(await findTasksToLinkToCanvas({ query: "" })).code).toBe("UNAUTHENTICATED");
  });

  it("gives a card only for the person's own note, task or project", async () => {
    const [bobNote] = await db
      .insert(notes)
      .values({ userId: bob.id, title: "Bob's note", contentJson: { type: "doc", content: [] } })
      .returning({ id: notes.id });
    const [aliceNote] = await db
      .insert(notes)
      .values({
        userId: alice.id,
        title: "Design",
        emoji: "📐",
        contentJson: { type: "doc", content: [] },
      })
      .returning({ id: notes.id });
    const [aliceProject] = await db
      .insert(projects)
      .values({ userId: alice.id, name: "Launch", color: "slate" as never })
      .returning({ id: projects.id });
    const bobTask = await task(bob, "Bob's task");
    const aliceTask = await task(alice, "Write spec");
    actAs(alice);
    expect(errorOf(await addCardTarget({ type: "note", id: bobNote!.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await addCardTarget({ type: "task", id: bobTask })).code).toBe("NOT_FOUND");
    expect(errorOf(await addCardTarget({ type: "project", id: GONE })).code).toBe("NOT_FOUND");
    expect(ok(await addCardTarget({ type: "note", id: aliceNote!.id }))).toEqual({
      type: "note",
      id: aliceNote!.id,
      title: "Design",
      emoji: "📐",
      href: `/notes/${aliceNote!.id}`,
    });
    expect(ok(await addCardTarget({ type: "task", id: aliceTask }))).toMatchObject({
      href: `/tasks?task=${aliceTask}`,
    });
    expect(ok(await addCardTarget({ type: "project", id: aliceProject!.id }))).toMatchObject({
      title: "Launch",
      href: `/projects/${aliceProject!.id}`,
    });
  });
});

describe("Trash, restore and search", () => {
  it("moves to Trash, hides from lists and search, restores, and deletes for good", async () => {
    const who = await createTestUser("trash-canvas");
    const c = await make(who, {
      title: "Roadmap sketch",
      scene: scene([text("t1", "Kafka consumer")]),
    });
    const search = (q: string) =>
      searchWorkspace(
        who.id,
        { q, tab: "all", status: null, projectId: null, tagId: null, from: null, to: null },
        DAY_PREFS,
        10,
      );

    // Found by its title and by the text on it.
    expect((await search("Roadmap")).canvas.map((h) => h.id)).toEqual([c.id]);
    const byBox = await search("kafka");
    expect(byBox.canvas[0]).toMatchObject({ id: c.id, type: "canvas", href: `/canvases/${c.id}` });
    expect(byBox.canvas[0]!.snippet).not.toBeNull();

    ok(await deleteCanvas({ id: c.id }));
    expect((await listCanvases(who.id)).some((x) => x.id === c.id)).toBe(false);
    expect(await getCanvas(who.id, c.id)).toBeNull();
    expect((await search("Roadmap")).canvas).toHaveLength(0);
    expect((await trashCounts(who.id)).canvas).toBe(1);
    const trashed = (await listTrash(who.id)).items.find((i) => i.id === c.id);
    expect(trashed).toMatchObject({ type: "canvas", title: "Roadmap sketch" });
    // A saved change cannot reach a canvas in Trash.
    expect(errorOf(await saveCanvas({ id: c.id, version: 1, scene: scene([]) })).code).toBe(
      "NOT_FOUND",
    );

    actAs(who);
    const restored = ok(await restoreTrashItem({ type: "canvas", id: c.id }));
    expect(restored.href).toBe(`/canvases/${c.id}`);
    expect((await search("Roadmap")).canvas).toHaveLength(1);

    ok(await deleteCanvas({ id: c.id }));
    ok(await permanentlyDeleteTrashItem({ type: "canvas", id: c.id }));
    expect(await db.select().from(canvases).where(eq(canvases.id, c.id))).toHaveLength(0);
  });

  it("empties the Trash of canvases, only the caller's", async () => {
    const who = await createTestUser("empty-canvas");
    const mine = await make(who, { title: "Mine" });
    const theirs = await make(bob, { title: "Theirs" });
    actAs(who);
    ok(await deleteCanvas({ id: mine.id }));
    actAs(bob);
    ok(await deleteCanvas({ id: theirs.id }));
    expect(await emptyTrash(who.id, "canvas")).toEqual({ deleted: 1 });
    expect((await rowOf(theirs.id)).deletedAt).not.toBeNull();
    ok(await restoreCanvas({ id: theirs.id }));
  });

  it("is not found by a search of another person, nor by status or tag filters", async () => {
    const c = await make(alice, { title: "Zebra crossing study" });
    const bobs = await searchWorkspace(
      bob.id,
      { q: "Zebra", tab: "all", status: null, projectId: null, tagId: null, from: null, to: null },
      DAY_PREFS,
      10,
    );
    expect(bobs.canvas).toHaveLength(0);
    const filtered = await searchWorkspace(
      alice.id,
      {
        q: "Zebra",
        tab: "all",
        status: "PLANNED",
        projectId: null,
        tagId: null,
        from: null,
        to: null,
      },
      DAY_PREFS,
      10,
    );
    expect(filtered.canvas).toHaveLength(0);
    const tab = await searchWorkspace(
      alice.id,
      {
        q: "Zebra",
        tab: "canvas",
        status: null,
        projectId: null,
        tagId: null,
        from: null,
        to: null,
      },
      DAY_PREFS,
      10,
    );
    expect(tab.canvas.map((h) => h.id)).toEqual([c.id]);
    expect(tab.task).toHaveLength(0);
  });
});

describe("links between tasks and canvases", () => {
  it("links from either side, shows on both, links once, and unlinks", async () => {
    const who = await createTestUser("link-canvas");
    const c = await make(who, { title: "Design board" });
    const t = await task(who, "Draw the flow");
    ok(await linkTaskCanvas({ taskId: t, canvasId: c.id }));
    ok(await linkTaskCanvas({ taskId: t, canvasId: c.id }));
    expect(
      await db.select().from(taskCanvases).where(eq(taskCanvases.canvasId, c.id)),
    ).toHaveLength(1);
    expect((await listLinkedTasks(who.id, c.id)).map((x) => x.title)).toEqual(["Draw the flow"]);
    expect((await listLinkedCanvases(who.id, t)).map((x) => x.title)).toEqual(["Design board"]);

    ok(await unlinkTaskCanvas({ taskId: t, canvasId: c.id }));
    expect(await listLinkedTasks(who.id, c.id)).toEqual([]);
    expect(await listLinkedCanvases(who.id, t)).toEqual([]);
  });

  it("lists open tasks before finished ones", async () => {
    const who = await createTestUser("link-order");
    const c = await make(who);
    const done = await task(who, "Done thing", { status: "DONE", completedAt: new Date() });
    const open = await task(who, "Open thing");
    actAs(who);
    ok(await linkTaskCanvas({ taskId: done, canvasId: c.id }));
    ok(await linkTaskCanvas({ taskId: open, canvasId: c.id }));
    expect((await listLinkedTasks(who.id, c.id)).map((x) => [x.title, x.isDone])).toEqual([
      ["Open thing", false],
      ["Done thing", true],
    ]);
  });

  it("refuses another person's task or canvas on every route", async () => {
    const mineC = await make(alice, { title: "Mine" });
    const theirsC = await make(bob, { title: "Theirs" });
    const mineT = await task(alice, "My task");
    const theirsT = await task(bob, "Their task");
    actAs(alice);
    expect(errorOf(await linkTaskCanvas({ taskId: theirsT, canvasId: mineC.id })).code).toBe(
      "NOT_FOUND",
    );
    expect(errorOf(await linkTaskCanvas({ taskId: mineT, canvasId: theirsC.id })).code).toBe(
      "NOT_FOUND",
    );
    expect(
      errorOf(await addCardTarget({ type: "task", id: theirsT, canvasId: mineC.id })).code,
    ).toBe("NOT_FOUND");
    expect(
      await db.select().from(taskCanvases).where(eq(taskCanvases.userId, alice.id)),
    ).toHaveLength(0);
    // Unlinking someone else's link changes nothing.
    actAs(bob);
    ok(await linkTaskCanvas({ taskId: theirsT, canvasId: theirsC.id }));
    actAs(alice);
    ok(await unlinkTaskCanvas({ taskId: theirsT, canvasId: theirsC.id }));
    expect(
      await db.select().from(taskCanvases).where(eq(taskCanvases.canvasId, theirsC.id)),
    ).toHaveLength(1);
    // The pickers only offer the person's own.
    expect(ok(await findTasksToLinkToCanvas({ query: "Their" }))).toEqual([]);
    expect(ok(await findCanvasesToLink({ query: "Theirs" }))).toEqual([]);
  });

  it("drops a trashed canvas or task out of both lists, and Restore brings the link back", async () => {
    const who = await createTestUser("link-trash");
    const c = await make(who, { title: "Linked" });
    const t = await task(who, "Linked task");
    ok(await linkTaskCanvas({ taskId: t, canvasId: c.id }));

    ok(await deleteCanvas({ id: c.id }));
    expect(await listLinkedCanvases(who.id, t)).toEqual([]);
    expect(errorOf(await linkTaskCanvas({ taskId: t, canvasId: c.id })).code).toBe("NOT_FOUND");
    ok(await restoreCanvas({ id: c.id }));
    expect((await listLinkedCanvases(who.id, t)).map((x) => x.id)).toEqual([c.id]);

    await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, t));
    expect(await listLinkedTasks(who.id, c.id)).toEqual([]);
    expect(errorOf(await linkTaskCanvas({ taskId: t, canvasId: c.id })).code).toBe("NOT_FOUND");
    await db.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, t));
    expect((await listLinkedTasks(who.id, c.id)).map((x) => x.id)).toEqual([t]);
  });

  it("marks an archived canvas on the task, and removes the link when either side is deleted for good", async () => {
    const who = await createTestUser("link-gone");
    const c = await make(who, { title: "To archive" });
    const t = await task(who, "Has canvases");
    ok(await linkTaskCanvas({ taskId: t, canvasId: c.id }));
    ok(await archiveCanvas({ id: c.id, archived: true }));
    expect((await listLinkedCanvases(who.id, t))[0]).toMatchObject({ id: c.id, archived: true });
    ok(await deleteCanvas({ id: c.id }));
    ok(await permanentlyDeleteCanvas({ id: c.id }));
    expect(await db.select().from(taskCanvases).where(eq(taskCanvases.taskId, t))).toHaveLength(0);

    const c2 = await make(who, { title: "Second" });
    ok(await linkTaskCanvas({ taskId: t, canvasId: c2.id }));
    await db.delete(tasks).where(eq(tasks.id, t));
    expect(
      await db.select().from(taskCanvases).where(eq(taskCanvases.canvasId, c2.id)),
    ).toHaveLength(0);
  });

  it("links a task once when its card is dropped with a canvas", async () => {
    const who = await createTestUser("card-link");
    const c = await make(who);
    const t = await task(who, "Dropped task");
    actAs(who);
    for (let i = 0; i < 2; i++) ok(await addCardTarget({ type: "task", id: t, canvasId: c.id }));
    expect(
      await db
        .select()
        .from(taskCanvases)
        .where(and(eq(taskCanvases.canvasId, c.id), eq(taskCanvases.taskId, t))),
    ).toHaveLength(1);
    // A note card with a canvas id links nothing.
    const [n] = await db
      .insert(notes)
      .values({ userId: who.id, title: "N", contentJson: { type: "doc", content: [] } })
      .returning({ id: notes.id });
    ok(await addCardTarget({ type: "note", id: n!.id, canvasId: c.id }));
    expect(
      await db.select().from(taskCanvases).where(eq(taskCanvases.canvasId, c.id)),
    ).toHaveLength(1);
  });

  it("offers only open, unarchived tasks and live canvases, up to twenty", async () => {
    const who = await createTestUser("pickers");
    actAs(who);
    await task(who, "Findable open");
    await task(who, "Findable done", { status: "DONE", completedAt: new Date() });
    await task(who, "Findable archived", { archivedAt: new Date() });
    await task(who, "Findable trashed", { deletedAt: new Date() });
    expect(ok(await findTasksToLinkToCanvas({ query: "Findable" })).map((t) => t.title)).toEqual([
      "Findable open",
    ]);
    const live = await make(who, { title: "Pickable" });
    const arch = await make(who, { title: "Pickable archived" });
    ok(await archiveCanvas({ id: arch.id, archived: true }));
    expect(ok(await findCanvasesToLink({ query: "Pickable" })).map((c) => c.id)).toEqual([live.id]);
    expect(errorOf(await findCanvasesToLink({ query: "x".repeat(101) })).code).toBe(
      "VALIDATION_ERROR",
    );
  });
});

describe("an AI diagram is applied once, with counts only in the audit row", () => {
  const counts = { sections: 6, boxes: 24, connections: 31 };

  it("writes one audit row and refuses a second apply of the same proposal", async () => {
    const who = await createTestUser("proposal-canvas");
    actAs(who);
    const input = {
      title: "Food delivery",
      scene: scene([text("t1", "Order service")]),
      proposal: { id: `diagram-${Date.now()}`, ...counts },
    };
    const first = ok(await createCanvas(input));
    expect(errorOf(await createCanvas(input)).code).toBe("CONFLICT");
    // The second apply rolled back with the audit row: still exactly one canvas.
    expect(await db.select().from(canvases).where(eq(canvases.userId, who.id))).toHaveLength(1);
    const rows = await db.select().from(auditLog).where(eq(auditLog.userId, who.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "CANVAS",
      action: "canvas.draw",
      summary: "Drew a diagram: 6 sections, 24 boxes, 31 connections",
    });
    expect(rows[0]!.entityRefs).toEqual([{ type: "canvas", id: first.id }]);
    expect(JSON.stringify(rows[0])).not.toContain("Order service");
    expect(JSON.stringify(rows[0])).not.toContain("Food delivery");
  });

  it("adds a diagram to a canvas once, through the same version check", async () => {
    const who = await createTestUser("proposal-add");
    const c = await make(who, { title: "Mine" });
    const proposal = { id: `add-${Date.now()}`, sections: 0, boxes: 3, connections: 2 };
    expect(
      ok(await saveCanvas({ id: c.id, version: 1, scene: scene([text("t1", "Added")]), proposal })),
    ).toMatchObject({ outcome: "saved", version: 2 });
    expect(
      errorOf(
        await saveCanvas({ id: c.id, version: 2, scene: scene([text("t1", "Again")]), proposal }),
      ).code,
    ).toBe("CONFLICT");
    // The refused apply changed nothing, and a stale version never writes an audit row.
    expect((await rowOf(c.id)).sceneText).toContain("Added");
    const stale = { id: `stale-${Date.now()}`, sections: 1, boxes: 1, connections: 0 };
    expect(
      ok(await saveCanvas({ id: c.id, version: 1, scene: scene([]), proposal: stale })),
    ).toEqual({ outcome: "conflict", version: 2 });
    const rows = await db.select().from(auditLog).where(eq(auditLog.userId, who.id));
    expect(rows.map((r) => r.summary)).toEqual([
      "Added a diagram to a canvas: 3 boxes, 2 connections",
    ]);
  });

  it("takes only numbers for the audit row, from a person who is signed in", async () => {
    actAs(alice);
    const bad = [
      { id: "short", ...counts },
      { id: "diagram-12345678", sections: -1, boxes: 1, connections: 0 },
      { id: "diagram-12345678", sections: 1, boxes: 0, connections: 0 },
      { id: "diagram-12345678", sections: 1, boxes: 61, connections: 0 },
      { id: "diagram-12345678", ...counts, summary: "forged text" },
    ];
    for (const proposal of bad) {
      expect(
        errorOf(await createCanvas({ scene: scene([]), proposal })).code,
        JSON.stringify(proposal),
      ).toBe("VALIDATION_ERROR");
    }
    // A proposal with no scene to count is refused, too.
    expect(
      errorOf(await createCanvas({ proposal: { id: "diagram-12345678", ...counts } })).code,
    ).toBe("VALIDATION_ERROR");
    expect(errorOf(await createCanvas({ proposalId: "diagram-12345678", summary: "x" })).code).toBe(
      "VALIDATION_ERROR",
    );
  });
});

describe("the limit", () => {
  it("allows 100 canvases per person, counts archived ones, and frees a place when one is trashed", async () => {
    const who = await createTestUser("limit-canvas");
    await db.insert(canvases).values(
      Array.from({ length: CANVAS_LIMIT }, (_, i) => ({
        userId: who.id,
        title: `c${i}`,
        sceneJson: { v: 1 as const, elements: [], appState: {} },
        archivedAt: i === 0 ? new Date() : null,
      })),
    );
    actAs(who);
    expect(errorOf(await createCanvas({ title: "one too many" })).code).toBe("QUOTA_EXCEEDED");
    const [first] = await db
      .select({ id: canvases.id })
      .from(canvases)
      .where(eq(canvases.userId, who.id))
      .limit(1);
    ok(await deleteCanvas({ id: first!.id }));
    ok(await createCanvas({ title: "fits now" }));
    // Restoring the trashed one would be the 101st.
    expect(errorOf(await restoreCanvas({ id: first!.id })).code).toBe("QUOTA_EXCEEDED");
  });
});
