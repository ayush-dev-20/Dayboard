import Dexie, { type Table } from "dexie";
import type { SnapshotTask } from "@/lib/sync/snapshot";
import { localDbName } from "./user-key";

// The offline database (V2 feature 04 §2). Version 1. Later changes are added as new versions only.
// Dates are ISO strings, as they are in the snapshot. A deletion stays as a row (a tombstone).

export const OPERATION_STATUSES = ["PENDING", "SENDING", "ACKED", "FAILED", "CONFLICT"] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export type OperationType = "task.create" | "task.update" | "task.complete" | "task.reopen";

export type Operation = {
  opId: string;
  /** Position in the queue. Strictly increasing, so replay keeps the order the person made changes in. */
  seq: number;
  entityType: "task";
  entityId: string;
  type: OperationType;
  payload: Record<string, unknown>;
  clientTimestamp: string;
  deviceId: string;
  status: OperationStatus;
  attempts: number;
  lastError: string | null;
};

export type MetaRow = { key: string; value: unknown };

export class LocalDatabase extends Dexie {
  tasks!: Table<SnapshotTask, string>;
  operations!: Table<Operation, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      tasks: "id, status, dueDate, projectId, parentTaskId, updatedAt, deletedAt",
      operations: "opId, seq, status, [entityType+entityId], clientTimestamp",
      meta: "key",
    });
  }
}

const opened = new Map<string, LocalDatabase>();

/** The database for one person, opened once per page. A different person gets a different database. */
export async function openLocalDatabase(userId: string): Promise<LocalDatabase> {
  const name = await localDbName(userId);
  let db = opened.get(name);
  if (!db) {
    db = new LocalDatabase(name);
    opened.set(name, db);
  }
  if (!db.isOpen()) await db.open();
  return db;
}

/** Closes and deletes one person's database (sign-out with nothing waiting, or account deletion). */
export async function deleteLocalDatabase(userId: string): Promise<void> {
  const name = await localDbName(userId);
  const db = opened.get(name);
  if (db) {
    db.close();
    opened.delete(name);
  }
  await Dexie.delete(name);
}
