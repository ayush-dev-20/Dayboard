import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs, type Job } from "@/db/schema";
import { LOCK_MS } from "./retry";
import type { QueueName } from "./types";

// Claiming (V2 feature 08 §3). One statement picks jobs and locks them, and SKIP LOCKED means two workers never
// take the same job. Jobs waiting to retry (FAILED) are eligible like new ones once their time has come.

/**
 * A job waiting to retry whose dedupe key is now held by a QUEUED or RUNNING job. The unique index covers only those two
 * statuses, so claiming such a job would violate it, and because the oldest job is always claimed first, one of them
 * made every claim fail and stopped the whole queue. It is skipped here and cancelled by `reapStaleLocks`.
 */
const superseded = sql`(${jobs.status} = 'FAILED' and ${jobs.dedupeKey} is not null and exists (
  select 1 from jobs twin where twin.dedupe_key = ${jobs.dedupeKey} and twin.status in ('QUEUED', 'RUNNING')))`;

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
        sql`not ${superseded}`,
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
  // Jobs that were waiting to retry but have been replaced by a newer job for the same work are not retried.
  await db
    .update(jobs)
    .set({
      status: "CANCELLED",
      lastError: "Superseded by a newer job with the same key.",
      finishedAt: now,
    })
    .where(superseded);
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
