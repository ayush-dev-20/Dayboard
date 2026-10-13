import "server-only";
import { and, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  changeLog,
  jobSchedules,
  jobs,
  syncOperations,
  syncRetention,
  workerHeartbeats,
} from "@/db/schema";
import { enqueue } from "./enqueue";
import { advancePast, parseCadence } from "./schedule";
import { logger } from "@/lib/logger";
import { QUEUES, type QueueName } from "./types";
import { claimJobs, countDue, reapStaleLocks } from "./claim";
import { runClaimed } from "./runner";

// Heartbeats, the scheduler and tick mode (V2 feature 08 §2–4). Each piece is safe with several workers.

const DAY_MS = 24 * 60 * 60 * 1000;

export type Heartbeat = {
  workerId: string;
  version: string;
  queues: string[];
  hostname: string;
  currentJobId: string | null;
};

export async function beat(info: Heartbeat): Promise<void> {
  const now = new Date();
  await db
    .insert(workerHeartbeats)
    .values({ ...info, startedAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: workerHeartbeats.workerId,
      set: { lastSeenAt: now, currentJobId: info.currentJobId, queues: info.queues },
    });
}

export async function retireHeartbeat(workerId: string): Promise<void> {
  await db.delete(workerHeartbeats).where(eq(workerHeartbeats.workerId, workerId));
}

/**
 * Enqueues every schedule that is due, once per time slot. Two workers that both see a schedule due
 * enqueue the same key, so only one job exists for that slot.
 */
export async function fireDueSchedules(now: Date = new Date(), limit = 20): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(jobSchedules)
      .where(and(eq(jobSchedules.enabled, true), lte(jobSchedules.nextRunAt, now)))
      .orderBy(jobSchedules.nextRunAt)
      .limit(limit)
      .for("update", { skipLocked: true });

    let fired = 0;
    for (const schedule of due) {
      let cadence;
      try {
        cadence = parseCadence(schedule.cron);
      } catch {
        logger.error("schedule has an invalid cadence", { schedule: schedule.name });
        continue;
      }
      const slot = schedule.nextRunAt;
      await enqueue(tx, {
        type: schedule.type,
        payload: schedule.payload,
        queue: schedule.queue as QueueName,
        runAt: now,
        dedupeKey: `${schedule.name}@${slot.toISOString()}`,
      });
      await tx
        .update(jobSchedules)
        .set({ lastRunAt: now, nextRunAt: advancePast(cadence, slot, now) })
        .where(eq(jobSchedules.name, schedule.name));
      fired += 1;
    }
    return fired;
  });
}

export type TickResult = { ran: number; remaining: number };

/**
 * Tick mode (docs/decisions/0009): the scheduler, the reaper, then as many jobs as fit in the time budget,
 * using the same claim and runner as the worker process.
 */
export async function runTick(options: {
  budgetMs: number;
  now?: () => number;
}): Promise<TickResult> {
  const clock = options.now ?? Date.now;
  const deadline = clock() + options.budgetMs;
  const workerId = `tick-${crypto.randomUUID()}`;

  await fireDueSchedules();
  await reapStaleLocks();

  let ran = 0;
  while (clock() < deadline) {
    const [job] = await claimJobs(workerId, QUEUES, 1);
    if (!job) break;
    await runClaimed(workerId, job);
    ran += 1;
  }
  return { ran, remaining: await countDue(QUEUES) };
}

/** Health (informational): the freshest heartbeat. Never changes the HTTP status. */
export async function workerStatus(now: Date = new Date()): Promise<"ok" | "stale" | "none"> {
  const [row] = await db
    .select({ seen: sql<Date | null>`max(${workerHeartbeats.lastSeenAt})` })
    .from(workerHeartbeats);
  if (!row?.seen) return "none";
  return now.getTime() - new Date(row.seen).getTime() <= 30_000 ? "ok" : "stale";
}

/** Counts for the logs and Settings: depth by queue and status, oldest waiting job, failures and dead by type. */
export async function getQueueStats(now: Date = new Date()) {
  const depth = await db
    .select({ queue: jobs.queue, status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.queue, jobs.status);
  const [oldest] = await db
    .select({ at: sql<Date | null>`min(${jobs.runAt})` })
    .from(jobs)
    .where(inArray(jobs.status, ["QUEUED", "FAILED"]));
  const failures = await db
    .select({ type: jobs.type, status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ["FAILED", "DEAD"]),
        gt(jobs.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    )
    .groupBy(jobs.type, jobs.status);
  return {
    depth,
    oldestWaitingMs: oldest?.at ? now.getTime() - new Date(oldest.at).getTime() : null,
    failures,
  };
}

// ---- maintenance jobs (feature 08 §5) ----

export async function pruneJobs(
  now: Date = new Date(),
): Promise<{ succeeded: number; dead: number; heartbeats: number }> {
  const succeeded = await db
    .delete(jobs)
    .where(
      and(eq(jobs.status, "SUCCEEDED"), lt(jobs.finishedAt, new Date(now.getTime() - 7 * DAY_MS))),
    )
    .returning({ id: jobs.id });
  const dead = await db
    .delete(jobs)
    .where(and(eq(jobs.status, "DEAD"), lt(jobs.finishedAt, new Date(now.getTime() - 14 * DAY_MS))))
    .returning({ id: jobs.id });
  const beats = await db
    .delete(workerHeartbeats)
    .where(lt(workerHeartbeats.lastSeenAt, new Date(now.getTime() - DAY_MS)))
    .returning({ id: workerHeartbeats.workerId });
  return { succeeded: succeeded.length, dead: dead.length, heartbeats: beats.length };
}

/**
 * Prunes the sync log after 30 days, and records how far it went (`sync_retention`), so a device that falls
 * behind takes a snapshot instead of silently missing deletions (ADR 0007).
 */
export async function pruneSync(
  now: Date = new Date(),
): Promise<{ changes: number; operations: number }> {
  const cutoff = new Date(now.getTime() - 30 * DAY_MS);
  return db.transaction(async (tx) => {
    // Only rows older than the cutoff go. The floor is the highest position removed: a device whose cursor is
    // below it may have missed a removed change, so it takes a snapshot. Newer rows are never touched.
    const removed = await tx
      .delete(changeLog)
      .where(lt(changeLog.changedAt, cutoff))
      .returning({ seq: changeLog.seq });
    const changes = removed.length;
    if (changes > 0) {
      const floor = Math.max(...removed.map((row) => Number(row.seq)));
      await tx
        .insert(syncRetention)
        .values({ key: "change_log", value: floor })
        .onConflictDoUpdate({
          target: syncRetention.key,
          set: { value: sql`greatest(${syncRetention.value}, ${floor})` },
        });
    }
    const operations = await tx
      .delete(syncOperations)
      .where(lt(syncOperations.receivedAt, cutoff))
      .returning({ id: syncOperations.opId });
    return { changes, operations: operations.length };
  });
}
