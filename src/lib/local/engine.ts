import type { SnapshotTask } from "@/lib/sync/snapshot";
import type { LocalDatabase, Operation, OperationStatus } from "./db";

// The sync engine on the device (V2 feature 05 §3 and §7): pushes the queue in batches, applies each result,
// then pulls the changes made elsewhere. One run at a time, in this tab and in others (Web Locks).

export const MAX_OPS_PER_BATCH = 50;
export const MAX_BATCH_BYTES = 900 * 1024;
export const MAX_ATTEMPTS = 10;
/** A pull re-reads this many log positions behind the stored cursor (see the overlap in ADR 0007). */
export const PULL_OVERLAP = 200;
const PULL_PAGE = 500;
const MAX_PULL_PAGES = 1000;

export type WireOperation = {
  opId: string;
  entityType: "task";
  entityId: string;
  type: Operation["type"];
  clientTimestamp: string;
  baseVersion: number | null;
  payload: Record<string, unknown>;
  dependsOn?: { entityType: "task"; entityId: string }[];
};

export type PushOutcome = {
  opId: string;
  status:
    "APPLIED" | "DUPLICATE_IGNORED" | "REJECTED" | "CONFLICT" | "DEPENDENCY_MISSING" | "RETRY";
  version: number | null;
  entity: SnapshotTask | null;
  errorCode: string | null;
  message: string | null;
};

export type PullChange = {
  entityType: "task";
  entityId: string;
  op: "UPSERT" | "DELETE";
  version: number;
  entity?: SnapshotTask;
};

export type PullPage =
  | { snapshotRequired: false; changes: PullChange[]; nextCursor: number; hasMore: boolean }
  /** The log was pruned past this device's cursor: take a snapshot, then continue from `headCursor`. */
  | { snapshotRequired: true; headCursor: number };

/** The network. `push` and `pull` throw when the request does not get an answer. */
export type Transport = {
  push(body: {
    deviceId: string;
    appVersion: string;
    ops: WireOperation[];
  }): Promise<{ results: PushOutcome[] }>;
  pull(cursor: number, limit: number): Promise<PullPage>;
};

export type EngineDeps = {
  db: LocalDatabase;
  deviceId: string;
  appVersion: string;
  transport: Transport;
  /** Fills the local tasks from the snapshot. Needed only when the server asks for a fresh one. */
  snapshot?: () => Promise<unknown>;
};

export type SyncReport = {
  sent: number;
  /** Operations refused for good, or waiting for a retry. */
  failed: number;
  pulled: number;
  /** The network did not answer. Nothing was lost; the rest waits for the next run. */
  stoppedOffline: boolean;
};

const BLOCKED_MESSAGE = "An earlier change to this item couldn't be saved.";

/** Seconds to wait before the next try after `failures` failed runs in a row: 2, 4, 8 … 30, ±20%. */
export function backoffDelayMs(failures: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 2_000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (1 + (random() * 0.4 - 0.2)));
}

function toWire(op: Operation): WireOperation {
  const parent = op.type === "task.create" ? op.payload.parentTaskId : null;
  return {
    opId: op.opId,
    entityType: "task",
    entityId: op.entityId,
    type: op.type,
    clientTimestamp: op.clientTimestamp,
    baseVersion: null,
    payload: op.payload,
    ...(typeof parent === "string"
      ? { dependsOn: [{ entityType: "task" as const, entityId: parent }] }
      : {}),
  };
}

/** Runs `work` alone: across tabs when Web Locks exist, otherwise within this page. */
let local: Promise<unknown> = Promise.resolve();
export function exclusive<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("dayboard-sync", work) as Promise<T>;
  }
  const next = local.then(work, work);
  local = next.catch(() => undefined);
  return next;
}

/** Puts a server row in the local table, unless a change to the same task is still waiting. */
async function keepIfNewer(db: LocalDatabase, entity: SnapshotTask): Promise<void> {
  await db.transaction("rw", db.tasks, db.operations, async () => {
    const waiting = await db.operations
      .where("[entityType+entityId]")
      .equals(["task", entity.id])
      .count();
    if (waiting > 0) return;
    const local = await db.tasks.get(entity.id);
    if (!local || local.version <= entity.version) await db.tasks.put(entity);
  });
}

async function setStatus(
  db: LocalDatabase,
  opId: string,
  status: OperationStatus,
  lastError: string | null,
) {
  await db.operations.update(opId, { status, lastError });
}

/** Sends the queue. Returns how many went through, how many are refused or waiting, and whether it got through at all. */
export async function pushQueue(deps: EngineDeps): Promise<Omit<SyncReport, "pulled">> {
  const { db } = deps;
  // A send cut short by closing the page never got an answer: it goes back in the queue.
  await db.operations.where("status").equals("SENDING").modify({ status: "PENDING" });

  let sent = 0;
  let failed = 0;
  // Entities with a retryable problem in this run: their later changes wait for the next run.
  const held = new Set<string>();

  for (;;) {
    const queue = await db.operations.where("status").equals("PENDING").sortBy("seq");
    const refused = new Set(
      (await db.operations.where("status").anyOf(["FAILED", "CONFLICT"]).toArray()).map(
        (op) => op.entityId,
      ),
    );

    const batch: Operation[] = [];
    const inBatch = new Set<string>();
    let bytes = 0;
    for (const op of queue) {
      if (held.has(op.entityId)) continue;
      // An earlier change to this item was refused, so this one cannot apply either.
      if (refused.has(op.entityId)) {
        await setStatus(db, op.opId, "FAILED", BLOCKED_MESSAGE);
        failed += 1;
        continue;
      }
      // One change per item per batch: the next one goes in the next batch, after this one is answered.
      if (inBatch.has(op.entityId)) continue;
      const size = JSON.stringify(toWire(op)).length;
      if (batch.length >= MAX_OPS_PER_BATCH || (batch.length > 0 && bytes + size > MAX_BATCH_BYTES))
        break;
      batch.push(op);
      inBatch.add(op.entityId);
      bytes += size;
    }
    if (batch.length === 0) break;

    for (const op of batch) await db.operations.update(op.opId, { status: "SENDING" });

    let response: { results: PushOutcome[] };
    try {
      response = await deps.transport.push({
        deviceId: deps.deviceId,
        appVersion: deps.appVersion,
        ops: batch.map(toWire),
      });
    } catch {
      for (const op of batch) await db.operations.update(op.opId, { status: "PENDING" });
      return { sent, failed, stoppedOffline: true };
    }

    const answers = new Map(response.results.map((result) => [result.opId, result]));
    for (const op of batch) {
      const result = answers.get(op.opId);
      if (!result) {
        // No answer for this one: try it again later, and keep the others of this item waiting.
        await retryLater(db, op, held);
        failed += 1;
        continue;
      }

      if (result.status === "APPLIED" || result.status === "DUPLICATE_IGNORED") {
        await db.operations.delete(op.opId);
        sent += 1;
        if (result.entity) await keepIfNewer(db, result.entity);
      } else if (result.status === "REJECTED" || result.status === "CONFLICT") {
        await setStatus(
          db,
          op.opId,
          "FAILED",
          result.message ?? result.errorCode ?? "Couldn't be saved.",
        );
        failed += 1;
      } else {
        // DEPENDENCY_MISSING or RETRY: the server is not refusing the change, so it waits and tries again.
        await retryLater(db, op, held);
        failed += 1;
      }
    }
  }

  return { sent, failed, stoppedOffline: false };
}

async function retryLater(db: LocalDatabase, op: Operation, held: Set<string>) {
  held.add(op.entityId);
  const attempts = op.attempts + 1;
  await db.operations.update(op.opId, {
    status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
    attempts,
    lastError: attempts >= MAX_ATTEMPTS ? "Still couldn't be saved after several tries." : null,
  });
}

/** Applies the changes made elsewhere. Rows with a change of ours waiting are left as they are. */
async function applyPulled(db: LocalDatabase, changes: PullChange[]): Promise<number> {
  let applied = 0;
  await db.transaction("rw", db.tasks, db.operations, async () => {
    for (const change of changes) {
      const waiting = await db.operations
        .where("[entityType+entityId]")
        .equals(["task", change.entityId])
        .count();
      if (waiting > 0) continue;
      if (change.op === "DELETE") {
        await db.tasks.delete(change.entityId);
        applied += 1;
        continue;
      }
      if (!change.entity) continue;
      const local = await db.tasks.get(change.entityId);
      // Only a newer version replaces the local copy; the same or an older one is ignored (the overlap).
      if (local && local.version >= change.entity.version) continue;
      await db.tasks.put(change.entity);
      applied += 1;
    }
  });
  return applied;
}

/** Reads what changed elsewhere since the stored cursor, then stores the cursor. */
export async function pullChanges(deps: EngineDeps): Promise<number> {
  const { db } = deps;
  const stored = ((await db.meta.get("lastPullCursor"))?.value as number | undefined) ?? 0;
  let from = Math.max(0, stored - PULL_OVERLAP);
  let applied = 0;
  let position = stored;

  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const result = await deps.transport.pull(from, PULL_PAGE);
    if (result.snapshotRequired) {
      // The changes this device missed were pruned. A snapshot brings every row up to date instead.
      if (!deps.snapshot) throw new Error("A snapshot is needed, and this device cannot take one.");
      await deps.snapshot();
      await db.meta.put({ key: "lastPullCursor", value: result.headCursor });
      return applied;
    }
    applied += await applyPulled(db, result.changes);
    from = result.nextCursor;
    // The stored cursor only moves forward: a re-read behind it must not move it back.
    position = Math.max(position, result.nextCursor);
    await db.meta.put({ key: "lastPullCursor", value: position });
    if (!result.hasMore) break;
  }
  return applied;
}

/** One full run: push what is waiting, then pull. Exclusive across tabs. */
export function runSync(deps: EngineDeps): Promise<SyncReport> {
  return exclusive(async () => {
    const pushed = await pushQueue(deps);
    if (pushed.stoppedOffline) return { ...pushed, pulled: 0 };
    try {
      return { ...pushed, pulled: await pullChanges(deps), stoppedOffline: false };
    } catch {
      return { ...pushed, pulled: 0, stoppedOffline: true };
    }
  });
}
