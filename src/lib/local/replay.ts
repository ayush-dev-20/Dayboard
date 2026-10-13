import type { LocalDatabase, Operation } from "./db";

// Minimal replay until feature 05 (V2 feature 04 §7). Sends the queued changes, in the order they were
// made, through the existing Server Actions. One replay runs at a time (see `replayPending`).

export type ActionOutcome = { ok: true } | { ok: false; error: { code: string; message: string } };

/** The task actions the replay calls. Tests pass fakes; the app passes the real Server Actions. */
export type TaskActions = {
  createTask(input: unknown): Promise<ActionOutcome>;
  completeTask(input: unknown): Promise<ActionOutcome>;
  setTaskStatus(input: unknown): Promise<ActionOutcome>;
  updateTask(input: unknown): Promise<ActionOutcome>;
};

export type ReplayResult = {
  sent: number;
  failed: number;
  /** The connection dropped: the rest stays PENDING for the next try. */
  stoppedOffline: boolean;
};

let running: Promise<ReplayResult> | null = null;

/** Runs a replay now, or joins the one already running (so two calls never send twice). */
export function replayPending(db: LocalDatabase, actions: TaskActions): Promise<ReplayResult> {
  if (!running) {
    running = runReplay(db, actions).finally(() => {
      running = null;
    });
  }
  return running;
}

async function send(op: Operation, actions: TaskActions): Promise<ActionOutcome> {
  const id = op.entityId;
  switch (op.type) {
    case "task.create":
      return actions.createTask({ ...op.payload, id });
    case "task.update":
      return actions.updateTask({ ...op.payload, id });
    case "task.complete":
      return actions.completeTask({ ...op.payload, id });
    case "task.reopen":
      return actions.setTaskStatus({ id, status: "PLANNED" });
  }
}

async function runReplay(db: LocalDatabase, actions: TaskActions): Promise<ReplayResult> {
  // A send cut short by closing the page never got an answer: it goes back in the queue.
  await db.operations.where("status").equals("SENDING").modify({ status: "PENDING" });

  const queue = await db.operations.where("status").equals("PENDING").sortBy("seq");
  // An entity whose earlier change was refused: its later changes cannot apply either.
  const blocked = new Set<string>();
  let sent = 0;
  let failed = 0;

  for (const op of queue) {
    if (blocked.has(op.entityId)) {
      await db.operations.update(op.opId, {
        status: "FAILED",
        lastError: "An earlier change to this item couldn't be saved.",
      });
      failed += 1;
      continue;
    }

    await db.operations.update(op.opId, { status: "SENDING", attempts: op.attempts + 1 });
    let outcome: ActionOutcome;
    try {
      outcome = await send(op, actions);
    } catch {
      // A thrown error is the network failing: nothing reached the server, so try again later.
      await db.operations.update(op.opId, { status: "PENDING" });
      return { sent, failed, stoppedOffline: true };
    }

    // A create that the server already has (an earlier try got through and the answer was lost) is done.
    const alreadyThere =
      op.type === "task.create" && !outcome.ok && outcome.error.code === "CONFLICT";
    if (outcome.ok || alreadyThere) {
      // Acknowledged: the queue keeps only what still has to be sent (feature 05 adds history).
      await db.operations.delete(op.opId);
      sent += 1;
    } else {
      await db.operations.update(op.opId, {
        status: "FAILED",
        lastError: outcome.error.message,
      });
      blocked.add(op.entityId);
      failed += 1;
    }
  }

  return { sent, failed, stoppedOffline: false };
}
