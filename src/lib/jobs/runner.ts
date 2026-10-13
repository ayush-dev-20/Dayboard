import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs, type Job } from "@/db/schema";
import { logger } from "@/lib/logger";
import { extendLock } from "./claim";
import { findHandler } from "./registry";
import { backoffMs, redactError } from "./retry";
import { PermanentError, RetryAfter, type JobContext, type QueueName } from "./types";

// Runs one claimed job (V2 feature 08 §3). The same function serves the worker process and tick mode.
// Every write is guarded by the worker's id, so a job that was reclaimed while this worker was stalled is
// never overwritten by the stalled worker's late answer.

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type RunOutcome = "SUCCEEDED" | "FAILED" | "DEAD" | "INTERRUPTED" | "LOST";

async function finish(
  workerId: string,
  job: Job,
  values: Partial<typeof jobs.$inferInsert>,
): Promise<boolean> {
  const updated = await db
    .update(jobs)
    .set({ ...values, lockedBy: null, lockedUntil: null })
    .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId), eq(jobs.status, "RUNNING")))
    .returning({ id: jobs.id });
  return updated.length > 0;
}

function describe(job: Job, extra: Record<string, unknown> = {}) {
  return {
    jobId: job.id,
    type: job.type,
    queue: job.queue,
    userId: job.userId,
    correlationId: job.correlationId,
    attempt: job.attempts,
    ...extra,
  };
}

/**
 * Runs the handler for a claimed job and records the outcome. `parent` lets the worker stop a job at
 * shutdown; the job then goes back to waiting.
 */
export async function runClaimed(
  workerId: string,
  job: Job,
  parent?: AbortSignal,
): Promise<RunOutcome> {
  const started = Date.now();
  const handler = findHandler(job.type);
  if (!handler) {
    // A newer release queued a type this worker does not know. It must not stop the loop.
    await finish(workerId, job, {
      status: "DEAD",
      finishedAt: new Date(),
      lastError: `No handler for job type ${job.type} in this release.`,
    });
    logger.warn("job has no handler", describe(job, { errorCode: "UNKNOWN_TYPE" }));
    return "DEAD";
  }

  const parsed = handler.schema.safeParse(job.payload);
  if (!parsed.success) {
    await finish(workerId, job, {
      status: "DEAD",
      finishedAt: new Date(),
      lastError: "The job's details didn't match what this release expects.",
    });
    logger.warn("job payload refused", describe(job, { errorCode: "BAD_PAYLOAD" }));
    return "DEAD";
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort);
  const timer = setTimeout(abort, handler.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const context: JobContext = {
    id: job.id,
    type: job.type,
    queue: job.queue as QueueName,
    attempt: job.attempts,
    userId: job.userId,
    correlationId: job.correlationId,
    signal: controller.signal,
    log: (message, extra) => logger.info(message, describe(job, extra)),
    extendLock: () => extendLock(workerId, job.id),
  };

  try {
    await handler.run(context, parsed.data);
    const kept = await finish(workerId, job, {
      status: "SUCCEEDED",
      finishedAt: new Date(),
      lastError: null,
    });
    logger.info("job succeeded", describe(job, { durationMs: Date.now() - started }));
    return kept ? "SUCCEEDED" : "LOST";
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = redactError(error);

    if (parent?.aborted) {
      // Shutdown: back to waiting now, so another worker takes it at once.
      await finish(workerId, job, {
        status: "FAILED",
        runAt: new Date(),
        lastError: "Interrupted: the worker was shutting down.",
      });
      logger.info("job interrupted at shutdown", describe(job, { durationMs }));
      return "INTERRUPTED";
    }

    const permanent = error instanceof PermanentError;
    const exhausted = job.attempts >= job.maxAttempts;
    if (permanent || exhausted) {
      const kept = await finish(workerId, job, {
        status: "DEAD",
        finishedAt: new Date(),
        lastError: message,
      });
      logger.warn(
        "job is dead",
        describe(job, { durationMs, errorCode: permanent ? "PERMANENT" : "EXHAUSTED" }),
      );
      return kept ? "DEAD" : "LOST";
    }

    const delay = error instanceof RetryAfter ? error.delayMs : backoffMs(job.attempts);
    const kept = await finish(workerId, job, {
      status: "FAILED",
      runAt: new Date(Date.now() + delay),
      lastError: message,
    });
    logger.warn(
      "job failed, will retry",
      describe(job, { durationMs, retryInMs: delay, errorCode: "RETRY" }),
    );
    return kept ? "FAILED" : "LOST";
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}
