import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createCanvas,
  deleteCanvas,
  loadCanvasStickies,
  permanentlyDeleteCanvas,
  restoreCanvas,
  saveCanvas,
} from "@/actions/canvases";
import {
  completeTask,
  createTask,
  deleteTask,
  restoreTask,
  setTaskStatus,
  updateTask,
} from "@/actions/tasks";

import { db } from "@/db/client";
import { getNavCounts } from "@/db/queries/nav-counts";
import { searchWorkspace } from "@/db/queries/search";
import { listCanvasStickies, listStickiesForToday } from "@/db/queries/stickies";
import { countTasksByGroup, getTaskDetail, listClosedTasks, listTasks } from "@/db/queries/tasks";
import { changeLog, projects, tasks } from "@/db/schema";
import { uuidv7 } from "@/lib/ids";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V3 feature 01 slice D against a real database: a sticky note is an element of a drawing that carries a task. Saving the
// drawing keeps the tasks equal to the notes, in both directions, and the visibility rule (`plainTasks`) keeps them out
// of the task world while Today, search, Trash and the drawing itself see them.

const PREFS = { timezone: "UTC", startOfDay: "06:00" };
const TODAY = "2026-10-20";
const EMPTY = { v: 1, elements: [], appState: {} };

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-note");
  bob = await createTestUser("bob-note");
});

/** A note as the browser saves it: the rectangle that names its task, and the words bound to it. */
function note(id: string, text: string, over: { tone?: string; box?: string; x?: number } = {}) {
  const box = over.box ?? `box-${id.slice(-6)}`;
  const elements: Record<string, unknown>[] = [
    {
      id: box,
      type: "rectangle",
      x: over.x ?? 0,
      y: 0,
      width: 200,
      height: 200,
      backgroundColor: "#ffec99",
      customData: { dayboard: { sticky: { id, tone: over.tone ?? "amber" } } },
    },
  ];
  if (text) {
    elements.push({
      id: `${box}-t`,
      type: "text",
      containerId: box,
      text,
      originalText: text,
      x: 0,
      y: 0,
    });
  }
  return elements;
}
const scene = (...notes: Record<string, unknown>[][]) => ({
  v: 1,
  elements: notes.flat(),
  appState: {},
});

async function canvas(owner: TestUser = alice, title = "Planning") {
  actAs(owner);
  const made = ok(await createCanvas({ title }));
  return { id: made.id, version: made.version };
}

/** Saves a scene at the canvas's current version and returns the new one. */
async function save(c: { id: string }, version: number, s: unknown) {
  const result = ok(await saveCanvas({ id: c.id, version, scene: s }));
  if (result.outcome !== "saved") throw new Error("conflict");
  return result;
}
const row = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0]!;
const rowsOf = async (canvasId: string) =>
  db.select().from(tasks).where(eq(tasks.stickyCanvasId, canvasId));

describe("a new note makes a task", () => {
  it("takes its title from the first line, its description from the rest, its colour, project and a Planned status", async () => {
    actAs(alice);
    const [project] = await db
      .insert(projects)
      .values({ userId: alice.id, name: "Launch" })
      .returning();
    const c = await canvas();
    ok(
      await (
        await import("@/actions/canvases")
      ).updateCanvasMeta({ id: c.id, projectId: project!.id }),
    );
    const id = uuidv7();
    await save(
      c,
      1,
      scene(note(id, "Call the plumber\nask about the leak\n\nbring photos", { tone: "blue" })),
    );
    expect(await row(id)).toMatchObject({
      kind: "STICKY",
      title: "Call the plumber",
      descriptionText: "ask about the leak\n\nbring photos",
      status: "PLANNED",
      stickyTone: "blue",
      stickyCanvasId: c.id,
      projectId: project!.id,
      userId: alice.id,
    });
    const listed = ok(await loadCanvasStickies({ id: c.id }));
    expect(listed[0]).toMatchObject({
      id,
      text: "Call the plumber\nask about the leak\n\nbring photos",
      status: "PLANNED",
    });
  });

  it("an empty note carries the placeholder title and shows as no words", async () => {
    const c = await canvas();
    const id = uuidv7();
    await save(c, 1, scene(note(id, "")));
    expect((await row(id)).title).toBe("Untitled sticky");
    expect(ok(await loadCanvasStickies({ id: c.id }))[0]!.text).toBe("");
  });

  it("notes on a new canvas that arrives with a scene are made too", async () => {
    actAs(alice);
    const id = uuidv7();
    const made = ok(
      await createCanvas({ title: "Pasted", scene: scene(note(id, "Born with the canvas")) }),
    );
    expect((await row(id)).stickyCanvasId).toBe(made.id);
  });

  it("refuses more than 600 characters and more than 500 notes, and saves nothing", async () => {
    const c = await canvas();
    const id = uuidv7();
    const tooLong = errorOf(
      await saveCanvas({ id: c.id, version: 1, scene: scene(note(id, "a".repeat(601))) }),
    );
    expect(tooLong.code).toBe("VALIDATION_ERROR");
    const many = Array.from({ length: 501 }, (_, i) => note(uuidv7(), `n${i}`, { x: i }));
    const quota = errorOf(await saveCanvas({ id: c.id, version: 1, scene: scene(...many) }));
    expect(quota.code).toBe("QUOTA_EXCEEDED");
    expect(await rowsOf(c.id)).toEqual([]);
  });
});

describe("the note and the task stay equal", () => {
  it("words typed on the drawing change the task; a colour change follows", async () => {
    const c = await canvas();
    const id = uuidv7();
    let v = (await save(c, 1, scene(note(id, "First")))).version;
    v = (await save(c, v, scene(note(id, "Second line\nwith more", { tone: "pink" })))).version;
    expect(await row(id)).toMatchObject({
      title: "Second line",
      descriptionText: "with more",
      stickyTone: "pink",
    });
    expect(v).toBe(3);
  });

  it("a stale scene does not undo an edit made in the task panel", async () => {
    const c = await canvas();
    const id = uuidv7();
    let v = (await save(c, 1, scene(note(id, "Original")))).version;
    // The task is renamed elsewhere (the task panel), and the drawing, unchanged, is saved again.
    ok(await updateTask({ id, title: "Renamed in the panel" }));
    v = (await save(c, v, scene(note(id, "Original", { x: 400 })))).version;
    expect((await row(id)).title).toBe("Renamed in the panel");
    expect(v).toBe(3);
    // The page then takes the task's words onto the note.
    expect(ok(await loadCanvasStickies({ id: c.id }))[0]!.text).toBe("Renamed in the panel");
  });

  it("a note taken off the drawing sends its task to Trash; Undo brings both back", async () => {
    const c = await canvas();
    const id = uuidv7();
    let v = (await save(c, 1, scene(note(id, "Temporary")))).version;
    v = (await save(c, v, EMPTY)).version;
    expect((await row(id)).deletedAt).not.toBeNull();
    expect(ok(await loadCanvasStickies({ id: c.id }))).toEqual([]);
    await save(c, v, scene(note(id, "Temporary")));
    expect((await row(id)).deletedAt).toBeNull();
  });

  it("a task deleted in the panel stays deleted while the note is still on the drawing", async () => {
    const c = await canvas();
    const id = uuidv7();
    const v = (await save(c, 1, scene(note(id, "Deleted elsewhere")))).version;
    ok(await deleteTask({ id }));
    await save(c, v, scene(note(id, "Deleted elsewhere", { x: 50 })));
    expect((await row(id)).deletedAt).not.toBeNull();
    // It comes back only through a restore, and the page drops the note when it sees the task gone.
    ok(await restoreTask({ id }));
    expect((await row(id)).deletedAt).toBeNull();
  });

  it("every note write is a task write in the sync log", async () => {
    const c = await canvas();
    const id = uuidv7();
    const v = (await save(c, 1, scene(note(id, "Logged")))).version;
    await save(c, v, scene(note(id, "Logged again")));
    const entries = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.userId, alice.id), eq(changeLog.entityId, id)));
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...entries.map((e) => e.version))).toBe((await row(id)).version);
  });
});

describe("ids that belong to something else", () => {
  it("a note pasted from another canvas gets a task of its own and the scene is rewritten", async () => {
    const first = await canvas(alice, "Source");
    const second = await canvas(alice, "Copy");
    const id = uuidv7();
    await save(first, 1, scene(note(id, "Original")));
    const result = await save(second, 1, scene(note(id, "A copy", { box: "pasted-box" })));
    expect(result.remap).toEqual([{ element: "pasted-box", id: expect.any(String) }]);
    const newId = result.remap![0]!.id;
    expect(newId).not.toBe(id);
    expect(await row(newId)).toMatchObject({ title: "A copy", stickyCanvasId: second.id });
    expect(await row(id)).toMatchObject({ title: "Original", stickyCanvasId: first.id });
    // What is stored carries the new id.
    const stored = ok(await loadCanvasStickies({ id: second.id }));
    expect(stored.map((s) => s.id)).toEqual([newId]);
  });

  it("someone else's task id is never touched, and the note still gets a task", async () => {
    const theirs = await canvas(bob, "Bob's");
    const id = uuidv7();
    await save(theirs, 1, scene(note(id, "Bob's note")));
    const mine = await canvas(alice, "Mine");
    const result = await save(mine, 1, scene(note(id, "Alice tries", { box: "stolen" })));
    expect(result.remap).toHaveLength(1);
    expect(await row(id)).toMatchObject({ userId: bob.id, title: "Bob's note", deletedAt: null });
  });

  it("two notes with one id on one canvas: the first keeps it, the second gets its own", async () => {
    const c = await canvas();
    const id = uuidv7();
    const result = await save(
      c,
      1,
      scene(note(id, "One", { box: "a" }), note(id, "Two", { box: "b", x: 300 })),
    );
    expect(result.remap).toEqual([{ element: "b", id: expect.any(String) }]);
    expect((await row(id)).title).toBe("One");
    expect((await rowsOf(c.id)).map((t) => t.title).sort()).toEqual(["One", "Two"]);
  });
});

describe("where sticky notes show up", () => {
  it("they are absent from the task lists, counts and nav numbers, and present in the task detail, search and Trash", async () => {
    const who = await createTestUser("visibility-note");
    actAs(who);
    const made = ok(await createCanvas({ title: "Visible" }));
    const id = uuidv7();
    await save(made, 1, scene(note(id, "Hidden from lists")));
    ok(await updateTask({ id, dueDate: TODAY }));
    ok(await createTask({ title: "Ordinary", dueDate: TODAY }));

    expect((await listTasks(who.id)).map((t) => t.title)).toEqual(["Ordinary"]);
    expect(await countTasksByGroup(who.id)).toEqual({ open: 1, done: 0 });
    expect((await getNavCounts(who.id, PREFS, new Date(`${TODAY}T12:00:00Z`))).today).toBe(1);
    expect((await getTaskDetail(who.id, id))?.kind).toBe("STICKY");

    const found = await searchWorkspace(
      who.id,
      {
        q: "Hidden",
        tab: "task",
        status: null,
        projectId: null,
        tagId: null,
        from: null,
        to: null,
      },
      PREFS,
      10,
    );
    expect(found.task[0]).toMatchObject({
      id,
      stickyCanvasId: made.id,
      href: `/canvases/${made.id}?sticky=${id}`,
    });

    // A canvas in Trash hides its notes from search.
    ok(await deleteCanvas({ id: made.id }));
    const hidden = await searchWorkspace(
      who.id,
      {
        q: "Hidden",
        tab: "task",
        status: null,
        projectId: null,
        tagId: null,
        from: null,
        to: null,
      },
      PREFS,
      10,
    );
    expect(hidden.task).toEqual([]);
  });

  it("completing a sticky shows it done on the drawing's tasks, and a closed one leaves the task lists' closed tab", async () => {
    const who = await createTestUser("done-note");
    actAs(who);
    const made = ok(await createCanvas({ title: "Done" }));
    const id = uuidv7();
    await save(made, 1, scene(note(id, "Finish me")));
    ok(await completeTask({ id }));
    expect((await listCanvasStickies(who.id, made.id))[0]).toMatchObject({ status: "DONE" });
    expect(await listClosedTasks(who.id)).toEqual([]);
  });

  it("Today lists open notes that are In progress or due today or overdue, on live canvases, newest first", async () => {
    const who = await createTestUser("today-note");
    actAs(who);
    const made = ok(await createCanvas({ title: "Week" }));
    const ids = Array.from({ length: 7 }, () => uuidv7());
    const [doing, overdue, dueToday, later, none, done, cancelled] = ids as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    await save(
      made,
      1,
      scene(
        note(doing, "Doing now", { x: 0 }),
        note(overdue, "Overdue", { x: 300 }),
        note(dueToday, "Due today", { x: 600 }),
        note(later, "Due later", { x: 900 }),
        note(none, "No date", { x: 1200 }),
        note(done, "Done already", { x: 1500 }),
        note(cancelled, "Cancelled", { x: 1800 }),
      ),
    );
    ok(await setTaskStatus({ id: doing, status: "IN_PROGRESS" }));
    ok(await updateTask({ id: overdue, dueDate: "2026-10-10" }));
    ok(await updateTask({ id: dueToday, dueDate: TODAY }));
    ok(await updateTask({ id: later, dueDate: "2026-12-01" }));
    ok(await completeTask({ id: done }));
    ok(await setTaskStatus({ id: cancelled, status: "CANCELLED" }));

    const result = await listStickiesForToday(who.id, TODAY);
    expect(result.total).toBe(3);
    expect(result.rows.map((r) => r.title).sort()).toEqual(["Doing now", "Due today", "Overdue"]);
    expect(result.rows[0]).toMatchObject({ canvasId: made.id, canvasTitle: "Week" });

    ok(await completeTask({ id: doing }));
    expect((await listStickiesForToday(who.id, TODAY)).total).toBe(2);

    ok(await deleteCanvas({ id: made.id }));
    expect((await listStickiesForToday(who.id, TODAY)).total).toBe(0);
    ok(await restoreCanvas({ id: made.id }));
    expect((await listStickiesForToday(who.id, TODAY)).total).toBe(2);
  });
});

describe("a note's task is still a task", () => {
  it("cannot repeat or have subtasks", async () => {
    const c = await canvas();
    const id = uuidv7();
    await save(c, 1, scene(note(id, "No repeats")));
    ok(await updateTask({ id, dueDate: TODAY }));
    expect(errorOf(await updateTask({ id, recurrenceRule: "FREQ=DAILY" })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(errorOf(await createTask({ title: "child", parentTaskId: id })).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("cannot come back from Trash while its canvas is in Trash", async () => {
    const c = await canvas();
    const id = uuidv7();
    await save(c, 1, scene(note(id, "Needs its canvas")));
    ok(await deleteTask({ id }));
    ok(await deleteCanvas({ id: c.id }));
    expect(errorOf(await restoreTask({ id })).code).toBe("CONFLICT");
    ok(await restoreCanvas({ id: c.id }));
    ok(await restoreTask({ id }));
  });

  it("deleting the canvas for good deletes its notes and logs each one", async () => {
    const c = await canvas();
    const a = uuidv7();
    const b = uuidv7();
    await save(c, 1, scene(note(a, "A"), note(b, "B", { x: 300 })));
    ok(await deleteCanvas({ id: c.id }));
    ok(await permanentlyDeleteCanvas({ id: c.id }));
    expect(
      await db
        .select()
        .from(tasks)
        .where(inArray(tasks.id, [a, b])),
    ).toEqual([]);
    const log = await db
      .select()
      .from(changeLog)
      .where(
        and(
          eq(changeLog.userId, alice.id),
          eq(changeLog.op, "DELETE"),
          inArray(changeLog.entityId, [a, b]),
        ),
      );
    expect(log).toHaveLength(2);
  });

  it("another person cannot read or save a canvas's notes", async () => {
    const c = await canvas(alice);
    const id = uuidv7();
    await save(c, 1, scene(note(id, "Private")));
    actAs(bob);
    expect(errorOf(await loadCanvasStickies({ id: c.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await saveCanvas({ id: c.id, version: 2, scene: EMPTY })).code).toBe(
      "NOT_FOUND",
    );
    expect((await row(id)).title).toBe("Private");
  });
});
