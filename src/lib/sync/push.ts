import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import type { Tx } from "@/db/executor";
import { createTask } from "@/db/mutations/tasks";
import { completeTask, setTaskStatus, updateTask } from "@/db/mutations/tasks";
import { syncOperations, tasks } from "@/db/schema";
import { snapshotTaskById } from "@/db/queries/sync";
import { getPreferences } from "@/lib/preferences";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { SnapshotTask } from "@/lib/sync/snapshot";
import { payloadHash } from "./payload-hash";
import { withDevice } from "./change-log";
import { parseTaskPayload, type Outcome, type OpEnvelope, type PushRequest } from "./operations";

// The push (V2 feature 05 §3). Each operation is checked, applied through the same mutation functions the
// Server Actions use, and its final result is stored under (user, op id). Operations run in the order the
// device sent them, so one batch never reorders a person's changes.

export type PushResult = {
  opId: string;
  status: Outcome;
  version: number | null;
  entity: SnapshotTask | null;
  errorCode: string | null;
  message: string | null;
};

type Recorded = Extract<Outcome, "APPLIED" | "REJECTED" | "CONFLICT">;

function outcome(
  op: OpEnvelope,
  status: Outcome,
  extra: Partial<Omit<PushResult, "opId" | "status">> = {},
): PushResult {
  return {
    opId: op.opId,
    status,
    version: extra.version ?? null,
    entity: extra.entity ?? null,
    errorCode: extra.errorCode ?? null,
    message: extra.message ?? null,
  };
}

async function record(
  executor: Tx | typeof db,
  userId: string,
  deviceId: string,
  op: OpEnvelope,
  hash: string,
  status: Recorded,
  version: number | null,
  errorCode: string | null,
) {
  await executor
    .insert(syncOperations)
    .values({
      userId,
      opId: op.opId,
      deviceId,
      entityType: op.entityType,
      entityId: op.entityId,
      type: op.type,
      status,
      resultVersion: version,
      errorCode,
      payloadHash: hash,
      appliedAt: status === "APPLIED" ? new Date() : null,
    })
    .onConflictDoNothing();
}

async function dependenciesExist(userId: string, op: OpEnvelope): Promise<boolean> {
  for (const dep of op.dependsOn ?? []) {
    const [row] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, dep.entityId), eq(tasks.userId, userId)))
      .limit(1);
    if (!row) return false;
  }
  return true;
}

async function processOp(
  userId: string,
  deviceId: string,
  op: OpEnvelope,
  defaultPriority: () => Promise<"NONE" | "LOW" | "MEDIUM" | "HIGH">,
): Promise<PushResult> {
  const hash = payloadHash({ type: op.type, entityId: op.entityId, payload: op.payload });

  // A repeated op id: the stored answer again, and nothing changes.
  const [stored] = await db
    .select()
    .from(syncOperations)
    .where(and(eq(syncOperations.userId, userId), eq(syncOperations.opId, op.opId)))
    .limit(1);
  if (stored) {
    if (stored.payloadHash !== hash) {
      return outcome(op, "REJECTED", {
        errorCode: "VALIDATION_ERROR",
        message: "That operation id was already used for a different change.",
      });
    }
    const entity = await snapshotTaskById(userId, op.entityId);
    if (stored.status === "APPLIED") {
      return outcome(op, "DUPLICATE_IGNORED", { version: stored.resultVersion, entity });
    }
    return outcome(op, stored.status as Recorded, {
      version: stored.resultVersion,
      entity,
      errorCode: stored.errorCode,
    });
  }

  let parsed: ReturnType<typeof parseTaskPayload>;
  try {
    parsed = parseTaskPayload(op);
  } catch {
    await record(db, userId, deviceId, op, hash, "REJECTED", null, "VALIDATION_ERROR");
    return outcome(op, "REJECTED", {
      errorCode: "VALIDATION_ERROR",
      message: "That change isn't valid.",
    });
  }

  // A parent or a link the change needs may not have arrived yet. Nothing is stored, so a retry is fine.
  if (!(await dependenciesExist(userId, op))) {
    return outcome(op, "DEPENDENCY_MISSING", { errorCode: "DEPENDENCY_MISSING" });
  }

  try {
    if (parsed.kind === "create") {
      const priority = await defaultPriority();
      let version: number | null = null;
      // The task and its record are written together, so a retry cannot find one without the other.
      await db.transaction(async (tx) => {
        const created = await createTask(userId, parsed.values, { priority }, tx);
        const [row] = await tx
          .select({ version: tasks.version })
          .from(tasks)
          .where(eq(tasks.id, created.id));
        version = row?.version ?? null;
        await record(tx, userId, deviceId, op, hash, "APPLIED", version, null);
      });
    } else {
      // These mutations run in their own transactions. Each is safe to repeat (a completed task stays
      // completed, a title is set to the same title), so the record is written right after.
      if (parsed.kind === "update") await updateTask(userId, parsed.values);
      if (parsed.kind === "complete") {
        await completeTask(userId, op.entityId, new Date(), {
          nextOccurrenceId: parsed.values.nextOccurrenceId,
        });
      }
      if (parsed.kind === "reopen") await setTaskStatus(userId, op.entityId, "PLANNED");
      const current = await snapshotTaskById(userId, op.entityId);
      await record(db, userId, deviceId, op, hash, "APPLIED", current?.version ?? null, null);
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "CONFLICT") {
      await record(db, userId, deviceId, op, hash, "CONFLICT", null, "CONFLICT");
      return outcome(op, "CONFLICT", { errorCode: "CONFLICT", message: error.message });
    }
    if (
      error instanceof AppError &&
      (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")
    ) {
      await record(db, userId, deviceId, op, hash, "REJECTED", null, error.code);
      return outcome(op, "REJECTED", { errorCode: error.code, message: error.message });
    }
    // Anything else is not the change's fault. Nothing is stored, and the device tries again later.
    logger.error("sync push operation failed", { opId: op.opId, type: op.type, error });
    return outcome(op, "RETRY", { errorCode: "INTERNAL_ERROR" });
  }

  const entity = await snapshotTaskById(userId, op.entityId);
  return outcome(op, "APPLIED", { version: entity?.version ?? null, entity });
}

/** Applies a batch in order. A failing operation never stops the others. */
export async function processPush(userId: string, request: PushRequest): Promise<PushResult[]> {
  let priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | null = null;
  const defaultPriority = async () => {
    priority ??= (await getPreferences(userId)).defaultTaskPriority;
    return priority;
  };

  return withDevice(request.deviceId, async () => {
    const results: PushResult[] = [];
    for (const op of request.ops) {
      results.push(await processOp(userId, request.deviceId, op, defaultPriority));
    }
    return results;
  });
}
