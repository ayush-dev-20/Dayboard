import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTask } from "@/actions/tasks";
import { db } from "@/db/client";
import { changeLog, tasks } from "@/db/schema";
import { POST as pushRoute } from "@/app/api/sync/push/route";
import { GET as pullRoute } from "@/app/api/sync/pull/route";
import { uuidv7 } from "@/lib/ids";
import type { OpEnvelope } from "@/lib/sync/operations";
import { actAs, createTestUser, ok, type TestUser } from "./harness";

// V2 feature 05 against the real routes and database: idempotent push, per-operation results, dependencies,
// versions and the change log, pull after a cursor, tombstones, and that nobody sees anyone else's changes.

type PushResultLike = {
  status: string;
  version: number | null;
  errorCode?: string | null;
  entity?: { status: string } | null;
};

let alice: TestUser;
let bob: TestUser;
const DEVICE = uuidv7();

async function push(ops: unknown[], deviceId = DEVICE) {
  const response = await pushRoute(
    new Request("http://localhost/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, appVersion: "test", ops }),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as { results: PushResultLike[] },
  };
}

async function pull(cursor = 0, limit = 500) {
  const response = await pullRoute(
    new Request(`http://localhost/api/sync/pull?cursor=${cursor}&limit=${limit}`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    changes: {
      entityId: string;
      op: string;
      version: number;
      entity?: { title: string; deletedAt: string | null };
    }[];
    nextCursor: number;
    hasMore: boolean;
  };
}

function op(
  type: OpEnvelope["type"],
  entityId: string,
  payload: unknown,
  extra: Partial<OpEnvelope> = {},
) {
  return {
    opId: uuidv7(),
    entityType: "task",
    entityId,
    type,
    clientTimestamp: new Date().toISOString(),
    baseVersion: null,
    payload,
    ...extra,
  };
}

beforeAll(async () => {
  alice = await createTestUser("alice-push");
  bob = await createTestUser("bob-push");
});

describe("POST /api/sync/push: applying and recording", () => {
  it("creates a task with the device's id, versions it, and logs the change with the device", async () => {
    actAs(alice);
    const id = uuidv7();
    const { status, body } = await push([op("task.create", id, { title: "Pushed", id })]);
    expect(status).toBe(200);
    expect(body.results[0]).toMatchObject({
      status: "APPLIED",
      version: 1,
      entity: { id, title: "Pushed", version: 1 },
    });

    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    expect(row?.lastModifiedByDeviceId).toBeNull();
    const logged = await db.select().from(changeLog).where(eq(changeLog.entityId, id));
    expect(logged).toEqual([
      expect.objectContaining({ op: "UPSERT", version: 1, deviceId: DEVICE }),
    ]);
  });

  it("applies an update, bumps the version, and records the device on the row", async () => {
    actAs(alice);
    const task = ok(await createTask({ title: "Before" }));
    const { body } = await push([op("task.update", task.id, { title: "After" })]);
    expect(body.results[0]).toMatchObject({ status: "APPLIED", version: 2 });
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row).toMatchObject({ title: "After", version: 2, lastModifiedByDeviceId: DEVICE });
  });

  it("returns the stored answer for a repeated operation id and changes nothing", async () => {
    actAs(alice);
    const id = uuidv7();
    const create = op("task.create", id, { title: "Once", id });
    await push([create]);
    const again = await push([create]);
    expect(again.body.results[0]).toMatchObject({ status: "DUPLICATE_IGNORED", version: 1 });
    expect(await db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(1);
    expect(await db.select().from(changeLog).where(eq(changeLog.entityId, id))).toHaveLength(1);
  });

  it("refuses an operation id reused for a different change", async () => {
    actAs(alice);
    const id = uuidv7();
    const first = op("task.create", id, { title: "First", id });
    await push([first]);
    const changed = { ...first, payload: { title: "Different", id } };
    const { body } = await push([changed]);
    expect(body.results[0]).toMatchObject({ status: "REJECTED", errorCode: "VALIDATION_ERROR" });
    expect((await db.select().from(tasks).where(eq(tasks.id, id)))[0]?.title).toBe("First");
  });

  it("applies the good operations in a batch when one fails", async () => {
    actAs(alice);
    const good = uuidv7();
    const { body } = await push([
      op("task.update", uuidv7(), { title: "No such task" }),
      op("task.create", good, { title: "Still applied", id: good }),
    ]);
    expect(body.results.map((r) => r.status)).toEqual(["REJECTED", "APPLIED"]);
    expect(body.results[0]).toMatchObject({ errorCode: "NOT_FOUND" });
    expect(await db.select().from(tasks).where(eq(tasks.id, good))).toHaveLength(1);
  });

  it("holds a subtask until its parent exists, without storing the refusal", async () => {
    actAs(alice);
    const parent = uuidv7();
    const child = uuidv7();
    const subtask = op(
      "task.create",
      child,
      { title: "Child", id: child, parentTaskId: parent },
      {
        dependsOn: [{ entityType: "task", entityId: parent }],
      },
    );

    const early = await push([subtask]);
    expect(early.body.results[0]).toMatchObject({ status: "DEPENDENCY_MISSING" });

    await push([op("task.create", parent, { title: "Parent", id: parent })]);
    const retry = await push([subtask]);
    expect(retry.body.results[0]).toMatchObject({ status: "APPLIED" });
  });

  it("completes a repeating task with the next occurrence id the device chose", async () => {
    actAs(alice);
    const parent = ok(
      await createTask({
        title: "Weekly",
        dueDate: "2026-10-13",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      }),
    );
    const next = uuidv7();
    const { body } = await push([op("task.complete", parent.id, { nextOccurrenceId: next })]);
    expect(body.results[0]).toMatchObject({ status: "APPLIED", entity: { status: "DONE" } });
    expect(await db.select().from(tasks).where(eq(tasks.id, next))).toHaveLength(1);
  });

  it("reopens a completed task", async () => {
    actAs(alice);
    const task = ok(await createTask({ title: "Done then open", status: "DONE" }));
    const { body } = await push([op("task.reopen", task.id, {})]);
    expect(body.results[0]).toMatchObject({ status: "APPLIED", entity: { status: "PLANNED" } });
  });

  it("refuses another person's task as not found, and leaves it alone", async () => {
    actAs(bob);
    const theirs = ok(await createTask({ title: "Bob's" }));
    actAs(alice);
    const { body } = await push([op("task.update", theirs.id, { title: "Hijacked" })]);
    expect(body.results[0]).toMatchObject({ status: "REJECTED", errorCode: "NOT_FOUND" });
    expect((await db.select().from(tasks).where(eq(tasks.id, theirs.id)))[0]?.title).toBe("Bob's");
  });

  it("refuses a payload the task schema does not allow, for that operation only", async () => {
    actAs(alice);
    const { body } = await push([op("task.update", uuidv7(), { title: "" })]);
    expect(body.results[0]).toMatchObject({ status: "REJECTED", errorCode: "VALIDATION_ERROR" });
  });

  it("refuses a request over 50 operations or 1 MB", async () => {
    actAs(alice);
    const many = Array.from({ length: 51 }, () => op("task.reopen", uuidv7(), {}));
    expect((await push(many)).status).toBe(400);
    const big = op("task.update", uuidv7(), { title: "x".repeat(1024 * 1024 + 10) });
    expect((await push([big])).status).toBe(400);
  });

  it("needs a signed-in person", async () => {
    actAs(null);
    expect((await push([op("task.reopen", uuidv7(), {})])).status).toBe(401);
    actAs(alice);
  });
});

describe("GET /api/sync/pull", () => {
  it("returns changes after the cursor, newest per entity, with the entity read fresh", async () => {
    actAs(alice);
    const start = (await pull()).nextCursor;
    const task = ok(await createTask({ title: "Pull me" }));
    await push([
      op("task.update", task.id, { title: "Pulled" }),
      op("task.update", task.id, { title: "Pulled again" }),
    ]);

    const page = await pull(start);
    const mine = page.changes.filter((c) => c.entityId === task.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ op: "UPSERT", entity: { title: "Pulled again" } });
    expect(page.nextCursor).toBeGreaterThan(start);
  });

  it("sends a permanently deleted task as DELETE, and a trashed one as a tombstone", async () => {
    actAs(alice);
    const start = (await pull()).nextCursor;
    const trashed = ok(await createTask({ title: "Trashed" }));
    const gone = ok(await createTask({ title: "Gone" }));
    const { deleteTask, permanentlyDeleteTask } = await import("@/actions/tasks");
    ok(await deleteTask({ id: trashed.id }));
    ok(await deleteTask({ id: gone.id }));
    ok(await permanentlyDeleteTask({ id: gone.id }));

    const page = await pull(start);
    const t = page.changes.find((c) => c.entityId === trashed.id);
    const g = page.changes.find((c) => c.entityId === gone.id);
    expect(t).toMatchObject({ op: "UPSERT", entity: { deletedAt: expect.any(String) } });
    expect(g).toMatchObject({ op: "DELETE" });
  });

  it("pages with hasMore and a cursor, and never shows one person's changes to another", async () => {
    actAs(alice);
    const start = (await pull()).nextCursor;
    for (let i = 0; i < 3; i++) ok(await createTask({ title: `Page ${i}` }));
    const first = await pull(start, 1);
    expect(first.changes).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = await pull(first.nextCursor, 500);
    expect(second.changes.length).toBeGreaterThanOrEqual(2);

    actAs(bob);
    const bobPull = await pull(start, 500);
    const aliceIds = new Set(first.changes.map((c) => c.entityId));
    expect(bobPull.changes.some((c) => aliceIds.has(c.entityId))).toBe(false);
  });
});
