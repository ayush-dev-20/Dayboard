import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTask } from "@/actions/tasks";
import { GET as healthRoute } from "@/app/api/health/route";
import { POST as tickRoute } from "@/app/api/jobs/tick/route";
import { GET as pullRoute } from "@/app/api/sync/pull/route";
import { db } from "@/db/client";
import {
  changeLog,
  jobSchedules,
  jobs,
  syncOperations,
  syncRetention,
  tasks,
  workerHeartbeats,
} from "@/db/schema";
import { ensureBuiltinHandlers } from "@/lib/jobs/builtin";
import { claimJobs, reapStaleLocks } from "@/lib/jobs/claim";
import { enqueue } from "@/lib/jobs/enqueue";
import {
  beat,
  fireDueSchedules,
  getQueueStats,
  pruneJobs,
  pruneSync,
  runTick,
} from "@/lib/jobs/maintenance";
import { registerHandler } from "@/lib/jobs/registry";
import { runClaimed } from "@/lib/jobs/runner";
import { PermanentError, RetryAfter } from "@/lib/jobs/types";
import { createWorker } from "@/lib/jobs/worker-loop";
import { uuidv7 } from "@/lib/ids";
import { actAs, createTestUser, ok, type TestUser } from "./harness";

// V2 feature 08 against the real database: claiming, retries, crash recovery, dedupe, the scheduler, the
// worker loop, tick mode, health and the maintenance jobs. Job types here are all `test.*` so the tests only
// ever touch their own jobs, and the seeded schedules are switched off for the duration.

const ran = new Map<string, number>();
const seen = (key: string) => ran.get(key) ?? 0;
let sleepMs = 0;
let alice: TestUser;

registerHandler({
  type: "test.count",
  queue: "default",
  schema: z.object({ key: z.string() }),
  run: async (_ctx, payload) => {
    ran.set(payload.key, seen(payload.key) + 1);
  },
});
registerHandler({
  type: "test.fail",
  queue: "default",
  schema: z.object({}),
  run: async () => {
    throw new Error("Could not reach someone@example.com at https://example.com/x?token=abc");
  },
});
registerHandler({
  type: "test.permanent",
  queue: "default",
  schema: z.object({}),
  run: async () => {
    throw new PermanentError("This will never work.");
  },
});
registerHandler({
  type: "test.retry_after",
  queue: "default",
  schema: z.object({ ms: z.number() }),
  run: async (_ctx, payload) => {
    throw new RetryAfter(payload.ms);
  },
});
registerHandler({
  type: "test.sleepy",
  queue: "default",
  schema: z.object({ untilAbort: z.boolean().optional() }),
  run: async (ctx, payload) => {
    const end = Date.now() + sleepMs;
    while (Date.now() < end || payload.untilAbort) {
      if (ctx.signal.aborted) throw new Error("aborted");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  },
});
registerHandler({
  type: "test.owner",
  queue: "default",
  schema: z.object({ otherUserId: z.string().optional() }),
  run: async (ctx, payload) => {
    // The person comes from the job row, never from the payload, even when the payload names someone else.
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.userId, ctx.userId as string));
    ran.set(`owner:${payload.otherUserId ?? "none"}`, rows.length);
  },
});

async function clean() {
  await db.delete(jobs).where(like(jobs.type, "test.%"));
  await db.delete(jobs).where(like(jobs.type, "no.such.%"));
  await db.delete(jobs).where(like(jobs.type, "system.%"));
  await db.delete(jobs).where(like(jobs.type, "maintenance.%"));
  await db.delete(jobSchedules).where(like(jobSchedules.name, "test.%"));
  await db.delete(workerHeartbeats);
  ran.clear();
}

async function waitFor(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting.");
}

const statusOf = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;

beforeAll(async () => {
  ensureBuiltinHandlers();
  alice = await createTestUser("alice-jobs");
  await db.update(jobSchedules).set({ enabled: false });
  const [floor] = await db.select().from(syncRetention).where(eq(syncRetention.key, "change_log"));
  originalFloor = floor?.value ?? 0;
});
let originalFloor = 0;
afterAll(async () => {
  await clean();
  await db.update(jobSchedules).set({ enabled: true });
  // The prune test moves the sync log's floor. Put it back so later test files start from the same state.
  await db
    .update(syncRetention)
    .set({ value: originalFloor })
    .where(eq(syncRetention.key, "change_log"));
});
beforeEach(clean);

describe("claiming and running", () => {
  it("two workers racing on 50 jobs run each job exactly once", async () => {
    for (let i = 0; i < 50; i++)
      await enqueue(db, { type: "test.count", payload: { key: `job-${i}` } });
    const config = {
      concurrency: 4,
      queues: ["default" as const],
      pollMs: 20,
      version: "t",
      hostname: "h",
      heartbeatMs: 200,
    };
    const a = createWorker({ ...config, workerId: "race-a" });
    const b = createWorker({ ...config, workerId: "race-b" });
    await Promise.all([a.start(), b.start()]);
    await waitFor(
      async () => (await db.select().from(jobs).where(eq(jobs.status, "SUCCEEDED"))).length === 50,
    );
    await Promise.all([a.stop(), b.stop()]);

    expect(ran.size).toBe(50);
    expect([...ran.values()].every((n) => n === 1)).toBe(true);
  });

  it("claims only the queues it serves, in run-at order, and counts the attempt", async () => {
    const early = await enqueue(db, {
      type: "test.count",
      payload: { key: "early" },
      runAt: new Date(Date.now() - 2000),
    });
    await enqueue(db, {
      type: "test.count",
      payload: { key: "late" },
      runAt: new Date(Date.now() - 1000),
    });
    await enqueue(db, { type: "test.count", payload: { key: "other-queue" }, queue: "ai" });
    await enqueue(db, {
      type: "test.count",
      payload: { key: "future" },
      runAt: new Date(Date.now() + 60_000),
    });

    const [first] = await claimJobs("w1", ["default"], 1);
    expect(first).toMatchObject({ id: early, status: "RUNNING", attempts: 1, lockedBy: "w1" });
    expect(first?.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(
      (await claimJobs("w1", ["default"], 10)).map((j) => (j.payload as { key: string }).key),
    ).toEqual(["late"]);
    expect(await claimJobs("w1", ["default"], 10)).toEqual([]);
  });

  it("a job runs only for its own person: ownership comes from the job, not the payload", async () => {
    actAs(alice);
    ok(await createTask({ title: "Alice's task" }));
    const bob = await createTestUser("bob-jobs");
    actAs(bob);
    ok(await createTask({ title: "Bob's task" }));
    ok(await createTask({ title: "Bob's other task" }));

    await enqueue(db, { type: "test.owner", payload: { otherUserId: bob.id }, userId: alice.id });
    const [job] = await claimJobs("w", ["default"], 1);
    await runClaimed("w", job!);
    expect(ran.get(`owner:${bob.id}`)).toBe(1);
  });
});

describe("failures", () => {
  it("retries with a longer wait each time, then goes DEAD with a redacted error", async () => {
    const id = await enqueue(db, { type: "test.fail", payload: {}, maxAttempts: 3 });
    const waits: number[] = [];

    for (let attempt = 1; attempt <= 3; attempt++) {
      await db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, id));
      const [job] = await claimJobs("w", ["default"], 1);
      const outcome = await runClaimed("w", job!);
      const row = await statusOf(id);
      if (attempt < 3) {
        expect(outcome).toBe("FAILED");
        expect(row.status).toBe("FAILED");
        waits.push(row.runAt.getTime() - Date.now());
      } else {
        expect(outcome).toBe("DEAD");
        expect(row).toMatchObject({ status: "DEAD", attempts: 3 });
        expect(row.finishedAt).not.toBeNull();
      }
    }
    expect(waits[1]!).toBeGreaterThan(waits[0]!);
    const dead = await statusOf(id);
    expect(dead.lastError).toBe("Could not reach [email] at [link]");
  });

  it("a permanent error goes straight to DEAD, and a retry delay is respected", async () => {
    const permanent = await enqueue(db, { type: "test.permanent", payload: {} });
    const delayed = await enqueue(db, { type: "test.retry_after", payload: { ms: 120_000 } });
    const jobsClaimed = await claimJobs("w", ["default"], 5);
    for (const job of jobsClaimed) await runClaimed("w", job);

    expect(await statusOf(permanent)).toMatchObject({
      status: "DEAD",
      attempts: 1,
      lastError: "This will never work.",
    });
    const retried = await statusOf(delayed);
    expect(retried.status).toBe("FAILED");
    expect(retried.runAt.getTime() - Date.now()).toBeGreaterThan(110_000);
    expect(retried.runAt.getTime() - Date.now()).toBeLessThan(125_000);
  });

  it("an unknown type or a bad payload goes DEAD without stopping the loop", async () => {
    const unknown = await enqueue(db, { type: "no.such.type", payload: {} });
    const bad = await enqueue(db, { type: "test.count", payload: { key: 5 } });
    const good = await enqueue(db, { type: "test.count", payload: { key: "after" } });

    const worker = createWorker({
      workerId: "loop",
      concurrency: 2,
      queues: ["default"],
      pollMs: 20,
      version: "t",
      hostname: "h",
    });
    await worker.start();
    await waitFor(async () => (await statusOf(good)).status === "SUCCEEDED");
    await worker.stop();

    expect((await statusOf(unknown)).status).toBe("DEAD");
    expect((await statusOf(unknown)).lastError).toMatch(/No handler for job type no\.such\.type/);
    expect((await statusOf(bad)).status).toBe("DEAD");
    expect(seen("after")).toBe(1);
  });

  it("a crashed worker's job is reclaimed once its lock expires, counting the attempt, and runs once more", async () => {
    const id = await enqueue(db, { type: "test.count", payload: { key: "crashed" } });
    const [claimed] = await claimJobs("crashed-worker", ["default"], 1);
    expect(claimed?.attempts).toBe(1);
    await db
      .update(jobs)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, id));

    expect(await reapStaleLocks()).toBe(1);
    expect(await statusOf(id)).toMatchObject({ status: "FAILED", lockedBy: null, attempts: 1 });

    const [again] = await claimJobs("healthy-worker", ["default"], 1);
    expect(again?.attempts).toBe(2);
    await runClaimed("healthy-worker", again!);
    expect(await statusOf(id)).toMatchObject({ status: "SUCCEEDED" });
    expect(seen("crashed")).toBe(1);
  });

  it("a job that has used all its attempts is DEAD when its lock expires", async () => {
    const id = await enqueue(db, { type: "test.count", payload: { key: "last" }, maxAttempts: 1 });
    await claimJobs("w", ["default"], 1);
    await db
      .update(jobs)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, id));
    await reapStaleLocks();
    expect(await statusOf(id)).toMatchObject({ status: "DEAD" });
  });

  it("a stalled worker's late answer never overwrites a job that was reclaimed", async () => {
    const id = await enqueue(db, { type: "test.count", payload: { key: "stalled" } });
    const [first] = await claimJobs("stalled-worker", ["default"], 1);
    await db
      .update(jobs)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, id));
    await reapStaleLocks();
    await claimJobs("new-worker", ["default"], 1);

    expect(await runClaimed("stalled-worker", first!)).toBe("LOST");
    expect(await statusOf(id)).toMatchObject({ status: "RUNNING", lockedBy: "new-worker" });
  });
});

describe("enqueue", () => {
  it("allows one active job per dedupe key, and a new one once it has finished", async () => {
    const first = await enqueue(db, {
      type: "test.count",
      payload: { key: "d" },
      dedupeKey: "test:dedupe",
    });
    const same = await enqueue(db, {
      type: "test.count",
      payload: { key: "d" },
      dedupeKey: "test:dedupe",
    });
    expect(same).toBe(first);

    await db
      .update(jobs)
      .set({ status: "SUCCEEDED", finishedAt: new Date() })
      .where(eq(jobs.id, first));
    const next = await enqueue(db, {
      type: "test.count",
      payload: { key: "d" },
      dedupeKey: "test:dedupe",
    });
    expect(next).not.toBe(first);
  });

  it("leaves no job behind when the transaction that enqueued it rolls back", async () => {
    await expect(
      db.transaction(async (tx) => {
        await enqueue(tx, { type: "test.count", payload: { key: "rolled-back" } });
        throw new Error("the write failed");
      }),
    ).rejects.toThrow("the write failed");
    expect(await db.select().from(jobs).where(like(jobs.type, "test.%"))).toHaveLength(0);
  });

  it("refuses a payload that is too large or a queue that does not exist", async () => {
    await expect(
      enqueue(db, { type: "test.count", payload: { key: "x".repeat(5000) } }),
    ).rejects.toThrow();
    await expect(
      enqueue(db, { type: "test.count", payload: { key: "a" }, queue: "nope" as never }),
    ).rejects.toThrow();
  });
});

describe("the scheduler", () => {
  it("fires a due schedule once per slot even when two workers race, then moves on", async () => {
    const slot = new Date(Date.now() - 5000);
    await db.insert(jobSchedules).values({
      name: "test.every",
      cron: "every 60s",
      type: "test.count",
      payload: { key: "scheduled" },
      nextRunAt: slot,
    });

    const [a, b] = await Promise.all([fireDueSchedules(), fireDueSchedules()]);
    expect(a + b).toBe(1);
    const made = await db.select().from(jobs).where(eq(jobs.type, "test.count"));
    expect(made).toHaveLength(1);
    expect(made[0]?.dedupeKey).toBe(`test.every@${slot.toISOString()}`);

    const [row] = await db.select().from(jobSchedules).where(eq(jobSchedules.name, "test.every"));
    expect(row!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(await fireDueSchedules()).toBe(0);
  });

  it("skips a schedule that is switched off or has a cadence it cannot read", async () => {
    await db.insert(jobSchedules).values([
      {
        name: "test.off",
        cron: "every 60s",
        type: "test.count",
        payload: { key: "off" },
        enabled: false,
        nextRunAt: new Date(Date.now() - 1000),
      },
      {
        name: "test.bad",
        cron: "whenever",
        type: "test.count",
        payload: { key: "bad" },
        nextRunAt: new Date(Date.now() - 1000),
      },
    ]);
    expect(await fireDueSchedules()).toBe(0);
    expect(await db.select().from(jobs).where(like(jobs.type, "test.%"))).toHaveLength(0);
  });
});

describe("the worker loop", () => {
  it("writes a heartbeat, drains running jobs at shutdown, and removes its heartbeat", async () => {
    sleepMs = 300;
    const id = await enqueue(db, { type: "test.sleepy", payload: {} });
    const worker = createWorker({
      workerId: "drain",
      concurrency: 1,
      queues: ["default"],
      pollMs: 20,
      version: "v1",
      hostname: "h",
    });
    await worker.start();
    expect(
      await db.select().from(workerHeartbeats).where(eq(workerHeartbeats.workerId, "drain")),
    ).toHaveLength(1);
    await waitFor(async () => (await statusOf(id)).status === "RUNNING");

    await worker.stop();
    expect((await statusOf(id)).status).toBe("SUCCEEDED");
    expect(
      await db.select().from(workerHeartbeats).where(eq(workerHeartbeats.workerId, "drain")),
    ).toHaveLength(0);
  });

  it("stops a job that outlasts the grace period and puts it straight back in the queue", async () => {
    const id = await enqueue(db, { type: "test.sleepy", payload: { untilAbort: true } });
    const worker = createWorker({
      workerId: "grace",
      concurrency: 1,
      queues: ["default"],
      pollMs: 20,
      version: "v1",
      hostname: "h",
      shutdownGraceMs: 150,
    });
    await worker.start();
    await waitFor(async () => (await statusOf(id)).status === "RUNNING");

    await worker.stop();
    const row = await statusOf(id);
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toMatch(/shutting down/);
    expect(row.runAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row.lockedBy).toBeNull();
  });

  it("keeps the freshest heartbeat in the health answer without changing the status code", async () => {
    const read = async () => {
      const response = await healthRoute();
      return {
        status: response.status,
        body: (await response.json()) as { status: string; worker: string },
      };
    };
    expect(await read()).toMatchObject({ status: 200, body: { status: "ok", worker: "none" } });

    await beat({
      workerId: "hb",
      version: "v",
      queues: ["default"],
      hostname: "h",
      currentJobId: null,
    });
    expect(await read()).toMatchObject({ status: 200, body: { worker: "ok" } });

    await db
      .update(workerHeartbeats)
      .set({ lastSeenAt: new Date(Date.now() - 60_000) })
      .where(eq(workerHeartbeats.workerId, "hb"));
    expect(await read()).toMatchObject({ status: 200, body: { worker: "stale" } });
  });

  it("reports queue depth, the oldest waiting job and recent failures", async () => {
    await enqueue(db, {
      type: "test.count",
      payload: { key: "a" },
      runAt: new Date(Date.now() - 5000),
    });
    const dead = await enqueue(db, { type: "test.permanent", payload: {} });
    await db.update(jobs).set({ status: "DEAD", finishedAt: new Date() }).where(eq(jobs.id, dead));

    const stats = await getQueueStats();
    expect(stats.depth).toContainEqual({ queue: "default", status: "QUEUED", n: 1 });
    expect(stats.oldestWaitingMs).toBeGreaterThanOrEqual(5000);
    expect(stats.failures).toContainEqual({ type: "test.permanent", status: "DEAD", n: 1 });
  });
});

describe("tick mode", () => {
  const SECRET = "integration-tick-secret-0123456789abcdef";
  const call = (headers: Record<string, string> = {}) =>
    tickRoute(new Request("http://localhost/api/jobs/tick", { method: "POST", headers }));

  it("needs the secret: no header, a wrong one, or a signed-in person alone all get nothing", async () => {
    actAs(alice);
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer not-the-secret" })).status).toBe(401);
    expect((await call({ authorization: SECRET })).status).toBe(401);
  });

  it("runs due jobs and the schedules with the secret, and says how many are left", async () => {
    actAs(null);
    for (let i = 0; i < 3; i++)
      await enqueue(db, { type: "test.count", payload: { key: `tick-${i}` } });
    await db.insert(jobSchedules).values({
      name: "test.tick",
      cron: "every 60s",
      type: "test.count",
      payload: { key: "tick-scheduled" },
      nextRunAt: new Date(Date.now() - 1000),
    });

    const response = await call({ authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ran: 4, remaining: 0 });
    for (const key of ["tick-0", "tick-1", "tick-2", "tick-scheduled"]) expect(seen(key)).toBe(1);
  });

  it("stops when its time budget is spent and reports what is left", async () => {
    for (let i = 0; i < 5; i++)
      await enqueue(db, { type: "test.count", payload: { key: `budget-${i}` } });
    let now = 0;
    // Each reading of the clock advances time, so the budget runs out after two jobs.
    const result = await runTick({ budgetMs: 25_000, now: () => (now += 9_000) });
    expect(result.ran).toBe(2);
    expect(result.remaining).toBe(3);
  });
});

describe("maintenance jobs", () => {
  it("prune_jobs removes old finished jobs, old dead jobs and old heartbeats, and keeps the rest", async () => {
    const day = 86_400_000;
    const make = async (status: string, ageDays: number) => {
      const id = await enqueue(db, { type: "test.count", payload: { key: status + ageDays } });
      await db
        .update(jobs)
        .set({ status, finishedAt: new Date(Date.now() - ageDays * day) })
        .where(eq(jobs.id, id));
      return id;
    };
    const oldOk = await make("SUCCEEDED", 8);
    const newOk = await make("SUCCEEDED", 1);
    const oldDead = await make("DEAD", 15);
    const newDead = await make("DEAD", 10);
    await db.insert(workerHeartbeats).values({
      workerId: "old-hb",
      version: "v",
      queues: ["default"],
      hostname: "h",
      lastSeenAt: new Date(Date.now() - 2 * day),
    });

    const removed = await pruneJobs();
    expect(removed).toEqual({ succeeded: 1, dead: 1, heartbeats: 1 });
    const left = (
      await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.id, [oldOk, newOk, oldDead, newDead]))
    ).map((r) => r.id);
    expect(left.sort()).toEqual([newOk, newDead].sort());
  });

  it("prune_sync removes a month-old log and records the floor, so a device behind it takes a snapshot", async () => {
    actAs(alice);
    const task = ok(await createTask({ title: "Logged" }));
    const day = 86_400_000;
    const oldRows = await db
      .insert(changeLog)
      .values(
        [1, 2].map(() => ({
          userId: alice.id,
          entityType: "task",
          entityId: uuidv7(),
          op: "UPSERT",
          version: 1,
          changedAt: new Date(Date.now() - 40 * day),
        })),
      )
      .returning();
    await db.insert(syncOperations).values({
      userId: alice.id,
      opId: uuidv7(),
      deviceId: uuidv7(),
      entityType: "task",
      entityId: uuidv7(),
      type: "task.update",
      status: "APPLIED",
      payloadHash: "h",
      receivedAt: new Date(Date.now() - 40 * day),
    });
    const oldSeq = Math.max(...oldRows.map((r) => r.seq));

    const result = await pruneSync();
    expect(result.changes).toBeGreaterThanOrEqual(2);
    expect(result.operations).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(changeLog).where(eq(changeLog.entityId, task.id))).toHaveLength(
      1,
    );
    const [floor] = await db
      .select()
      .from(syncRetention)
      .where(eq(syncRetention.key, "change_log"));
    expect(floor!.value).toBeGreaterThanOrEqual(oldSeq);

    const pull = async (cursor: number) =>
      (await (
        await pullRoute(new Request(`http://localhost/api/sync/pull?cursor=${cursor}`))
      ).json()) as { snapshotRequired: boolean; headCursor?: number };
    expect(await pull(0)).toMatchObject({ snapshotRequired: true });
    expect((await pull(floor!.value - 1)).snapshotRequired).toBe(true);
    expect((await pull(floor!.value)).snapshotRequired).toBe(false);
  });
});
