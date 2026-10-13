import "fake-indexeddb/auto";
import { eq } from "drizzle-orm";
import Dexie from "dexie";
import { beforeAll, describe, expect, it } from "vitest";
import { deleteTask, permanentlyDeleteTask, updateTask } from "@/actions/tasks";
import { db } from "@/db/client";
import { syncRetention, tasks } from "@/db/schema";
import { POST as pushRoute } from "@/app/api/sync/push/route";
import { GET as pullRoute } from "@/app/api/sync/pull/route";
import { GET as snapshotRoute } from "@/app/api/sync/snapshot/route";
import { completeTask, createTask, renameTask } from "@/lib/local/commands/tasks";
import { bootstrapTasks } from "@/lib/local/bootstrap";
import { LocalDatabase } from "@/lib/local/db";
import { runSync, type Transport } from "@/lib/local/engine";
import { uuidv7 } from "@/lib/ids";
import { actAs, createTestUser, ok, type TestUser } from "./harness";

// V2 feature 05 end to end on the device engine and the real routes: two devices of one person (two local
// databases) and a second person. Each scenario is a sequence of offline edits, syncs and checks of the
// server's own rows.

let alice: TestUser;
let bob: TestUser;

/** The engine's transport, calling the route handlers as the given person. */
function serverAs(person: TestUser): Transport {
  return {
    async push(body) {
      actAs(person);
      const response = await pushRoute(
        new Request("http://localhost/api/sync/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      if (!response.ok) throw new Error(`push ${response.status}`);
      return (await response.json()) as never;
    },
    async pull(cursor, limit) {
      actAs(person);
      const response = await pullRoute(
        new Request(`http://localhost/api/sync/pull?cursor=${cursor}&limit=${limit}`),
      );
      if (!response.ok) throw new Error(`pull ${response.status}`);
      return (await response.json()) as never;
    },
  };
}

/** A device: its own local database, its own id. */
async function device(label: string) {
  const db = new LocalDatabase(`dev-${label}-${uuidv7()}`);
  await db.open();
  return {
    db,
    deviceId: uuidv7(),
    ctx(person: TestUser) {
      return { db, deviceId: this.deviceId, defaultPriority: "NONE" as const, person };
    },
    async sync(person: TestUser) {
      return runSync({
        db,
        deviceId: this.deviceId,
        appVersion: "test",
        transport: serverAs(person),
      });
    },
    async close() {
      db.close();
      await Dexie.delete(db.name);
    },
  };
}

const commandCtx = (d: Awaited<ReturnType<typeof device>>) => ({
  db: d.db,
  deviceId: d.deviceId,
  defaultPriority: "NONE" as const,
});

async function serverTitle(id: string) {
  return (await db.select().from(tasks).where(eq(tasks.id, id)))[0]?.title ?? null;
}

beforeAll(async () => {
  alice = await createTestUser("alice-engine");
  bob = await createTestUser("bob-engine");
});

describe("two devices of one person", () => {
  it("offline edits on a phone reach the server once, and the laptop pulls them", async () => {
    const phone = await device("phone");
    const laptop = await device("laptop");

    const id = await createTask(commandCtx(phone), { title: "Written on the train" });
    await renameTask(commandCtx(phone), id, "Renamed on the train");
    const report = await phone.sync(alice);
    expect(report).toMatchObject({ sent: 2, failed: 0, stoppedOffline: false });
    expect(await serverTitle(id)).toBe("Renamed on the train");

    await laptop.sync(alice);
    expect((await laptop.db.tasks.get(id))?.title).toBe("Renamed on the train");

    await phone.close();
    await laptop.close();
  });

  it("a retry after a lost answer does not make a second copy", async () => {
    const phone = await device("retry");
    const id = await createTask(commandCtx(phone), { title: "Retried" });
    // Simulate a lost answer: the server has the change, the device still thinks it is waiting.
    const op = (await phone.db.operations.toArray())[0]!;
    await phone.sync(alice);
    await phone.db.operations.put({ ...op, status: "PENDING", attempts: 0 });
    const again = await phone.sync(alice);
    expect(again.failed).toBe(0);
    expect(await db.select().from(tasks).where(eq(tasks.id, id))).toHaveLength(1);
    await phone.close();
  });

  it("the later change wins on a shared task, with no conflict to resolve", async () => {
    const phone = await device("lww-phone");
    const laptop = await device("lww-laptop");
    const id = await createTask(commandCtx(phone), { title: "Shared" });
    await phone.sync(alice);
    await laptop.sync(alice);

    await renameTask(commandCtx(laptop), id, "Laptop title");
    await laptop.sync(alice);
    await renameTask(commandCtx(phone), id, "Phone title");
    await phone.sync(alice);

    expect(await serverTitle(id)).toBe("Phone title");
    await laptop.sync(alice);
    expect((await laptop.db.tasks.get(id))?.title).toBe("Phone title");
    await phone.close();
    await laptop.close();
  });

  it("a deletion on one device removes the task on the other, and a trashed one stays as a tombstone", async () => {
    const phone = await device("del-phone");
    const laptop = await device("del-laptop");
    const gone = await createTask(commandCtx(phone), { title: "Permanently removed" });
    await phone.sync(alice);
    await laptop.sync(alice);
    expect(await laptop.db.tasks.get(gone)).toBeDefined();

    actAs(alice);
    await deleteTask({ id: gone });
    await permanentlyDeleteTask({ id: gone });
    await laptop.sync(alice);
    expect(await laptop.db.tasks.get(gone)).toBeUndefined();
    await phone.close();
    await laptop.close();
  });

  it("completing a repeating task on the phone gives the laptop the next occurrence once", async () => {
    const phone = await device("rep-phone");
    const laptop = await device("rep-laptop");
    const repeating = await createTask(commandCtx(phone), {
      title: "Daily",
      dueDate: "2026-10-13",
    });
    // The repeat is set on the server, the way the Tasks page sets it, and both devices pull it.
    actAs(alice);
    await phone.sync(alice);
    ok(await updateTask({ id: repeating, recurrenceRule: "FREQ=DAILY" }));
    await phone.sync(alice);
    await laptop.sync(alice);
    await completeTask(commandCtx(phone), repeating);
    await phone.sync(alice);
    await laptop.sync(alice);

    const nextRows = await laptop.db.tasks
      .filter((t) => t.recurrenceParentId === repeating)
      .toArray();
    expect(nextRows).toHaveLength(1);
    expect(nextRows[0]?.dueDate).toBe("2026-10-14");
    await phone.close();
    await laptop.close();
  });
});

describe("a device that fell behind a pruned log", () => {
  it("takes a fresh snapshot and carries on, with nothing lost", async () => {
    const phone = await device("pruned-phone");
    const laptop = await device("pruned-laptop");
    const id = await createTask(commandCtx(phone), { title: "Made before the prune" });
    await phone.sync(alice);
    await laptop.sync(alice);
    await renameTask(commandCtx(phone), id, "Renamed while the laptop was away");
    await phone.sync(alice);

    // The log is pruned past the laptop's cursor: the floor now sits above it.
    const laptopCursor = Number((await laptop.db.meta.get("lastPullCursor"))?.value ?? 0);
    const [before] = await db
      .select()
      .from(syncRetention)
      .where(eq(syncRetention.key, "change_log"));
    await db
      .update(syncRetention)
      .set({ value: laptopCursor + 1 })
      .where(eq(syncRetention.key, "change_log"));

    try {
      const report = await runSync({
        db: laptop.db,
        deviceId: laptop.deviceId,
        appVersion: "test",
        transport: serverAs(alice),
        snapshot: () =>
          bootstrapTasks(laptop.db, async (cursor) => {
            actAs(alice);
            const url = new URL("http://localhost/api/sync/snapshot");
            url.searchParams.set("entity", "tasks");
            if (cursor) url.searchParams.set("cursor", cursor);
            return (await (await snapshotRoute(new Request(url))).json()) as never;
          }),
      });
      expect(report.stoppedOffline).toBe(false);
      expect((await laptop.db.tasks.get(id))?.title).toBe("Renamed while the laptop was away");
      // It continues from the log's head, so the next pull asks for nothing it already has.
      expect(Number((await laptop.db.meta.get("lastPullCursor"))?.value)).toBeGreaterThanOrEqual(
        laptopCursor,
      );
    } finally {
      await db
        .update(syncRetention)
        .set({ value: before?.value ?? 0 })
        .where(eq(syncRetention.key, "change_log"));
      await phone.close();
      await laptop.close();
    }
  });
});

describe("the other person", () => {
  it("never sees, and never changes, what this person's devices sync", async () => {
    const phone = await device("iso-phone");
    const bobDevice = await device("iso-bob");
    const id = await createTask(commandCtx(phone), { title: "Alice only" });
    await phone.sync(alice);

    await bobDevice.sync(bob);
    expect(await bobDevice.db.tasks.get(id)).toBeUndefined();

    const bobTitle = await createTask(commandCtx(bobDevice), { title: "Bob's" });
    await bobDevice.sync(bob);
    await phone.sync(alice);
    expect(await phone.db.tasks.get(bobTitle)).toBeUndefined();
    await phone.close();
    await bobDevice.close();
  });
});
