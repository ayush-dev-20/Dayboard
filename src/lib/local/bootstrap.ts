import type { SnapshotPage, SnapshotPreferences, SnapshotTask } from "@/lib/sync/snapshot";
import type { LocalDatabase } from "./db";

// Filling the offline database from the server (V2 feature 04 §4). Rows only ever flow in here: a row is
// never replaced while a change to it is still waiting to be sent.

const MAX_PAGES = 1000;

/** Operations whose entity must not be overwritten from the server. */
async function unsyncedEntityIds(db: LocalDatabase): Promise<Set<string>> {
  const waiting = await db.operations
    .where("status")
    .anyOf(["PENDING", "SENDING", "FAILED", "CONFLICT"])
    .toArray();
  return new Set(waiting.map((op) => op.entityId));
}

/**
 * Upserts server rows that are newer than the local copy. A local row with a change still waiting keeps
 * its values until that change is acknowledged.
 */
export async function seedTasks(db: LocalDatabase, rows: SnapshotTask[]): Promise<void> {
  await db.transaction("rw", db.tasks, db.operations, async () => {
    const waiting = await unsyncedEntityIds(db);
    for (const row of rows) {
      if (waiting.has(row.id)) continue;
      const local = await db.tasks.get(row.id);
      // The newer version wins (ADR 0007). A row without a version yet (made here) is always replaced.
      if (!local || local.version < row.version) await db.tasks.put(row);
    }
  });
}

/** Removes local tasks the server no longer lists (their deletion has passed the tombstone window). */
async function dropStaleTasks(db: LocalDatabase, serverIds: Set<string>): Promise<void> {
  await db.transaction("rw", db.tasks, db.operations, async () => {
    const waiting = await unsyncedEntityIds(db);
    const stale = (await db.tasks.toCollection().primaryKeys()).filter(
      (id) => !serverIds.has(id) && !waiting.has(id),
    );
    await db.tasks.bulkDelete(stale);
  });
}

/**
 * Pulls every page of tasks, then drops what the server no longer has. Pages come from `fetchPage`, so the
 * same code runs against the real endpoint in the app and a fake in tests.
 */
export async function bootstrapTasks(
  db: LocalDatabase,
  fetchPage: (cursor: string | null) => Promise<SnapshotPage<SnapshotTask>>,
  now: Date = new Date(),
): Promise<number> {
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(cursor);
    await seedTasks(db, result.rows);
    for (const row of result.rows) seen.add(row.id);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  await dropStaleTasks(db, seen);
  await db.meta.put({ key: "tasksBootstrappedAt", value: now.toISOString() });
  return seen.size;
}

export async function storePreferences(
  db: LocalDatabase,
  page: SnapshotPage<SnapshotPreferences>,
): Promise<SnapshotPreferences | null> {
  const prefs = page.rows[0] ?? null;
  if (prefs) await db.meta.put({ key: "preferences", value: prefs });
  return prefs;
}

export async function readPreferences(db: LocalDatabase): Promise<SnapshotPreferences | null> {
  const row = await db.meta.get("preferences");
  return (row?.value as SnapshotPreferences | undefined) ?? null;
}
