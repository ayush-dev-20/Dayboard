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
import { replayPending, type TaskActions } from "@/lib/local/replay";
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

    await seedTasks(db, [{ ...seeded, title: "Newer", updatedAt: "2026-10-05T00:00:00.000Z" }]);
    expect((await db.tasks.get(seeded.id))!.title).toBe("Newer");

    await seedTasks(db, [{ ...seeded, title: "Older", updatedAt: "2026-10-02T00:00:00.000Z" }]);
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

describe("replay", () => {
  function fakeActions(
    script: Partial<Record<keyof TaskActions, (input: unknown) => Promise<unknown>>> = {},
  ) {
    const calls: { name: string; input: unknown }[] = [];
    const ok = async () => ({ ok: true as const });
    const make = (name: keyof TaskActions) => async (input: unknown) => {
      calls.push({ name, input });
      const custom = script[name];
      return (custom ? custom(input) : ok()) as Promise<
        { ok: true } | { ok: false; error: { code: string; message: string } }
      >;
    };
    return {
      calls,
      actions: {
        createTask: make("createTask"),
        completeTask: make("completeTask"),
        setTaskStatus: make("setTaskStatus"),
        updateTask: make("updateTask"),
      } satisfies TaskActions,
    };
  }

  it("sends the queue in the order the changes were made, then removes what was acknowledged", async () => {
    const id = await createTask(ctx(), { title: "First" });
    await completeTask(ctx(), id);
    const { actions, calls } = fakeActions();

    const result = await replayPending(db, actions);

    expect(result).toEqual({ sent: 2, failed: 0, stoppedOffline: false });
    expect(calls.map((c) => c.name)).toEqual(["createTask", "completeTask"]);
    expect(calls[0]!.input).toMatchObject({ id, title: "First" });
    expect(await db.operations.count()).toBe(0);
  });

  it("stops at a dropped connection and keeps the rest waiting", async () => {
    const id = await createTask(ctx(), { title: "Offline" });
    await completeTask(ctx(), id);
    const { actions } = fakeActions({
      createTask: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    const result = await replayPending(db, actions);

    expect(result.stoppedOffline).toBe(true);
    const statuses = (await db.operations.orderBy("seq").toArray()).map((o) => o.status);
    expect(statuses).toEqual(["PENDING", "PENDING"]);
  });

  it("marks a refused change FAILED and holds back later changes to the same task", async () => {
    const id = await createTask(ctx(), { title: "Refused" });
    await completeTask(ctx(), id);
    const other = await createTask(ctx(), { title: "Unrelated" });
    let refusals = 0;
    const { actions, calls } = fakeActions({
      // Only the first create is refused; the other task's create goes through.
      createTask: async () => {
        refusals += 1;
        return refusals === 1
          ? { ok: false, error: { code: "VALIDATION_ERROR", message: "Nope." } }
          : { ok: true };
      },
    });

    const result = await replayPending(db, actions);

    // The refused create and the completion after it: 2 failed. The other task still sends.
    expect(result).toMatchObject({ sent: 1, failed: 2 });
    expect(calls.map((c) => c.name)).toEqual(["createTask", "createTask"]);
    expect(calls[1]!.input).toMatchObject({ id: other });
    const complete = await db.operations.filter((o) => o.type === "task.complete").first();
    expect(complete).toMatchObject({
      status: "FAILED",
      lastError: "An earlier change to this item couldn't be saved.",
    });
  });

  it("treats a create the server already has as sent", async () => {
    await createTask(ctx(), { title: "Retried" });
    const { actions } = fakeActions({
      createTask: async () => ({ ok: false, error: { code: "CONFLICT", message: "Taken." } }),
    });
    const result = await replayPending(db, actions);
    expect(result).toEqual({ sent: 1, failed: 0, stoppedOffline: false });
    expect(await db.operations.count()).toBe(0);
  });

  it("sends a change once when two replays start together", async () => {
    await createTask(ctx(), { title: "Once" });
    const { actions, calls } = fakeActions();
    await Promise.all([replayPending(db, actions), replayPending(db, actions)]);
    expect(calls.filter((c) => c.name === "createTask")).toHaveLength(1);
  });

  it("puts back a change that was being sent when the page closed", async () => {
    const id = await createTask(ctx(), { title: "Interrupted" });
    const op = (await db.operations.toArray())[0]!;
    await db.operations.update(op.opId, { status: "SENDING" });
    const { actions, calls } = fakeActions();
    await replayPending(db, actions);
    expect(calls.map((c) => c.input)).toEqual([expect.objectContaining({ id })]);
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
