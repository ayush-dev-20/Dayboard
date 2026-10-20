import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "@/db/executor";
import { changeLog, tasks } from "@/db/schema";
import { reconcileTaskReminders } from "@/lib/notifications/reminders";

// Versions and the change log (V2 feature 05, docs/decisions/0007). Every write to a syncable row calls
// one of these helpers inside the same transaction, so a pull never misses a committed change.

// The device that is pushing, for the duration of one request. Online use has no device: `null`.
const deviceContext = new AsyncLocalStorage<{ deviceId: string | null }>();

/** Runs `work` with `deviceId` recorded on every write it makes (used by the push endpoint). */
export function withDevice<T>(deviceId: string | null, work: () => Promise<T>): Promise<T> {
  return deviceContext.run({ deviceId }, work);
}

export function currentDeviceId(): string | null {
  return deviceContext.getStore()?.deviceId ?? null;
}

/**
 * Logs upserts of these tasks. With `bump`, each row's version goes up by one and the device is recorded
 * on it (an existing row was changed). Without it, the row was just created and already has version 1.
 * Must run inside the transaction that made the write.
 */
export async function logTaskUpserts(
  tx: Executor,
  userId: string,
  ids: string[],
  options: { bump: boolean },
): Promise<void> {
  if (ids.length === 0) return;
  const deviceId = currentDeviceId();
  const rows = options.bump
    ? await tx
        .update(tasks)
        .set({ version: sql`${tasks.version} + 1`, lastModifiedByDeviceId: deviceId })
        .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)))
        .returning({ id: tasks.id, version: tasks.version })
    : await tx
        .select({ id: tasks.id, version: tasks.version })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)));
  if (rows.length === 0) return;
  await tx.insert(changeLog).values(
    rows.map((row) => ({
      userId,
      entityType: "task",
      entityId: row.id,
      op: "UPSERT",
      version: row.version,
      deviceId,
    })),
  );
  // Every task write passes through here, so this is where reminders follow the task (V2 feature 14 §3).
  await reconcileTaskReminders(
    tx,
    userId,
    rows.map((row) => row.id),
  );
}

/**
 * Logs permanent deletes. The rows are already gone, so the caller reads their versions first and passes
 * the version the delete counts as (the previous one plus one).
 */
export async function logTaskDeletes(
  tx: Executor,
  userId: string,
  deleted: { id: string; version: number }[],
): Promise<void> {
  if (deleted.length === 0) return;
  const deviceId = currentDeviceId();
  await tx.insert(changeLog).values(
    deleted.map((row) => ({
      userId,
      entityType: "task",
      entityId: row.id,
      op: "DELETE",
      version: row.version,
      deviceId,
    })),
  );
}
