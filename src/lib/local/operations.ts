import { uuidv7 } from "@/lib/ids";
import type { LocalDatabase, Operation, OperationType } from "./db";

// The operations queue (V2 feature 04 §3). Every change a person makes offline is written here, in the
// same transaction as the change itself, so a refresh cannot separate the two.

export type NewOperation = {
  entityId: string;
  type: OperationType;
  payload: Record<string, unknown>;
  deviceId: string;
  now: Date;
};

/**
 * Adds an operation. Repeated edits to the same task before it is sent merge into one update, so the
 * queue does not grow with every keystroke. Must run inside a transaction on `operations`.
 */
export async function appendOperation(db: LocalDatabase, op: NewOperation): Promise<void> {
  if (op.type === "task.update") {
    const pending = await db.operations
      .where("[entityType+entityId]")
      .equals(["task", op.entityId])
      .filter((row) => row.status === "PENDING" && row.type === "task.update")
      .first();
    if (pending) {
      await db.operations.update(pending.opId, { payload: { ...pending.payload, ...op.payload } });
      return;
    }
  }

  const last = await db.operations.orderBy("seq").last();
  const row: Operation = {
    opId: uuidv7(op.now.getTime()),
    seq: (last?.seq ?? 0) + 1,
    entityType: "task",
    entityId: op.entityId,
    type: op.type,
    payload: op.payload,
    clientTimestamp: op.now.toISOString(),
    deviceId: op.deviceId,
    status: "PENDING",
    attempts: 0,
    lastError: null,
  };
  await db.operations.add(row);
}
