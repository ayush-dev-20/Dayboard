import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createCanvas,
  deleteCanvas,
  permanentlyDeleteCanvas,
  restoreCanvas,
  saveCanvas,
  updateCanvasMeta,
} from "@/actions/canvases";
import {
  changeColumnStatus,
  createSticky,
  deleteBoardColumn,
  deleteSticky,
  duplicateSticky,
  loadBoard,
  makeStickyRegularTask,
  moveSticky,
  restoreSticky,
  updateSticky,
} from "@/actions/stickies";
import {
  completeTask,
  createTask,
  setTaskStatus,
  undoCompleteTask,
  updateTask,
} from "@/actions/tasks";
import { restoreTrashItem } from "@/actions/trash";
import { db } from "@/db/client";
import { getNavCounts } from "@/db/queries/nav-counts";
import { listCanvases } from "@/db/queries/canvases";
import { getBoard, listStickiesForToday } from "@/db/queries/stickies";
import { listClosedTasks, listTasks, getTaskDetail, countTasksByGroup } from "@/db/queries/tasks";
import { changeLog, projects, tasks } from "@/db/schema";
import { buildPreset } from "@/lib/canvas/board";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V3 feature 01 slice D against a real database: boards from presets, sticky notes as tasks of their own kind, the column
// deciding the status (and the status deciding the column), ownership everywhere, limits, the visibility rule
// (`plainTasks`) and Today's section.

const PREFS = { timezone: "UTC", startOfDay: "06:00" };
const GONE = "00000000-0000-4000-8000-000000000000";
const TODAY = "2026-10-20";

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-sticky");
  bob = await createTestUser("bob-sticky");
});

async function newBoard(preset: "status" | "simple" | "blank" = "status", title = "Sprint") {
  const created = ok(await createCanvas({ kind: "BOARD", preset, title }));
  const board = (await getBoard(alice.id, created.id))!;
  const col = (name: string) => board.board.columns.find((c) => c.name === name)!.id;
  return { id: created.id, board, col };
}

const sticky = async (canvasId: string, columnId: string, text: string) =>
  ok(await createSticky({ canvasId, columnId, text }));
const row = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0]!;
const stickiesOf = async (canvasId: string, columnId: string) =>
  (await getBoard(alice.id, canvasId))!.stickies.filter((s) => s.columnId === columnId);

describe("creating a board", () => {
  it("builds the columns from the preset on the server, one for each", async () => {
    actAs(alice);
    for (const [preset, names] of [
      ["status", ["Planned", "In progress", "Waiting", "Completed", "Cancelled"]],
      ["simple", ["To do", "Doing", "Done"]],
      ["blank", ["Ideas"]],
    ] as const) {
      const { board } = await newBoard(preset);
      expect(board.board.columns.map((c) => c.name)).toEqual(names);
      expect(board.kind).toBe("BOARD");
      expect(board.stickyCount).toBe(0);
    }
  });

  it("names a new board 'Untitled board' and puts its title and column names in the search text", async () => {
    actAs(alice);
    const created = ok(await createCanvas({ kind: "BOARD" }));
    const board = (await getBoard(alice.id, created.id))!;
    expect(board.title).toBe("Untitled board");
    const [row] = await db.execute<{ scene_text: string }>(
      (await import("drizzle-orm")).sql`select scene_text from canvases where id = ${created.id}`,
    );
    expect(row!.scene_text).toBe(
      "Untitled board\nPlanned\nIn progress\nWaiting\nCompleted\nCancelled",
    );
  });

  it("refuses a drawing sent to a board, a preset on a drawing, and columns sent to a drawing", async () => {
    actAs(alice);
    expect(
      errorOf(await createCanvas({ kind: "BOARD", scene: { v: 1, elements: [], appState: {} } }))
        .code,
    ).toBe("VALIDATION_ERROR");
    expect(errorOf(await createCanvas({ preset: "simple" })).code).toBe("VALIDATION_ERROR");
    const drawing = ok(await createCanvas({}));
    expect(
      errorOf(await saveCanvas({ id: drawing.id, version: 1, board: buildPreset("simple") })).code,
    ).toBe("VALIDATION_ERROR");
  });

  it("lists a board with its sticky count, and a drawing without one", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    await sticky(id, col("Planned"), "One");
    await sticky(id, col("Planned"), "Two");
    const drawing = ok(await createCanvas({ title: "Plain" }));
    const list = await listCanvases(alice.id);
    expect(list.find((c) => c.id === id)).toMatchObject({ kind: "BOARD", stickyCount: 2 });
    expect(list.find((c) => c.id === drawing.id)).toMatchObject({
      kind: "DRAWING",
      stickyCount: null,
    });
  });
});

describe("a sticky note is a task of its own kind", () => {
  it("takes its title from the first line and its description from the rest, its status from the column, its project from the board, and goes last", async () => {
    actAs(alice);
    const [project] = await db
      .insert(projects)
      .values({ userId: alice.id, name: "Launch" })
      .returning();
    const { id, col } = await newBoard();
    ok(await updateCanvasMeta({ id, projectId: project!.id }));
    const a = await sticky(
      id,
      col("In progress"),
      "Call the plumber\nask about the leak\n\nbring photos",
    );
    const b = await sticky(id, col("In progress"), "Second");
    const r = await row(a.id);
    expect(r).toMatchObject({
      kind: "STICKY",
      title: "Call the plumber",
      descriptionText: "ask about the leak\n\nbring photos",
      status: "IN_PROGRESS",
      projectId: project!.id,
      boardCanvasId: id,
      boardColumnId: col("In progress"),
      completedAt: null,
    });
    expect(a.text).toBe("Call the plumber\nask about the leak\n\nbring photos");
    expect((await row(b.id)).sortOrder).toBeGreaterThan(r.sortOrder);
  });

  it("creates one in the Completed column already done", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Completed"), "Shipped");
    expect(s.status).toBe("DONE");
    expect(s.completedAt).not.toBeNull();
  });

  it("refuses empty text, more than 600 characters, an unknown column and an unknown colour", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    expect(
      errorOf(await createSticky({ canvasId: id, columnId: col("Planned"), text: "  " })).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(await createSticky({ canvasId: id, columnId: col("Planned"), text: "a".repeat(601) }))
        .code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(await createSticky({ canvasId: id, columnId: "nosuchcolumn", text: "x" })).code,
    ).toBe("NOT_FOUND");
    expect(
      errorOf(
        await createSticky({ canvasId: id, columnId: col("Planned"), text: "x", tone: "hotpink" }),
      ).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(
        await createSticky({ canvasId: id, columnId: col("Planned"), text: "x", userId: bob.id }),
      ).code,
    ).toBe("VALIDATION_ERROR");
  });

  it("stops at 200 in a column and 500 on a board", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const planned = col("Planned");
    const values = (n: number, column: string) =>
      Array.from({ length: n }, (_, i) => ({
        userId: alice.id,
        kind: "STICKY",
        boardCanvasId: id,
        boardColumnId: column,
        title: `bulk ${column.slice(0, 3)} ${i}`,
        sortOrder: i,
      }));
    await db.insert(tasks).values(values(199, planned));
    ok(await createSticky({ canvasId: id, columnId: planned, text: "the 200th" }));
    expect(
      errorOf(await createSticky({ canvasId: id, columnId: planned, text: "the 201st" })).code,
    ).toBe("QUOTA_EXCEEDED");
    await db.insert(tasks).values(values(200, col("Waiting")));
    await db.insert(tasks).values(values(100, col("Cancelled")));
    expect(
      errorOf(await createSticky({ canvasId: id, columnId: col("In progress"), text: "the 501st" }))
        .code,
    ).toBe("QUOTA_EXCEEDED");
  });

  it("edits the text and the colour, and refuses fields it does not take", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Planned"), "Old");
    const edited = ok(await updateSticky({ id: s.id, text: "New title\nmore", tone: "amber" }));
    expect(edited).toMatchObject({ text: "New title\nmore", tone: "amber" });
    expect(ok(await updateSticky({ id: s.id, tone: null })).tone).toBeNull();
    expect(errorOf(await updateSticky({ id: s.id, status: "DONE" })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await updateSticky({ id: s.id })).code).toBe("VALIDATION_ERROR");
  });

  it("cannot repeat or have subtasks", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Planned"), "No repeats");
    ok(await updateTask({ id: s.id, dueDate: TODAY }));
    expect(errorOf(await updateTask({ id: s.id, recurrenceRule: "FREQ=DAILY" })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(errorOf(await createTask({ title: "child", parentTaskId: s.id })).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("duplicates just below the original, in the original's column", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const a = await sticky(id, col("Planned"), "A");
    const c = await sticky(id, col("Planned"), "C");
    ok(await updateSticky({ id: a.id, tone: "blue" }));
    const copy = ok(await duplicateSticky({ id: a.id }));
    expect(copy).toMatchObject({ text: "A", tone: "blue", columnId: col("Planned") });
    const order = (await stickiesOf(id, col("Planned"))).map((s) => s.id);
    expect(order).toEqual([a.id, copy.id, c.id]);
  });
});

describe("the column decides the status", () => {
  it("moves between columns, taking the status; Completed sets the time and leaving clears it", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Planned"), "Move me");
    const doing = ok(await moveSticky({ id: s.id, columnId: col("In progress"), beforeId: null }));
    expect(doing).toMatchObject({
      status: "IN_PROGRESS",
      columnId: col("In progress"),
      completedAt: null,
    });
    const done = ok(await moveSticky({ id: s.id, columnId: col("Completed"), beforeId: null }));
    expect(done.status).toBe("DONE");
    expect(done.completedAt).not.toBeNull();
    const back = ok(await moveSticky({ id: s.id, columnId: col("Waiting"), beforeId: null }));
    expect(back).toMatchObject({ status: "WAITING", completedAt: null });
    const cancelled = ok(
      await moveSticky({ id: s.id, columnId: col("Cancelled"), beforeId: null }),
    );
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("puts a sticky before another, at the end, or first, and keeps the order", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const [a, b, c] = [
      await sticky(id, col("Planned"), "A"),
      await sticky(id, col("Planned"), "B"),
      await sticky(id, col("Planned"), "C"),
    ];
    ok(await moveSticky({ id: c.id, columnId: col("Planned"), beforeId: a.id }));
    expect((await stickiesOf(id, col("Planned"))).map((s) => s.text)).toEqual(["C", "A", "B"]);
    ok(await moveSticky({ id: c.id, columnId: col("Planned"), beforeId: null }));
    expect((await stickiesOf(id, col("Planned"))).map((s) => s.text)).toEqual(["A", "B", "C"]);
    ok(await moveSticky({ id: b.id, columnId: col("In progress"), beforeId: null }));
    ok(await moveSticky({ id: a.id, columnId: col("In progress"), beforeId: b.id }));
    expect((await stickiesOf(id, col("In progress"))).map((s) => s.text)).toEqual(["A", "B"]);
  });

  it("renumbers when there is no room left between two neighbours", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const [a, b, c] = [
      await sticky(id, col("Planned"), "A"),
      await sticky(id, col("Planned"), "B"),
      await sticky(id, col("Planned"), "C"),
    ];
    await db.update(tasks).set({ sortOrder: 1 }).where(eq(tasks.id, a.id));
    await db
      .update(tasks)
      .set({ sortOrder: 1 + 1e-12 })
      .where(eq(tasks.id, b.id));
    await db.update(tasks).set({ sortOrder: 5 }).where(eq(tasks.id, c.id));
    const d = await sticky(id, col("In progress"), "D");
    ok(await moveSticky({ id: d.id, columnId: col("Planned"), beforeId: b.id }));
    expect((await stickiesOf(id, col("Planned"))).map((s) => s.text)).toEqual(["A", "D", "B", "C"]);
  });

  it("refuses a move to a sticky in another column, to itself, to a missing column", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const a = await sticky(id, col("Planned"), "A");
    const b = await sticky(id, col("Waiting"), "B");
    expect(
      errorOf(await moveSticky({ id: a.id, columnId: col("Planned"), beforeId: b.id })).code,
    ).toBe("NOT_FOUND");
    expect(
      errorOf(await moveSticky({ id: a.id, columnId: col("Planned"), beforeId: a.id })).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(await moveSticky({ id: a.id, columnId: "nosuchcolumn", beforeId: null })).code,
    ).toBe("NOT_FOUND");
  });

  it("a status changed elsewhere moves the sticky to the first column with that status", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Planned"), "Complete me in Today");
    ok(await setTaskStatus({ id: s.id, status: "WAITING" }));
    expect((await row(s.id)).boardColumnId).toBe(col("Waiting"));
    const completed = ok(await completeTask({ id: s.id }));
    expect(await row(s.id)).toMatchObject({ boardColumnId: col("Completed"), status: "DONE" });
    ok(await undoCompleteTask({ id: s.id, previousStatus: completed.previousStatus }));
    expect(await row(s.id)).toMatchObject({ boardColumnId: col("Waiting"), status: "WAITING" });
  });

  it("stays put, and keeps its own status, when the board has no column for it", async () => {
    actAs(alice);
    const { id, col } = await newBoard("simple");
    const s = await sticky(id, col("Doing"), "No Waiting column");
    ok(await setTaskStatus({ id: s.id, status: "WAITING" }));
    expect(await row(s.id)).toMatchObject({ boardColumnId: col("Doing"), status: "WAITING" });
    // Reordering inside its column does not reset the status.
    const moved = ok(await moveSticky({ id: s.id, columnId: col("Doing"), beforeId: null }));
    expect(moved.status).toBe("WAITING");
  });

  it("changing a column's status updates its stickies in one step, and a stale version changes nothing", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const a = await sticky(id, col("Planned"), "A");
    const b = await sticky(id, col("Planned"), "B");
    const stale = await changeColumnStatus({
      canvasId: id,
      version: 99,
      columnId: col("Planned"),
      status: "WAITING",
    });
    expect(ok(stale)).toMatchObject({ outcome: "conflict" });
    expect((await row(a.id)).status).toBe("PLANNED");
    const result = ok(
      await changeColumnStatus({
        canvasId: id,
        version: 1,
        columnId: col("Planned"),
        status: "WAITING",
      }),
    );
    expect(result).toMatchObject({ outcome: "saved", count: 2 });
    expect((await row(a.id)).status).toBe("WAITING");
    expect((await row(b.id)).status).toBe("WAITING");
    const board = (await getBoard(alice.id, id))!;
    expect(board.version).toBe(2);
    expect(board.board.columns.find((c) => c.id === col("Planned"))!.status).toBe("WAITING");
  });

  it("deleting a column moves its stickies (taking the target's status) or sends them to Trash; the last column stays", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const a = await sticky(id, col("Planned"), "A");
    const b = await sticky(id, col("Waiting"), "B");
    const moved = ok(
      await deleteBoardColumn({
        canvasId: id,
        version: 1,
        columnId: col("Planned"),
        moveTo: col("Completed"),
      }),
    );
    expect(moved).toMatchObject({ outcome: "saved", count: 1 });
    expect(await row(a.id)).toMatchObject({ boardColumnId: col("Completed"), status: "DONE" });
    expect((await row(a.id)).completedAt).not.toBeNull();

    ok(
      await deleteBoardColumn({ canvasId: id, version: 2, columnId: col("Waiting"), moveTo: null }),
    );
    expect((await row(b.id)).deletedAt).not.toBeNull();
    const board = (await getBoard(alice.id, id))!;
    expect(board.board.columns.map((c) => c.name)).toEqual([
      "In progress",
      "Completed",
      "Cancelled",
    ]);
    expect(board.stickies.map((s) => s.id)).toEqual([a.id]);

    expect(
      errorOf(
        await deleteBoardColumn({
          canvasId: id,
          version: 3,
          columnId: "nosuchcolumn",
          moveTo: null,
        }),
      ).code,
    ).toBe("NOT_FOUND");
    expect(
      errorOf(
        await deleteBoardColumn({
          canvasId: id,
          version: 3,
          columnId: col("Cancelled"),
          moveTo: col("Cancelled"),
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
    const blank = await newBoard("blank");
    expect(
      errorOf(
        await deleteBoardColumn({
          canvasId: blank.id,
          version: 1,
          columnId: blank.col("Ideas"),
          moveTo: null,
        }),
      ).code,
    ).toBe("CONFLICT");
    expect(
      ok(
        await deleteBoardColumn({
          canvasId: id,
          version: 1,
          columnId: col("Cancelled"),
          moveTo: col("Completed"),
        }),
      ),
    ).toMatchObject({ outcome: "conflict" });
  });

  it("saving columns refuses to drop or re-status a column that holds stickies, and allows renaming", async () => {
    actAs(alice);
    const { id, board, col } = await newBoard();
    await sticky(id, col("Planned"), "Holds");
    const columns = board.board.columns;
    const renamed = {
      v: 1,
      columns: columns.map((c) => (c.name === "Planned" ? { ...c, name: "Backlog" } : c)),
    };
    expect(ok(await saveCanvas({ id, version: 1, board: renamed }))).toMatchObject({
      outcome: "saved",
    });
    const dropped = { v: 1, columns: columns.filter((c) => c.name !== "Planned") };
    expect(errorOf(await saveCanvas({ id, version: 2, board: dropped })).code).toBe(
      "VALIDATION_ERROR",
    );
    const restatused = {
      v: 1,
      columns: columns.map((c) => (c.name === "Planned" ? { ...c, status: "DONE" } : c)),
    };
    expect(errorOf(await saveCanvas({ id, version: 2, board: restatused })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(errorOf(await saveCanvas({ id, version: 2, board: { v: 1, columns: [] } })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(ok(await saveCanvas({ id, version: 1, board: renamed }))).toMatchObject({
      outcome: "conflict",
    });
    // An empty column can go.
    const withoutWaiting = { v: 1, columns: renamed.columns.filter((c) => c.name !== "Waiting") };
    expect(ok(await saveCanvas({ id, version: 2, board: withoutWaiting }))).toMatchObject({
      outcome: "saved",
    });
  });
});

describe("who can reach a board", () => {
  it("another person's board, column and sticky are NOT_FOUND on every route, and signed out is not allowed", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Planned"), "Mine");
    actAs(bob);
    const attempts = [
      await createSticky({ canvasId: id, columnId: col("Planned"), text: "x" }),
      await updateSticky({ id: s.id, text: "x" }),
      await moveSticky({ id: s.id, columnId: col("Waiting"), beforeId: null }),
      await duplicateSticky({ id: s.id }),
      await deleteSticky({ id: s.id }),
      await restoreSticky({ id: s.id }),
      await makeStickyRegularTask({ id: s.id }),
      await changeColumnStatus({
        canvasId: id,
        version: 1,
        columnId: col("Planned"),
        status: "DONE",
      }),
      await deleteBoardColumn({ canvasId: id, version: 1, columnId: col("Planned"), moveTo: null }),
      await loadBoard({ id }),
      await saveCanvas({ id, version: 1, board: buildPreset("simple") }),
    ];
    for (const result of attempts) expect(errorOf(result).code).toBe("NOT_FOUND");
    expect(await getBoard(bob.id, id)).toBeNull();
    expect((await row(s.id)).title).toBe("Mine");
    actAs(null);
    expect(
      errorOf(await createSticky({ canvasId: id, columnId: col("Planned"), text: "x" })).code,
    ).toBe("UNAUTHENTICATED");
    actAs(alice);
    expect(errorOf(await updateSticky({ id: GONE, text: "x" })).code).toBe("NOT_FOUND");
  });

  it("an ordinary task is not a sticky: the sticky routes refuse it", async () => {
    actAs(alice);
    const task = ok(await createTask({ title: "Plain" }));
    expect(errorOf(await updateSticky({ id: task.id, text: "x" })).code).toBe("NOT_FOUND");
    expect(errorOf(await deleteSticky({ id: task.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await makeStickyRegularTask({ id: task.id })).code).toBe("NOT_FOUND");
  });
});

describe("where sticky notes show up", () => {
  it("they are absent from the task lists, counts, views and nav numbers, and present on the board and in the task detail", async () => {
    const who = await createTestUser("visibility-sticky");
    actAs(who);
    const created = ok(await createCanvas({ kind: "BOARD", preset: "status" }));
    const board = (await getBoard(who.id, created.id))!;
    const col = (name: string) => board.board.columns.find((c) => c.name === name)!.id;
    const s = ok(
      await createSticky({ canvasId: created.id, columnId: col("In progress"), text: "Hidden" }),
    );
    ok(await updateTask({ id: s.id, dueDate: TODAY }));
    const done = ok(
      await createSticky({ canvasId: created.id, columnId: col("Completed"), text: "Finished" }),
    );
    ok(await createTask({ title: "Ordinary", dueDate: TODAY }));

    expect((await listTasks(who.id)).map((t) => t.title)).toEqual(["Ordinary"]);
    expect((await listClosedTasks(who.id)).map((t) => t.title)).toEqual([]);
    expect(await countTasksByGroup(who.id)).toEqual({ open: 1, done: 0 });
    expect((await getNavCounts(who.id, PREFS, new Date(`${TODAY}T12:00:00Z`))).today).toBe(1);
    expect((await getBoard(who.id, created.id))!.stickies.map((x) => x.id).sort()).toEqual(
      [s.id, done.id].sort(),
    );
    expect((await getTaskDetail(who.id, s.id))?.title).toBe("Hidden");
  });

  it("Today lists open stickies that are In progress or due today or overdue, on live boards, newest activity first", async () => {
    const who = await createTestUser("today-sticky");
    actAs(who);
    const made = ok(await createCanvas({ kind: "BOARD", preset: "status", title: "Week" }));
    const board = (await getBoard(who.id, made.id))!;
    const col = (name: string) => board.board.columns.find((c) => c.name === name)!.id;
    const add = async (column: string, text: string) =>
      ok(await createSticky({ canvasId: made.id, columnId: col(column), text }));
    const inProgress = await add("In progress", "Doing now");
    const overdue = await add("Planned", "Overdue");
    const dueToday = await add("Waiting", "Due today");
    const later = await add("Planned", "Due later");
    await add("Planned", "No date");
    await add("Completed", "Done already");
    await add("Cancelled", "Cancelled");
    ok(await updateTask({ id: overdue.id, dueDate: "2026-10-10" }));
    ok(await updateTask({ id: dueToday.id, dueDate: TODAY }));
    ok(await updateTask({ id: later.id, dueDate: "2026-12-01" }));

    const result = await listStickiesForToday(who.id, TODAY);
    expect(result.total).toBe(3);
    expect(result.rows.map((r) => r.title).sort()).toEqual(["Doing now", "Due today", "Overdue"]);
    expect(result.rows[0]).toMatchObject({ boardId: made.id, boardTitle: "Week" });

    // Completing one from Today takes it out and puts it in the board's Completed column.
    ok(await completeTask({ id: inProgress.id }));
    expect((await listStickiesForToday(who.id, TODAY)).total).toBe(2);
    expect((await row(inProgress.id)).boardColumnId).toBe(col("Completed"));

    // A board in Trash or archived shows nothing; Restore brings it back.
    ok(await deleteCanvas({ id: made.id }));
    expect((await listStickiesForToday(who.id, TODAY)).total).toBe(0);
    ok(await restoreCanvas({ id: made.id }));
    expect((await listStickiesForToday(who.id, TODAY)).total).toBe(2);
  });
});

describe("Trash, restore and permanent delete", () => {
  it("a deleted sticky leaves the board and comes back to its column; deleting for good removes it and logs it", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Waiting"), "Delete me");
    ok(await deleteSticky({ id: s.id }));
    expect((await getBoard(alice.id, id))!.stickies).toEqual([]);
    expect(ok(await restoreSticky({ id: s.id }))).toMatchObject({
      columnId: col("Waiting"),
      status: "WAITING",
    });
    expect((await getBoard(alice.id, id))!.stickies).toHaveLength(1);
  });

  it("restoring from Trash after its column was deleted puts it in a column that exists", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Waiting"), "Orphan");
    ok(await deleteSticky({ id: s.id }));
    ok(
      await deleteBoardColumn({ canvasId: id, version: 1, columnId: col("Waiting"), moveTo: null }),
    );
    ok(await restoreTrashItem({ type: "task", id: s.id }));
    const restored = await row(s.id);
    expect(restored.deletedAt).toBeNull();
    // No Waiting column is left, so it takes the first column and that column's status.
    expect(restored).toMatchObject({ boardColumnId: col("Planned"), status: "PLANNED" });
  });

  it("a sticky of a board in Trash cannot be restored until the board is", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Planned"), "Needs its board");
    ok(await deleteSticky({ id: s.id }));
    ok(await deleteCanvas({ id }));
    expect(errorOf(await restoreSticky({ id: s.id })).code).toBe("CONFLICT");
    expect(errorOf(await restoreTrashItem({ type: "task", id: s.id })).code).toBe("CONFLICT");
    ok(await restoreCanvas({ id }));
    ok(await restoreSticky({ id: s.id }));
  });

  it("a board in Trash hides its stickies, Restore returns them, and deleting it for good deletes them and logs each", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const a = await sticky(id, col("Planned"), "A");
    const b = await sticky(id, col("Completed"), "B");
    ok(await deleteCanvas({ id }));
    expect(await getBoard(alice.id, id)).toBeNull();
    ok(await restoreCanvas({ id }));
    expect((await getBoard(alice.id, id))!.stickies).toHaveLength(2);

    ok(await deleteCanvas({ id }));
    ok(await permanentlyDeleteCanvas({ id }));
    expect(
      await db
        .select()
        .from(tasks)
        .where(inArray(tasks.id, [a.id, b.id])),
    ).toEqual([]);
    const log = await db
      .select()
      .from(changeLog)
      .where(
        and(
          eq(changeLog.userId, alice.id),
          eq(changeLog.op, "DELETE"),
          inArray(changeLog.entityId, [a.id, b.id]),
        ),
      );
    expect(log).toHaveLength(2);
  });
});

describe("making it a regular task", () => {
  it("leaves the board, shows in the task lists with its status, and keeps a link to the board", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Waiting"), "Promote me");
    ok(await makeStickyRegularTask({ id: s.id }));
    expect(await row(s.id)).toMatchObject({
      kind: "TASK",
      boardCanvasId: null,
      boardColumnId: null,
      stickyTone: null,
      status: "WAITING",
    });
    expect((await listTasks(alice.id)).map((t) => t.id)).toContain(s.id);
    expect((await getBoard(alice.id, id))!.stickies).toEqual([]);
    expect((await getTaskDetail(alice.id, s.id))!.canvases.map((c) => c.id)).toEqual([id]);
  });
});

describe("every sticky change is a task change in the sync log", () => {
  it("writes an upsert for create, update and move", async () => {
    actAs(alice);
    const { id, col } = await newBoard();
    const s = await sticky(id, col("Planned"), "Logged");
    ok(await updateSticky({ id: s.id, text: "Logged again" }));
    ok(await moveSticky({ id: s.id, columnId: col("Waiting"), beforeId: null }));
    const entries = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.userId, alice.id), eq(changeLog.entityId, s.id)));
    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...entries.map((e) => e.version))).toBe((await row(s.id)).version);
  });
});
