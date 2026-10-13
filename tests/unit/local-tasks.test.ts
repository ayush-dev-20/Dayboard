import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextOccurrence } from "@/lib/tasks/recurrence";
import { LocalDatabase } from "@/lib/local/db";
import {
  completeTask,
  createTask,
  reopenTask,
  rescheduleTask,
  renameTask,
  LocalCommandError,
} from "@/lib/local/commands/tasks";
import { seedTasks, bootstrapTasks } from "@/lib/local/bootstrap";
import { localDbName } from "@/lib/local/user-key";
import { sessionState } from "@/lib/local/session-hint";
import type { SnapshotTask } from "@/lib/sync/snapshot";
import { uuidv7 } from "@/lib/ids";

// V2 feature 04 §10, unit level: the offline commands, the queue, seeding, replay and per-user
// databases. Real Dexie on fake IndexedDB, so indexes and transactions behave as in a browser.

let counter = 0;
let db: LocalDatabase;
const DEVICE = "device-test";

function ctx(at: string = "2026-10-13T09:00:00.000Z") {
  return { db, deviceId: DEVICE, defaultPriority: "NONE" as const, now: () => new Date(at) };
}

function serverRow(overrides: Partial<SnapshotTask> = {}): SnapshotTask {
  const stamp = "2026-10-01T08:00:00.000Z";
  return {
    id: uuidv7(Date.parse(stamp) + counter++),
    projectId: null,
    parentTaskId: null,
    title: "Server task",
    emoji: null,
    status: "PLANNED",
    priority: "NONE",
    dueDate: null,
    dueTime: null,
    startDate: null,
    startTime: null,
    recurrenceRule: null,
    recurrenceParentId: null,
    sortOrder: 1000,
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  db = new LocalDatabase(`test-${counter++}-${Math.random().toString(36).slice(2)}`);
  await db.open();
});

afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

describe("offline task commands", () => {
  it("creates a task on the device and queues one create with the same id", async () => {
    const id = await createTask(ctx(), { title: "Buy milk", dueDate: "2026-10-14" });

    const row = await db.tasks.get(id);
    expect(row).toMatchObject({
      title: "Buy milk",
      status: "PLANNED",
      dueDate: "2026-10-14",
      priority: "NONE",
    });

    const ops = await db.operations.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: "task.create",
      entityId: id,
      status: "PENDING",
      deviceId: DEVICE,
    });
    expect(ops[0]?.payload).toMatchObject({ id, title: "Buy milk", dueDate: "2026-10-14" });
  });

  it("refuses a title the server would refuse, before anything is written", async () => {
    await expect(createTask(ctx(), { title: "" })).rejects.toThrow();
    expect(await db.tasks.count()).toBe(0);
    expect(await db.operations.count()).toBe(0);
  });

  it("puts a new task at the top of the list", async () => {
    await seedTasks(db, [serverRow({ sortOrder: 500 })]);
    const id = await createTask(ctx(), { title: "On top" });
    expect((await db.tasks.get(id))!.sortOrder).toBeLessThan(500);
  });

  it("completes a plain task, with the same status and completion time as the server rule", async () => {
    const id = await createTask(ctx(), { title: "Plain" });
    await completeTask(ctx("2026-10-13T10:30:00.000Z"), id);

    const row = await db.tasks.get(id);
    expect(row).toMatchObject({ status: "DONE", completedAt: "2026-10-13T10:30:00.000Z" });
    const types = (await db.operations.orderBy("seq").toArray()).map((o) => o.type);
    expect(types).toEqual(["task.create", "task.complete"]);
  });

  it("completing a repeating task makes the next occurrence, dated as the server dates it", async () => {
    const seeded = serverRow({
      title: "Standup",
      dueDate: "2026-10-13",
      recurrenceRule: "FREQ=DAILY",
      startDate: "2026-10-12",
    });
    await seedTasks(db, [seeded]);

    await completeTask(ctx(), seeded.id);

    const done = await db.tasks.get(seeded.id);
    expect(done).toMatchObject({ status: "DONE", recurrenceRule: null });

    const next = await db.tasks.filter((t) => t.recurrenceParentId === seeded.id).first();
    expect(next).toBeDefined();
    expect(next!.dueDate).toBe(nextOccurrence("FREQ=DAILY", "2026-10-13"));
    expect(next!.status).toBe("PLANNED");
    expect(next!.recurrenceRule).toBe("FREQ=DAILY");
    expect(next!.startDate).toBe("2026-10-13");

    const complete = (await db.operations.filter((o) => o.type === "task.complete").first())!;
    expect(complete.payload).toEqual({ nextOccurrenceId: next!.id });
  });

  it("refuses to complete a repeating task that has subtasks, and changes nothing", async () => {
    const parent = serverRow({ dueDate: "2026-10-13", recurrenceRule: "FREQ=DAILY" });
    const child = serverRow({ parentTaskId: parent.id, dueDate: null });
    await seedTasks(db, [parent, child]);

    await expect(completeTask(ctx(), parent.id)).rejects.toBeInstanceOf(LocalCommandError);
    expect((await db.tasks.get(parent.id))!.status).toBe("PLANNED");
    expect(await db.operations.count()).toBe(0);
  });

  it("completing a done task does nothing", async () => {
    const seeded = serverRow({ status: "DONE", completedAt: "2026-10-02T00:00:00.000Z" });
    await seedTasks(db, [seeded]);
    await completeTask(ctx(), seeded.id);
    expect(await db.operations.count()).toBe(0);
  });

  it("reopens a completed task", async () => {
    const id = await createTask(ctx(), { title: "Again" });
    await completeTask(ctx(), id);
    await reopenTask(ctx(), id);
    expect(await db.tasks.get(id)).toMatchObject({ status: "PLANNED", completedAt: null });
  });

  it("reschedules, and clearing the date clears the time as well", async () => {
    const seeded = serverRow({ dueDate: "2026-10-13", dueTime: "09:30" });
    await seedTasks(db, [seeded]);

    await rescheduleTask(ctx(), seeded.id, "2026-10-20");
    expect(await db.tasks.get(seeded.id)).toMatchObject({
      dueDate: "2026-10-20",
      dueTime: "09:30",
    });

    await rescheduleTask(ctx(), seeded.id, null);
    expect(await db.tasks.get(seeded.id)).toMatchObject({ dueDate: null, dueTime: null });
  });

  it("merges repeated edits to one task into a single pending update", async () => {
    const seeded = serverRow();
    await seedTasks(db, [seeded]);
    await renameTask(ctx(), seeded.id, "First");
    await rescheduleTask(ctx(), seeded.id, "2026-10-20");
    await renameTask(ctx(), seeded.id, "Second");

    const updates = await db.operations.filter((o) => o.type === "task.update").toArray();
    expect(updates).toHaveLength(1);
    expect(updates[0]?.payload).toEqual({ title: "Second", dueDate: "2026-10-20" });
  });

  it("does not change a task the person deleted (or one that is missing)", async () => {
    const seeded = serverRow({ deletedAt: "2026-10-02T00:00:00.000Z" });
    await seedTasks(db, [seeded]);
    await expect(completeTask(ctx(), seeded.id)).rejects.toBeInstanceOf(LocalCommandError);
    await expect(completeTask(ctx(), uuidv7())).rejects.toBeInstanceOf(LocalCommandError);
  });
});

describe("seeding from the server", () => {
  it("never overwrites a row that has a change waiting to be sent", async () => {
    const id = await createTask(ctx(), { title: "Mine" });
    await seedTasks(db, [
      {
        ...(await db.tasks.get(id))!,
        title: "Server says otherwise",
        updatedAt: "2099-01-01T00:00:00.000Z",
      },
    ]);
    expect((await db.tasks.get(id))!.title).toBe("Mine");
  });

  it("replaces a row with a newer server copy, and keeps one that is newer locally", async () => {
    const seeded = serverRow({ title: "Old" });
    await seedTasks(db, [seeded]);

    await seedTasks(db, [{ ...seeded, title: "Newer", version: 2 }]);
    expect((await db.tasks.get(seeded.id))!.title).toBe("Newer");

    await seedTasks(db, [{ ...seeded, title: "Older", version: 1 }]);
    expect((await db.tasks.get(seeded.id))!.title).toBe("Newer");
  });

  it("bootstrap reads every page, and drops local tasks the server no longer lists", async () => {
    const stale = serverRow({ title: "Gone on the server" });
    await seedTasks(db, [stale]);
    const pages = [
      { rows: [serverRow({ title: "A" })], nextCursor: "page-2" },
      { rows: [serverRow({ title: "B" })], nextCursor: null },
    ];
    const cursors: (string | null)[] = [];
    const count = await bootstrapTasks(db, async (cursor) => {
      cursors.push(cursor);
      return pages[cursors.length - 1]!;
    });

    expect(cursors).toEqual([null, "page-2"]);
    expect(count).toBe(2);
    expect(await db.tasks.get(stale.id)).toBeUndefined();
    expect(await db.tasks.count()).toBe(2);
  });

  it("bootstrap keeps a local task that still has a change waiting", async () => {
    const id = await createTask(ctx(), { title: "Only on this device" });
    await bootstrapTasks(db, async () => ({ rows: [], nextCursor: null }));
    expect(await db.tasks.get(id)).toBeDefined();
  });
});

describe("per-user databases and the session hint", () => {
  it("gives each person their own database name, with no raw id in it", async () => {
    const a = await localDbName("user-a-0001");
    const b = await localDbName("user-b-0002");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^dayboard-local-[0-9a-f]{16}$/);
    expect(a).not.toContain("user-a");
    expect(await localDbName("user-a-0001")).toBe(a);
  });

  it("locks offline data once the session has expired", () => {
    const hint = { userId: "u", expiresAt: "2026-10-13T12:00:00.000Z" };
    expect(sessionState(null)).toBe("none");
    expect(sessionState(hint, Date.parse("2026-10-13T11:00:00.000Z"))).toBe("active");
    expect(sessionState(hint, Date.parse("2026-10-13T12:00:00.000Z"))).toBe("expired");
    expect(sessionState({ ...hint, expiresAt: "not a date" })).toBe("expired");
  });
});
