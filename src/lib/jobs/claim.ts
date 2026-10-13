import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs, type Job } from "@/db/schema";
import { LOCK_MS } from "./retry";
import type { QueueName } from "./types";

// Claiming (V2 feature 08 §3). One statement picks jobs and locks them, and SKIP LOCKED means two workers never
// take the same job. Jobs waiting to retry (FAILED) are eligible like new ones once their time has come.

export async function claimJobs(
  workerId: string,
  queues: readonly QueueName[],
  limit: number,
): Promise<Job[]> {
  if (limit < 1 || queues.length === 0) return [];
  const due = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ["QUEUED", "FAILED"]),
        lte(jobs.runAt, new Date()),
        inArray(jobs.queue, [...queues]),
      ),
    )
    .orderBy(asc(jobs.runAt))
    .limit(limit)
    .for("update", { skipLocked: true });

  return db
    .update(jobs)
    .set({
      status: "RUNNING",
      lockedBy: workerId,
      lockedUntil: new Date(Date.now() + LOCK_MS),
      attempts: sql`${jobs.attempts} + 1`,
      startedAt: new Date(),
    })
    .where(inArray(jobs.id, due))
    .returning();
}

/** Lets a worker that is still busy keep its job (the handler called `extendLock`). */
export async function extendLock(workerId: string, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ lockedUntil: new Date(Date.now() + LOCK_MS) })
    .where(and(eq(jobs.id, jobId), eq(jobs.lockedBy, workerId), eq(jobs.status, "RUNNING")));
}

/**
 * Jobs whose worker stopped before finishing (its lock ran out) go back to waiting, counting the attempt.
 * A job that has no attempts left is DEAD. Any worker may run this; it is idempotent.
 */
export async function reapStaleLocks(): Promise<number> {
  const now = new Date();
  const reaped = await db
    .update(jobs)
    .set({
      status: sql`case when ${jobs.attempts} >= ${jobs.maxAttempts} then 'DEAD' else 'FAILED' end`,
      lockedBy: null,
      lockedUntil: null,
      runAt: now,
      lastError: "Interrupted: the worker stopped before it finished.",
      finishedAt: sql`case when ${jobs.attempts} >= ${jobs.maxAttempts} then now() else null end`,
    })
    .where(and(eq(jobs.status, "RUNNING"), sql`${jobs.lockedUntil} < now()`))
    .returning({ id: jobs.id });
  return reaped.length;
}

export async function countDue(queues: readonly QueueName[]): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ["QUEUED", "FAILED"]),
        lte(jobs.runAt, new Date()),
        inArray(jobs.queue, [...queues]),
      ),
    );
  return row?.n ?? 0;
}
