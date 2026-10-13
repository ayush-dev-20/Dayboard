import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, completeTask } from "@/lib/local/commands/tasks";
import { LocalDatabase, type Operation } from "@/lib/local/db";
import {
  MAX_ATTEMPTS,
  MAX_OPS_PER_BATCH,
  PULL_OVERLAP,
  backoffDelayMs,
  pullChanges,
  pushQueue,
  runSync,
  type EngineDeps,
  type PullChange,
  type PushOutcome,
  type Transport,
  type WireOperation,
} from "@/lib/local/engine";
import { createScheduler } from "@/lib/local/scheduler";
import { seedTasks } from "@/lib/local/bootstrap";
import type { SnapshotTask } from "@/lib/sync/snapshot";
import { uuidv7 } from "@/lib/ids";

// V2 feature 05 §8, unit level: the engine against a scripted server (answers are chosen per test), so each
// rule of the protocol is checked on its own. The integration test runs the same engine against the real routes.

let db: LocalDatabase;
let n = 0;
const DEVICE = "00000000-0000-7000-8000-000000000001";

beforeEach(async () => {
  db = new LocalDatabase(`engine-${n++}-${Math.random().toString(36).slice(2)}`);
  await db.open();
});

afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

/** Operations for one task, in queue order. (The operations table is indexed by entity type and id.) */
const opsFor = async (entityId: string) =>
  (await db.operations.orderBy("seq").toArray()).filter((o) => o.entityId === entityId);
const modifyOpsFor = async (entityId: string, changes: Partial<Operation>) => {
  for (const op of await opsFor(entityId)) await db.operations.update(op.opId, changes);
};

const ctx = () => ({
  db,
  deviceId: DEVICE,
  defaultPriority: "NONE" as const,
  now: () => new Date("2026-10-13T09:00:00.000Z"),
});

function serverRow(overrides: Partial<SnapshotTask> = {}): SnapshotTask {
  const stamp = "2026-10-01T08:00:00.000Z";
  return {
    id: uuidv7(Date.parse(stamp) + n++),
    projectId: null,
    parentTaskId: null,
    title: "Server",
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

function deps(transport: Partial<Transport>): EngineDeps {
  return {
    db,
    deviceId: DEVICE,
    appVersion: "test",
    transport: {
      push: vi.fn(async () => ({ results: [] })),
      pull: vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false })),
      ...transport,
    } as Transport,
  };
}

/** A server that accepts every operation and echoes the task as stored. */
function accepting(): Pick<Transport, "push"> {
  return {
    push: async ({ ops }) => ({
      results: ops.map((op) => ({
        opId: op.opId,
        status: "APPLIED" as const,
        version: 2,
        entity: serverRow({
          id: op.entityId,
          title: String(op.payload.title ?? "Stored"),
          version: 2,
        }),
        errorCode: null,
        message: null,
      })),
    }),
  };
}

function answer(status: PushOutcome["status"], extra: Partial<PushOutcome> = {}): PushOutcome {
  return {
    opId: "",
    status,
    version: null,
    entity: null,
    errorCode: null,
    message: null,
    ...extra,
  };
}

describe("backoff", () => {
  it("doubles from 2 seconds to a 30 second ceiling, with at most 20% jitter", () => {
    const middle = () => 0.5; // no jitter
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelayMs(n, middle))).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(backoffDelayMs(3, () => 0)).toBe(Math.round(8000 * 0.8));
    expect(backoffDelayMs(3, () => 0.999)).toBeLessThanOrEqual(Math.round(8000 * 1.2));
  });
});

describe("pushing the queue", () => {
  it("sends the queue in order and removes what the server applied, keeping its copy", async () => {
    const id = await createTask(ctx(), { title: "Sent" });
    const sent: WireOperation[][] = [];
    const result = await pushQueue(
      deps({
        push: async (body) => {
          sent.push(body.ops);
          return accepting().push(body);
        },
      }),
    );

    expect(result).toEqual({ sent: 1, failed: 0, stoppedOffline: false });
    expect(sent[0]![0]).toMatchObject({
      entityId: id,
      type: "task.create",
      payload: expect.objectContaining({ title: "Sent" }),
    });
    expect(await db.operations.count()).toBe(0);
    expect((await db.tasks.get(id))!.version).toBe(2);
  });

  it("never sends two changes to one task in the same batch", async () => {
    const id = await createTask(ctx(), { title: "Edited twice" });
    await completeTask(ctx(), id);
    const batches: number[] = [];
    await pushQueue(
      deps({
        push: async (body) => {
          batches.push(body.ops.length);
          return accepting().push(body);
        },
      }),
    );
    expect(batches).toEqual([1, 1]);
  });

  it("splits a long queue into batches of at most 50", async () => {
    for (let i = 0; i < MAX_OPS_PER_BATCH + 5; i++) await createTask(ctx(), { title: `Many ${i}` });
    const batches: number[] = [];
    await pushQueue(
      deps({
        push: async (body) => {
          batches.push(body.ops.length);
          return accepting().push(body);
        },
      }),
    );
    expect(batches).toEqual([MAX_OPS_PER_BATCH, 5]);
  });

  it("refuses a change for good: it is FAILED, and later changes to that task are held back too", async () => {
    const refused = await createTask(ctx(), { title: "Refused" });
    await completeTask(ctx(), refused);
    const other = await createTask(ctx(), { title: "Other" });
    const sent: string[] = [];
    const result = await pushQueue(
      deps({
        push: async (body) => {
          sent.push(...body.ops.map((o) => o.entityId));
          return {
            results: body.ops.map((op) =>
              op.entityId === refused
                ? answer("REJECTED", {
                    opId: op.opId,
                    errorCode: "VALIDATION_ERROR",
                    message: "Not allowed.",
                  })
                : answer("APPLIED", {
                    opId: op.opId,
                    entity: serverRow({ id: op.entityId, version: 2 }),
                  }),
            ),
          };
        },
      }),
    );

    expect(sent.filter((id) => id === refused)).toHaveLength(1);
    expect(sent).toContain(other);
    expect(result.failed).toBe(2);
    const statuses = (await db.operations.orderBy("seq").toArray())
      .filter((o) => o.entityId === refused)
      .map((o) => [o.status, o.lastError]);
    expect(statuses).toEqual([
      ["FAILED", "Not allowed."],
      ["FAILED", "An earlier change to this item couldn't be saved."],
    ]);
  });

  it("holds a change whose parent has not arrived, and tries it again later", async () => {
    const parent = uuidv7();
    const child = uuidv7();
    await db.operations.add({
      opId: uuidv7(),
      seq: 1,
      entityType: "task",
      entityId: child,
      type: "task.create",
      payload: { id: child, title: "Child", parentTaskId: parent },
      clientTimestamp: "2026-10-13T09:00:00.000Z",
      deviceId: DEVICE,
      status: "PENDING",
      attempts: 0,
      lastError: null,
    });
    let calls = 0;
    const result = await pushQueue(
      deps({
        push: async (body) => {
          calls += 1;
          return { results: body.ops.map((op) => answer("DEPENDENCY_MISSING", { opId: op.opId })) };
        },
      }),
    );

    expect(calls).toBe(1); // not sent again in the same run
    expect(result.failed).toBe(1);
    const op = (await opsFor(child))[0];
    expect(op).toMatchObject({ status: "PENDING", attempts: 1 });
  });

  it("gives up on an operation after the tenth try, and says so", async () => {
    const id = await createTask(ctx(), { title: "Stuck" });
    await modifyOpsFor(id, { attempts: MAX_ATTEMPTS - 1 });
    await pushQueue(
      deps({
        push: async (body) => ({
          results: body.ops.map((op) => answer("RETRY", { opId: op.opId })),
        }),
      }),
    );
    const op = (await opsFor(id))[0];
    expect(op).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });
    expect(op?.lastError).toMatch(/several tries/);
  });

  it("with no connection, keeps everything waiting and does not count it as a try", async () => {
    const id = await createTask(ctx(), { title: "Offline" });
    const result = await pushQueue(
      deps({
        push: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    );
    expect(result).toEqual({ sent: 0, failed: 0, stoppedOffline: true });
    expect((await opsFor(id))[0]).toMatchObject({
      status: "PENDING",
      attempts: 0,
    });
  });

  it("an operation the server did not answer for is tried again later", async () => {
    const id = await createTask(ctx(), { title: "Unanswered" });
    const result = await pushQueue(deps({ push: async () => ({ results: [] }) }));
    expect(result.failed).toBe(1);
    expect((await opsFor(id))[0]).toMatchObject({
      status: "PENDING",
      attempts: 1,
    });
  });

  it("an operation that was being sent when the page closed goes back in the queue", async () => {
    const id = await createTask(ctx(), { title: "Interrupted" });
    await modifyOpsFor(id, { status: "SENDING" });
    await pushQueue(deps(accepting()));
    expect(await db.operations.count()).toBe(0);
  });

  it("acknowledges a duplicate as done", async () => {
    const id = await createTask(ctx(), { title: "Again" });
    await pushQueue(
      deps({
        push: async (body) => ({
          results: body.ops.map((op) =>
            answer("DUPLICATE_IGNORED", { opId: op.opId, entity: serverRow({ id, version: 3 }) }),
          ),
        }),
      }),
    );
    expect(await db.operations.count()).toBe(0);
    expect((await db.tasks.get(id))!.version).toBe(3);
  });
});

describe("pulling changes", () => {
  it("applies a newer version, ignores an older or equal one, and removes a deleted task", async () => {
    const kept = serverRow({ version: 2, title: "Local v2" });
    await seedTasks(db, [kept]);
    const gone = serverRow({ version: 1 });
    await seedTasks(db, [gone]);

    const changes: PullChange[] = [
      {
        entityType: "task",
        entityId: kept.id,
        op: "UPSERT",
        version: 1,
        entity: { ...kept, version: 1, title: "Old" },
      },
      { entityType: "task", entityId: gone.id, op: "DELETE", version: 2 },
      {
        entityType: "task",
        entityId: uuidv7(),
        op: "UPSERT",
        version: 4,
        entity: serverRow({ version: 4, title: "New from elsewhere" }),
      },
    ];
    await pullChanges(deps({ pull: async () => ({ changes, nextCursor: 10, hasMore: false }) }));

    expect((await db.tasks.get(kept.id))!.title).toBe("Local v2");
    expect(await db.tasks.get(gone.id)).toBeUndefined();
    expect(await db.tasks.filter((t) => t.title === "New from elsewhere").count()).toBe(1);
  });

  it("leaves alone a task with a change of ours still waiting", async () => {
    const id = await createTask(ctx(), { title: "Mine" });
    await pullChanges(
      deps({
        pull: async () => ({
          changes: [
            {
              entityType: "task",
              entityId: id,
              op: "UPSERT",
              version: 9,
              entity: serverRow({ id, version: 9, title: "Theirs" }),
            },
          ],
          nextCursor: 5,
          hasMore: false,
        }),
      }),
    );
    expect((await db.tasks.get(id))!.title).toBe("Mine");
  });

  it("reads again from just behind the stored cursor, and never moves the cursor backwards", async () => {
    await db.meta.put({ key: "lastPullCursor", value: 1000 });
    const asked: number[] = [];
    await pullChanges(
      deps({
        pull: async (cursor) => {
          asked.push(cursor);
          return { changes: [], nextCursor: cursor, hasMore: false };
        },
      }),
    );
    expect(asked).toEqual([1000 - PULL_OVERLAP]);
    expect((await db.meta.get("lastPullCursor"))!.value).toBe(1000);
  });

  it("pages until nothing is left, and stores where it got to", async () => {
    const pages = [
      { changes: [], nextCursor: 300, hasMore: true },
      { changes: [], nextCursor: 450, hasMore: false },
    ];
    const asked: number[] = [];
    await pullChanges(
      deps({
        pull: async (cursor) => {
          asked.push(cursor);
          return pages[asked.length - 1]!;
        },
      }),
    );
    expect(asked).toEqual([0, 300]);
    expect((await db.meta.get("lastPullCursor"))!.value).toBe(450);
  });
});

describe("one run: push, then pull, one at a time", () => {
  it("skips the pull when the push got no answer, and keeps the pulled cursor where it was", async () => {
    await createTask(ctx(), { title: "Offline" });
    const pull = vi.fn(async () => ({ changes: [], nextCursor: 0, hasMore: false }));
    const report = await runSync(
      deps({
        push: async () => {
          throw new TypeError("offline");
        },
        pull,
      }),
    );
    expect(report.stoppedOffline).toBe(true);
    expect(pull).not.toHaveBeenCalled();
  });

  it("two runs at once take turns: never two pushes in flight", async () => {
    await createTask(ctx(), { title: "Turn" });
    let inFlight = 0;
    let most = 0;
    const transport = {
      push: async (body: { ops: WireOperation[] }) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return accepting().push(body as never);
      },
    };
    await Promise.all([runSync(deps(transport)), runSync(deps(transport))]);
    expect(most).toBe(1);
  });
});

describe("the scheduler's triggers and backoff", () => {
  function clock() {
    let next = 1;
    const timers = new Map<number, { fn: () => void; at: number }>();
    let now = 0;
    return {
      setTimer: (fn: () => void, ms: number) => {
        const id = next++;
        timers.set(id, { fn, at: now + ms });
        return id;
      },
      clearTimer: (id: unknown) => timers.delete(id as number),
      advance: async (ms: number) => {
        now += ms;
        for (const [id, t] of [...timers]) {
          if (t.at <= now && timers.has(id)) {
            timers.delete(id);
            t.fn();
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      },
      pending: () => timers.size,
    };
  }

  it("runs at start, after a local change once things settle, and on retry", async () => {
    const c = clock();
    const run = vi.fn(async () => ({ sent: 0, failed: 0, pulled: 0, stoppedOffline: false }));
    const scheduler = createScheduler({
      run,
      isVisible: () => true,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      random: () => 0.5,
    });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.localChange();
    scheduler.localChange();
    await c.advance(999);
    expect(run).toHaveBeenCalledTimes(1);
    await c.advance(1);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.retryNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("a failed run waits 2 seconds, then 4, and a successful one goes back to the minute interval", async () => {
    const c = clock();
    let failing = true;
    const run = vi.fn(async () => ({
      sent: 0,
      failed: failing ? 1 : 0,
      pulled: 0,
      stoppedOffline: false,
    }));
    const scheduler = createScheduler({
      run,
      isVisible: () => true,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      random: () => 0.5,
    });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await c.advance(2000);
    expect(run).toHaveBeenCalledTimes(2);
    await c.advance(4000);
    expect(run).toHaveBeenCalledTimes(3);

    failing = false;
    await c.advance(8000);
    expect(run).toHaveBeenCalledTimes(4);
    await c.advance(60_000);
    expect(run).toHaveBeenCalledTimes(5);
  });

  it("a change that arrives while a run is going runs again afterwards", async () => {
    const c = clock();
    let release!: () => void;
    const run = vi.fn(
      () =>
        new Promise<{ sent: number; failed: number; pulled: number; stoppedOffline: boolean }>(
          (resolve) => {
            release = () => resolve({ sent: 0, failed: 0, pulled: 0, stoppedOffline: false });
          },
        ),
    );
    const scheduler = createScheduler({
      run,
      isVisible: () => true,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
    });
    scheduler.start();
    scheduler.retryNow();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
