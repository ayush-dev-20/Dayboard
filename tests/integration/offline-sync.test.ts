import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { completeTask, createTask, setTaskStatus, updateTask } from "@/actions/tasks";
import { db } from "@/db/client";
import { tasks } from "@/db/schema";
import { GET as snapshotRoute } from "@/app/api/sync/snapshot/route";
import { uuidv7 } from "@/lib/ids";
import { TOMBSTONE_DAYS, type SnapshotPage, type SnapshotTask } from "@/lib/sync/snapshot";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V2 feature 04 against the real database and routes: the bootstrap snapshot (owner scoping, paging,
// tombstones) and the create and complete actions that accept the device's ids.

let alice: TestUser;
let bob: TestUser;

async function snapshot(params: Record<string, string>): Promise<Response> {
  const url = new URL("http://localhost/api/sync/snapshot");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return snapshotRoute(new Request(url));
}

async function readPage(params: Record<string, string>): Promise<SnapshotPage<SnapshotTask>> {
  const response = await snapshot(params);
  expect(response.status).toBe(200);
  return (await response.json()) as SnapshotPage<SnapshotTask>;
}

beforeAll(async () => {
  alice = await createTestUser("alice-sync");
  bob = await createTestUser("bob-sync");
});

describe("GET /api/sync/snapshot", () => {
  it("returns only the signed-in person's tasks, never anyone else's", async () => {
    actAs(alice);
    const mine = ok(await createTask({ title: "Alice's snapshot task" }));
    actAs(bob);
    const theirs = ok(await createTask({ title: "Bob's snapshot task" }));

    actAs(alice);
    const seen = await readPage({ entity: "tasks", limit: "500" });
    const ids = seen.rows.map((row) => row.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("pages with a cursor until there is nothing left", async () => {
    actAs(alice);
    const made = [];
    for (let i = 0; i < 3; i++) made.push(ok(await createTask({ title: `Page item ${i}` })).id);

    const first = await readPage({ entity: "tasks", limit: "2" });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toBe(first.rows.at(-1)!.id);

    const collected: string[] = [];
    let cursor: string | null = null;
    do {
      const page: SnapshotPage<SnapshotTask> = await readPage(
        cursor ? { entity: "tasks", limit: "2", cursor } : { entity: "tasks", limit: "2" },
      );
      collected.push(...page.rows.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor);

    // Every created task appears exactly once across the pages, in id order.
    for (const id of made) expect(collected.filter((x) => x === id)).toHaveLength(1);
    expect([...collected]).toEqual([...collected].sort());
  });

  it("includes deletions from the last 30 days, and leaves out older ones", async () => {
    actAs(alice);
    const recent = ok(await createTask({ title: "Deleted recently" }));
    const old = ok(await createTask({ title: "Deleted long ago" }));
    const deletedAt = (days: number) => new Date(Date.now() - days * 86_400_000);
    await db
      .update(tasks)
      .set({ deletedAt: deletedAt(3) })
      .where(eq(tasks.id, recent.id));
    await db
      .update(tasks)
      .set({ deletedAt: deletedAt(TOMBSTONE_DAYS + 5) })
      .where(eq(tasks.id, old.id));

    const ids = (await readPage({ entity: "tasks", limit: "500" })).rows.map((row) => row.id);
    expect(ids).toContain(recent.id);
    expect(ids).not.toContain(old.id);
    const row = (await readPage({ entity: "tasks", limit: "500" })).rows.find(
      (r) => r.id === recent.id,
    );
    expect(row?.deletedAt).not.toBeNull();
  });

  it("sends the preferences the offline app needs", async () => {
    actAs(alice);
    const page = await readPage({ entity: "preferences" });
    expect(page.nextCursor).toBeNull();
    expect(page.rows[0]).toMatchObject({
      timezone: expect.any(String),
      defaultTaskPriority: expect.any(String),
    });
  });

  it("is never cached, and needs a signed-in person", async () => {
    actAs(alice);
    const response = await snapshot({ entity: "tasks" });
    expect(response.headers.get("cache-control")).toBe("no-store");

    actAs(null);
    const anonymous = await snapshot({ entity: "tasks" });
    expect(anonymous.status).toBe(401);
  });

  it("refuses an unknown entity and a malformed cursor", async () => {
    actAs(alice);
    expect((await snapshot({ entity: "notes" })).status).toBe(400);
    expect((await snapshot({ entity: "tasks", cursor: "nope" })).status).toBe(400);
  });
});

describe("the device's ids on create and complete", () => {
  it("creates a task with the id the device made, once", async () => {
    actAs(alice);
    const id = uuidv7();
    const created = ok(await createTask({ id, title: "Made offline" }));
    expect(created.id).toBe(id);

    const again = errorOf(await createTask({ id, title: "Made offline, again" }));
    expect(again.code).toBe("CONFLICT");
    expect(await db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(1);
  });

  it("refuses an id that is not a version 7 UUID", async () => {
    actAs(alice);
    const notV7 = "9b2f4c1e-3d5a-4b6c-8d7e-1f2a3b4c5d6e";
    expect(errorOf(await createTask({ id: notV7, title: "Wrong kind" })).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("completes a repeating task using the next-occurrence id the device chose", async () => {
    actAs(alice);
    const parent = ok(
      await createTask({
        title: "Weekly",
        dueDate: "2026-10-13",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      }),
    );
    const next = uuidv7();
    const result = ok(await completeTask({ id: parent.id, nextOccurrenceId: next }));
    expect(result.nextOccurrenceId).toBe(next);
    expect(await db.select().from(tasks).where(eq(tasks.id, next))).toHaveLength(1);
  });

  it("the replayed status change and title change go through the normal actions", async () => {
    actAs(alice);
    const task = ok(await createTask({ title: "Replay me" }));
    ok(await updateTask({ id: task.id, title: "Replayed" }));
    ok(await setTaskStatus({ id: task.id, status: "PLANNED" }));
    expect(await db.select().from(tasks).where(eq(tasks.id, task.id))).toEqual([
      expect.objectContaining({ title: "Replayed", status: "PLANNED" }),
    ]);
  });
});
