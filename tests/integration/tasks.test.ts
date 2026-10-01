import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  archiveTask,
  completeTask,
  createTask,
  deleteTask,
  permanentlyDeleteTask,
  reorderTask,
  restoreTask,
  setTaskStatus,
  undoCompleteTask,
  unarchiveTask,
  updateTask,
  updateTaskDescription,
} from "@/actions/tasks";
import { db } from "@/db/client";
import { getTaskDetail, listClosedTasks, listTasks, countTasksByGroup } from "@/db/queries/tasks";
import { tasks } from "@/db/schema";
import { actAs, createTestUser, errorOf, ok, setPreferences, type TestUser } from "./harness";

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice");
  bob = await createTestUser("bob");
});

async function make(person: TestUser, input: Record<string, unknown> = {}) {
  actAs(person);
  return ok(await createTask({ title: "A task", ...input }));
}

async function row(id: string) {
  const [r] = await db.select().from(tasks).where(eq(tasks.id, id));
  return r!;
}

describe("creating and listing", () => {
  it("creates a task with sensible defaults, newest on top", async () => {
    const first = await make(alice, { title: "First" });
    const second = await make(alice, { title: "Second" });

    expect(first).toMatchObject({
      status: "PLANNED",
      priority: "NONE",
      dueDate: null,
      emoji: null,
    });
    expect(second.sortOrder).toBeLessThan(first.sortOrder);

    const titles = (await listTasks(alice.id)).map((t) => t.title);
    expect(titles.indexOf("Second")).toBeLessThan(titles.indexOf("First"));
  });

  it("takes the default priority from the person's preferences", async () => {
    const person = await createTestUser("prio");
    await setPreferences(person.id, { defaultTaskPriority: "HIGH" });
    expect((await make(person)).priority).toBe("HIGH");
    expect((await make(person, { priority: "LOW" })).priority).toBe("LOW");
  });

  it("stores emoji, dates and times, and trims the title", async () => {
    const task = await make(alice, {
      title: "  Call  ",
      emoji: "📞",
      dueDate: "2026-10-01",
      dueTime: "18:00",
    });
    expect(task).toMatchObject({
      title: "Call",
      emoji: "📞",
      dueDate: "2026-10-01",
      dueTime: "18:00",
    });
  });

  it("rejects bad input with field errors and unknown keys outright", async () => {
    actAs(alice);
    expect(errorOf(await createTask({ title: "   " })).fieldErrors?.title).toBe("Enter a title.");
    expect(errorOf(await createTask({ title: "x".repeat(501) })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await createTask({ title: "x", emoji: "ab" })).fieldErrors?.emoji).toBe(
      "Choose a single emoji.",
    );
    expect(
      errorOf(await createTask({ title: "x", dueDate: "2026-02-30" })).fieldErrors?.dueDate,
    ).toBe("Choose a valid date.");
    expect(errorOf(await createTask({ title: "x", dueTime: "18:00" })).fieldErrors?.dueTime).toBe(
      "Choose a due date first.",
    );
    expect(
      errorOf(await createTask({ title: "x", recurrenceRule: "FREQ=DAILY" })).fieldErrors
        ?.recurrenceRule,
    ).toBe("A repeating task needs a due date.");
    expect(
      errorOf(
        await createTask({ title: "x", recurrenceRule: "FREQ=HOURLY", dueDate: "2026-10-01" }),
      ).code,
    ).toBe("VALIDATION_ERROR");
    // A client can never choose the owner, or a project before projects exist.
    expect(errorOf(await createTask({ title: "x", userId: bob.id })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await createTask({ title: "x", projectId: crypto.randomUUID() })).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("requires a signed-in person", async () => {
    actAs(null);
    expect(errorOf(await createTask({ title: "x" })).code).toBe("UNAUTHENTICATED");
  });

  it("counts open and done tasks and lists closed ones separately", async () => {
    const person = await createTestUser("counts");
    const open = await make(person, { title: "Open" });
    const done = await make(person, { title: "Done" });
    ok(await completeTask({ id: done.id }));
    const cancelled = await make(person, { title: "Cancelled" });
    ok(await setTaskStatus({ id: cancelled.id, status: "CANCELLED" }));

    expect(await countTasksByGroup(person.id)).toEqual({ open: 1, done: 1 });
    expect((await listTasks(person.id)).map((t) => t.id)).toEqual([open.id]);
    expect((await listClosedTasks(person.id)).map((t) => t.title).sort()).toEqual([
      "Cancelled",
      "Done",
    ]);
  });
});

describe("subtasks", () => {
  it("adds subtasks one level deep, in order, and counts them", async () => {
    const parent = await make(alice, { title: "Parent" });
    const a = ok(await createTask({ title: "Sub A", parentTaskId: parent.id }));
    const b = ok(await createTask({ title: "Sub B", parentTaskId: parent.id }));
    expect(a.sortOrder).toBeLessThan(b.sortOrder);

    ok(await completeTask({ id: a.id }));
    const detail = await getTaskDetail(alice.id, parent.id);
    expect(detail?.subtasks.map((s) => s.title)).toEqual(["Sub A", "Sub B"]);
    expect(detail).toMatchObject({ subtaskTotal: 2, subtaskDone: 1 });

    // Subtasks don't show up as top-level rows, but the parent carries the count.
    const listed = (await listTasks(alice.id)).find((t) => t.id === parent.id);
    expect(listed).toMatchObject({ subtaskTotal: 2, subtaskDone: 1 });
    expect((await listTasks(alice.id)).some((t) => t.id === a.id)).toBe(false);
  });

  it("refuses to nest a subtask under a subtask", async () => {
    const parent = await make(alice);
    const sub = ok(await createTask({ title: "Sub", parentTaskId: parent.id }));
    const error = errorOf(await createTask({ title: "Deep", parentTaskId: sub.id }));
    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Subtasks can't have subtasks.",
    });
  });

  it("refuses a repeat on a subtask", async () => {
    const parent = await make(alice);
    const error = errorOf(
      await createTask({
        title: "S",
        parentTaskId: parent.id,
        dueDate: "2026-10-01",
        recurrenceRule: "FREQ=DAILY",
      }),
    );
    expect(error.fieldErrors?.recurrenceRule).toBe("Subtasks can't repeat.");

    const sub = ok(
      await createTask({ title: "S", parentTaskId: parent.id, dueDate: "2026-10-01" }),
    );
    expect(
      errorOf(await updateTask({ id: sub.id, recurrenceRule: "FREQ=DAILY" })).fieldErrors
        ?.recurrenceRule,
    ).toBe("Subtasks can't repeat.");
  });

  it("completing a parent leaves open subtasks open and says how many", async () => {
    const parent = await make(alice);
    ok(await createTask({ title: "S1", parentTaskId: parent.id }));
    ok(await createTask({ title: "S2", parentTaskId: parent.id }));
    const result = ok(await completeTask({ id: parent.id }));
    expect(result.openSubtasks).toBe(2);
    const detail = await getTaskDetail(alice.id, parent.id);
    expect(detail?.subtasks.every((s) => s.status === "PLANNED")).toBe(true);
  });
});

describe("editing", () => {
  it("updates fields independently", async () => {
    const task = await make(alice);
    const updated = ok(
      await updateTask({
        id: task.id,
        title: "Renamed",
        priority: "HIGH",
        emoji: "🎯",
        dueDate: "2026-10-05",
        dueTime: "09:30",
      }),
    );
    expect(updated).toMatchObject({
      title: "Renamed",
      priority: "HIGH",
      emoji: "🎯",
      dueDate: "2026-10-05",
      dueTime: "09:30",
    });

    const cleared = ok(await updateTask({ id: task.id, emoji: null }));
    expect(cleared.emoji).toBeNull();
    expect(cleared.title).toBe("Renamed");
  });

  it("removing the due date also removes its time and any repeat", async () => {
    const task = await make(alice, {
      dueDate: "2026-10-01",
      dueTime: "08:00",
      recurrenceRule: "FREQ=DAILY",
    });
    const result = ok(await updateTask({ id: task.id, dueDate: null }));
    expect(result).toMatchObject({ dueDate: null, dueTime: null, recurrenceRule: null });
  });

  it("removing the start date removes its time", async () => {
    const task = await make(alice, { startDate: "2026-10-01", startTime: "08:00" });
    expect(ok(await updateTask({ id: task.id, startDate: null }))).toMatchObject({
      startDate: null,
      startTime: null,
    });
  });

  it("a repeat needs a due date, checked against what is already saved", async () => {
    const task = await make(alice);
    expect(
      errorOf(await updateTask({ id: task.id, recurrenceRule: "FREQ=DAILY" })).fieldErrors
        ?.recurrenceRule,
    ).toBe("A repeating task needs a due date.");
    const dated = await make(alice, { dueDate: "2026-10-01" });
    expect(
      ok(await updateTask({ id: dated.id, recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE" }))
        .recurrenceRule,
    ).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(ok(await updateTask({ id: dated.id, recurrenceRule: null })).recurrenceRule).toBeNull();
  });

  it("a time needs a date, checked against what is already saved", async () => {
    const task = await make(alice);
    expect(errorOf(await updateTask({ id: task.id, dueTime: "09:00" })).fieldErrors?.dueTime).toBe(
      "Choose a due date first.",
    );
  });

  it("an update with nothing to change succeeds and changes nothing", async () => {
    const task = await make(alice);
    const same = ok(await updateTask({ id: task.id }));
    expect(same.updatedAt).toBe(task.updatedAt);
  });
});

describe("status", () => {
  it("completes, stamps completedAt, and is idempotent", async () => {
    const task = await make(alice, { status: "IN_PROGRESS" });
    const first = ok(await completeTask({ id: task.id }));
    expect(first).toMatchObject({ previousStatus: "IN_PROGRESS", nextOccurrenceId: null });
    expect(first.task.status).toBe("DONE");
    expect(first.task.completedAt).not.toBeNull();

    const again = ok(await completeTask({ id: task.id }));
    expect(again.previousStatus).toBe("DONE");
    expect(again.task.completedAt).toBe(first.task.completedAt);
  });

  it("keeps completedAt in step with DONE through every transition", async () => {
    const task = await make(alice);
    for (const status of [
      "IN_PROGRESS",
      "WAITING",
      "DONE",
      "CANCELLED",
      "DONE",
      "INBOX",
      "PLANNED",
    ] as const) {
      const updated = ok(await setTaskStatus({ id: task.id, status }));
      expect(updated.status).toBe(status);
      expect(updated.completedAt !== null).toBe(status === "DONE");
    }
  });

  it("undo goes back to the previous status, never to DONE", async () => {
    const task = await make(alice, { status: "WAITING" });
    const done = ok(await completeTask({ id: task.id }));
    const undone = ok(await undoCompleteTask({ id: task.id, previousStatus: done.previousStatus }));
    expect(undone.task).toMatchObject({ status: "WAITING", completedAt: null });

    const stray = ok(await undoCompleteTask({ id: task.id, previousStatus: "DONE" }));
    expect(stray.task.status).toBe("WAITING"); // not DONE, so nothing to undo
  });

  it("the database refuses a DONE task with no completion time", async () => {
    await expect(
      db.insert(tasks).values({ userId: alice.id, title: "Bad", status: "DONE", sortOrder: 0 }),
    ).rejects.toThrow();
    await expect(
      db.insert(tasks).values({
        userId: alice.id,
        title: "Bad",
        status: "PLANNED",
        completedAt: new Date(),
        sortOrder: 0,
      }),
    ).rejects.toThrow();
  });
});

describe("repeating tasks", () => {
  it("completing rolls forward from the due date, not from today", async () => {
    const task = await make(alice, {
      title: "Weekly review",
      emoji: "📋",
      priority: "HIGH",
      dueDate: "2020-01-06", // long overdue: the next one is still dated from this
      dueTime: "10:00",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
    });
    const result = ok(await completeTask({ id: task.id }));

    expect(result.nextOccurrenceId).toBeTruthy();
    const next = (await getTaskDetail(alice.id, result.nextOccurrenceId!))!;
    expect(next).toMatchObject({
      title: "Weekly review",
      emoji: "📋",
      priority: "HIGH",
      status: "PLANNED",
      dueDate: "2020-01-13",
      dueTime: "10:00",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
    });

    // The finished one is a plain completed task now; only the new one repeats.
    expect(result.task).toMatchObject({ status: "DONE", recurrenceRule: null });
    expect(result.task.dueDate).toBe("2020-01-06");
  });

  it("copies subtasks as open, shifted with the due date", async () => {
    const task = await make(alice, { dueDate: "2026-10-01", recurrenceRule: "FREQ=DAILY" });
    const sub = ok(
      await createTask({ title: "Step", parentTaskId: task.id, dueDate: "2026-10-01" }),
    );
    ok(await completeTask({ id: sub.id }));

    const result = ok(await completeTask({ id: task.id }));
    const next = (await getTaskDetail(alice.id, result.nextOccurrenceId!))!;
    expect(next.subtasks).toHaveLength(1);
    expect(next.subtasks[0]).toMatchObject({
      title: "Step",
      status: "PLANNED",
      dueDate: "2026-10-02",
    });
    expect(next.subtasks[0]!.id).not.toBe(sub.id);
  });

  it("undo removes the untouched next occurrence and puts the repeat back", async () => {
    const task = await make(alice, { dueDate: "2026-10-01", recurrenceRule: "FREQ=DAILY" });
    const done = ok(await completeTask({ id: task.id }));
    const undo = ok(
      await undoCompleteTask({
        id: task.id,
        previousStatus: done.previousStatus,
        nextOccurrenceId: done.nextOccurrenceId,
      }),
    );

    expect(undo.removedOccurrence).toBe(true);
    expect(undo.task).toMatchObject({
      status: "PLANNED",
      recurrenceRule: "FREQ=DAILY",
      dueDate: "2026-10-01",
    });
    expect(await getTaskDetail(alice.id, done.nextOccurrenceId!)).toBeNull();
  });

  it("undo keeps a next occurrence that has been edited, and doesn't make a duplicate repeat", async () => {
    const task = await make(alice, { dueDate: "2026-10-01", recurrenceRule: "FREQ=DAILY" });
    const done = ok(await completeTask({ id: task.id }));
    ok(await updateTask({ id: done.nextOccurrenceId!, title: "Edited since" }));

    const undo = ok(
      await undoCompleteTask({
        id: task.id,
        previousStatus: done.previousStatus,
        nextOccurrenceId: done.nextOccurrenceId,
      }),
    );
    expect(undo.removedOccurrence).toBe(false);
    expect(undo.task.recurrenceRule).toBeNull();
    expect((await getTaskDetail(alice.id, done.nextOccurrenceId!))?.title).toBe("Edited since");
  });

  it("finishing through the status menu rolls forward too", async () => {
    const task = await make(alice, {
      title: "Status menu repeat",
      dueDate: "2026-10-01",
      recurrenceRule: "FREQ=DAILY",
    });
    ok(await setTaskStatus({ id: task.id, status: "DONE" }));
    const next = (await listTasks(alice.id)).filter((t) => t.title === "Status menu repeat");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      dueDate: "2026-10-02",
      recurrenceRule: "FREQ=DAILY",
      status: "PLANNED",
    });
  });

  it("a task with a repeat but no due date can't exist in the database", async () => {
    await expect(
      db
        .insert(tasks)
        .values({ userId: alice.id, title: "Bad", recurrenceRule: "FREQ=DAILY", sortOrder: 0 }),
    ).rejects.toThrow();
  });
});

describe("manual order", () => {
  async function topLevelIds(person: TestUser) {
    return (await listTasks(person.id)).map((t) => t.id);
  }

  it("moves a task between two neighbours, to the top, and to the bottom", async () => {
    const person = await createTestUser("order");
    const a = await make(person, { title: "A" });
    const b = await make(person, { title: "B" });
    const c = await make(person, { title: "C" });
    // New tasks go on top, so the list is C, B, A.
    expect(await topLevelIds(person)).toEqual([c.id, b.id, a.id]);

    ok(await reorderTask({ id: a.id, beforeId: c.id, afterId: b.id })); // between C and B
    expect(await topLevelIds(person)).toEqual([c.id, a.id, b.id]);

    ok(await reorderTask({ id: b.id, afterId: c.id })); // to the very top
    expect(await topLevelIds(person)).toEqual([b.id, c.id, a.id]);

    ok(await reorderTask({ id: b.id, beforeId: a.id })); // to the very bottom
    expect(await topLevelIds(person)).toEqual([c.id, a.id, b.id]);
  });

  it("renumbers the whole list when two neighbours have no room between them", async () => {
    const person = await createTestUser("renumber");
    const a = await make(person, { title: "A" });
    const b = await make(person, { title: "B" });
    const c = await make(person, { title: "C" });
    // List is C, B, A. Squeeze B and A until the gap is gone.
    await db.update(tasks).set({ sortOrder: 1 }).where(eq(tasks.id, b.id));
    await db
      .update(tasks)
      .set({ sortOrder: 1 + 1e-12 })
      .where(eq(tasks.id, a.id));
    await db.update(tasks).set({ sortOrder: 0 }).where(eq(tasks.id, c.id));

    ok(await reorderTask({ id: c.id, beforeId: b.id, afterId: a.id })); // C between B and A
    expect(await topLevelIds(person)).toEqual([b.id, c.id, a.id]);

    const orders = (await listTasks(person.id)).map((t) => t.sortOrder);
    expect(new Set(orders).size).toBe(3);
    expect(orders[1]! - orders[0]!).toBeGreaterThan(1);
  });

  it("orders subtasks within their own parent", async () => {
    const parent = await make(alice);
    const s1 = ok(await createTask({ title: "1", parentTaskId: parent.id }));
    const s2 = ok(await createTask({ title: "2", parentTaskId: parent.id }));
    ok(await reorderTask({ id: s2.id, afterId: s1.id }));
    expect((await getTaskDetail(alice.id, parent.id))!.subtasks.map((s) => s.title)).toEqual([
      "2",
      "1",
    ]);
  });

  it("refuses a neighbour that is the task itself or sits in another list", async () => {
    const parent = await make(alice);
    const sub = ok(await createTask({ title: "S", parentTaskId: parent.id }));
    const other = await make(alice);
    expect(errorOf(await reorderTask({ id: parent.id, beforeId: parent.id })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(errorOf(await reorderTask({ id: sub.id, beforeId: other.id })).code).toBe("NOT_FOUND");
  });
});

describe("archive, trash and restore", () => {
  it("archived tasks leave the list and come back when unarchived", async () => {
    const task = await make(alice, { title: "Archive me" });
    ok(await archiveTask({ id: task.id }));
    expect((await listTasks(alice.id)).some((t) => t.id === task.id)).toBe(false);
    expect((await listTasks(alice.id, { archived: true })).some((t) => t.id === task.id)).toBe(
      true,
    );

    ok(await unarchiveTask({ id: task.id }));
    expect((await listTasks(alice.id)).some((t) => t.id === task.id)).toBe(true);
  });

  it("deleting moves a task and its subtasks to Trash, and restoring brings them all back", async () => {
    const parent = await make(alice, { title: "Doomed" });
    const s1 = ok(await createTask({ title: "S1", parentTaskId: parent.id }));
    ok(await createTask({ title: "S2", parentTaskId: parent.id }));
    // One subtask was deleted on its own earlier, so it must not come back with the parent.
    const earlier = ok(await createTask({ title: "Gone earlier", parentTaskId: parent.id }));
    ok(await deleteTask({ id: earlier.id }));
    await new Promise((r) => setTimeout(r, 5));

    ok(await deleteTask({ id: parent.id }));
    expect(await getTaskDetail(alice.id, parent.id)).toBeNull();
    expect(await getTaskDetail(alice.id, s1.id)).toBeNull();
    expect((await listTasks(alice.id)).some((t) => t.id === parent.id)).toBe(false);

    const restored = ok(await restoreTask({ id: parent.id }));
    expect(restored.id).toBe(parent.id);
    const detail = (await getTaskDetail(alice.id, parent.id))!;
    expect(detail.subtasks.map((s) => s.title).sort()).toEqual(["S1", "S2"]);
  });

  it("a deleted task can't be edited, completed or reordered", async () => {
    const task = await make(alice);
    ok(await deleteTask({ id: task.id }));
    expect(errorOf(await updateTask({ id: task.id, title: "x" })).code).toBe("NOT_FOUND");
    expect(errorOf(await completeTask({ id: task.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await setTaskStatus({ id: task.id, status: "WAITING" })).code).toBe("NOT_FOUND");
    expect(errorOf(await archiveTask({ id: task.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await deleteTask({ id: task.id })).code).toBe("NOT_FOUND");
  });

  it("a subtask can't be restored while its parent is still in Trash", async () => {
    const parent = await make(alice);
    const sub = ok(await createTask({ title: "S", parentTaskId: parent.id }));
    ok(await deleteTask({ id: parent.id }));
    expect(errorOf(await restoreTask({ id: sub.id })).code).toBe("CONFLICT");
  });

  it("restoring something that isn't in Trash is 'not found'", async () => {
    const task = await make(alice);
    expect(errorOf(await restoreTask({ id: task.id })).code).toBe("NOT_FOUND");
  });

  it("permanent deletion works only from Trash and removes subtasks too", async () => {
    const task = await make(alice);
    const sub = ok(await createTask({ title: "S", parentTaskId: task.id }));
    expect(errorOf(await permanentlyDeleteTask({ id: task.id })).code).toBe("CONFLICT");

    ok(await deleteTask({ id: task.id }));
    ok(await permanentlyDeleteTask({ id: task.id }));
    expect(await db.select().from(tasks).where(eq(tasks.id, task.id))).toHaveLength(0);
    expect(await db.select().from(tasks).where(eq(tasks.id, sub.id))).toHaveLength(0);
  });
});

describe("description", () => {
  const doc = (...content: unknown[]) => ({ type: "doc", content });
  const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

  it("saves the document and builds the plain-text projection on the server", async () => {
    const task = await make(alice);
    const saved = ok(
      await updateTaskDescription({
        id: task.id,
        descriptionJson: doc(
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Agenda" }] },
          { type: "bulletList", content: [{ type: "listItem", content: [p("brand review")] }] },
        ),
      }),
    );
    expect(saved.updatedAt).toBeTruthy();

    const stored = await row(task.id);
    expect(stored.descriptionText).toBe("Agenda\n- brand review");
    expect((await getTaskDetail(alice.id, task.id))?.descriptionJson).toEqual(
      stored.descriptionJson,
    );
  });

  it("ignores any text the client sends and refuses unknown keys", async () => {
    const task = await make(alice);
    const result = await updateTaskDescription({
      id: task.id,
      descriptionJson: doc(p("real")),
      descriptionText: "fake",
    });
    expect(errorOf(result).code).toBe("VALIDATION_ERROR");
    expect((await row(task.id)).descriptionText).toBeNull();
  });

  it("stores an empty editor as nothing", async () => {
    const task = await make(alice);
    ok(await updateTaskDescription({ id: task.id, descriptionJson: doc(p("something")) }));
    ok(await updateTaskDescription({ id: task.id, descriptionJson: doc({ type: "paragraph" }) }));
    const stored = await row(task.id);
    expect(stored.descriptionJson).toBeNull();
    expect(stored.descriptionText).toBeNull();

    ok(await updateTaskDescription({ id: task.id, descriptionJson: null }));
  });

  it("rejects unsupported content, unsafe links and oversize documents", async () => {
    const task = await make(alice);
    const save = (descriptionJson: unknown) =>
      updateTaskDescription({ id: task.id, descriptionJson });

    expect(errorOf(await save(doc({ type: "script", content: [] }))).message).toMatch(
      /isn't supported/,
    );
    expect(
      errorOf(
        await save(
          doc({
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "x",
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          }),
        ),
      ).message,
    ).toMatch(/Links must start with/);
    expect(errorOf(await save(doc(p("x".repeat(210_000))))).message).toMatch(/too long/);
    expect((await row(task.id)).descriptionJson).toBeNull();
  });

  it("cleans a document rather than storing it as sent", async () => {
    const task = await make(alice);
    ok(
      await updateTaskDescription({
        id: task.id,
        descriptionJson: doc({
          type: "paragraph",
          attrs: { style: "x" },
          content: [
            {
              type: "text",
              text: "a",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.com", class: "bad", target: "_blank" },
                },
              ],
            },
          ],
        }),
      }),
    );
    expect((await row(task.id)).descriptionJson).toEqual(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "a",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      }),
    );
  });
});

describe("one person's tasks are invisible to another", () => {
  const actions = {
    updateTask: (id: string) => updateTask({ id, title: "hacked" }),
    updateTaskDescription: (id: string) =>
      updateTaskDescription({ id, descriptionJson: { type: "doc", content: [] } }),
    completeTask: (id: string) => completeTask({ id }),
    undoCompleteTask: (id: string) => undoCompleteTask({ id, previousStatus: "PLANNED" }),
    setTaskStatus: (id: string) => setTaskStatus({ id, status: "CANCELLED" }),
    reorderTask: (id: string) => reorderTask({ id }),
    archiveTask: (id: string) => archiveTask({ id }),
    unarchiveTask: (id: string) => unarchiveTask({ id }),
    deleteTask: (id: string) => deleteTask({ id }),
    restoreTask: (id: string) => restoreTask({ id }),
    permanentlyDeleteTask: (id: string) => permanentlyDeleteTask({ id }),
  };

  it("answers NOT_FOUND for every action, and leaves the task untouched", async () => {
    const task = await make(alice, { title: "Alice's private task", dueDate: "2026-10-01" });
    const before = await row(task.id);

    actAs(bob);
    for (const [name, call] of Object.entries(actions)) {
      expect(errorOf(await call(task.id)).code, name).toBe("NOT_FOUND");
    }
    // Same answer as for an id that never existed, so nothing reveals it is real.
    for (const [name, call] of Object.entries(actions)) {
      expect(errorOf(await call(crypto.randomUUID())).code, `${name} (unknown id)`).toBe(
        "NOT_FOUND",
      );
    }

    expect(await row(task.id)).toEqual(before);
  });

  it("can't reach a deleted task of another person either", async () => {
    const task = await make(alice);
    ok(await deleteTask({ id: task.id }));
    actAs(bob);
    expect(errorOf(await restoreTask({ id: task.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await permanentlyDeleteTask({ id: task.id })).code).toBe("NOT_FOUND");
    expect(await row(task.id)).toMatchObject({ userId: alice.id });
  });

  it("can't attach a subtask to someone else's task, or order against it", async () => {
    const theirs = await make(alice);
    const mine = await make(bob);
    actAs(bob);
    expect(errorOf(await createTask({ title: "Sneaky", parentTaskId: theirs.id })).code).toBe(
      "NOT_FOUND",
    );
    expect(errorOf(await reorderTask({ id: mine.id, beforeId: theirs.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await reorderTask({ id: mine.id, afterId: theirs.id })).code).toBe("NOT_FOUND");
    const subtasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, theirs.id)));
    expect(subtasks).toHaveLength(0);
  });

  it("never lists or opens another person's tasks", async () => {
    const task = await make(alice, { title: "Alice only" });
    expect((await listTasks(bob.id)).some((t) => t.id === task.id)).toBe(false);
    expect(await getTaskDetail(bob.id, task.id)).toBeNull();
    expect((await countTasksByGroup(bob.id)).open).toBeGreaterThanOrEqual(0);
    expect((await listClosedTasks(bob.id)).some((t) => t.id === task.id)).toBe(false);
  });

  it("every action needs a signed-in person", async () => {
    const task = await make(alice);
    actAs(null);
    for (const [name, call] of Object.entries(actions)) {
      expect(errorOf(await call(task.id)).code, name).toBe("UNAUTHENTICATED");
    }
  });

  it("deleting an account removes its tasks", async () => {
    const person = await createTestUser("leaving");
    const task = await make(person);
    const sub = ok(await createTask({ title: "S", parentTaskId: task.id }));
    const { user } = await import("@/db/schema");
    await db.delete(user).where(eq(user.id, person.id));
    expect(await db.select().from(tasks).where(eq(tasks.id, task.id))).toHaveLength(0);
    expect(await db.select().from(tasks).where(eq(tasks.id, sub.id))).toHaveLength(0);
  });
});
