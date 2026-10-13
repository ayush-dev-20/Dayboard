import type { z } from "zod";

// Shared job types (V2 feature 08). Pure: no database, so the worker, tick mode and tests share them.

export const QUEUES = ["default", "ai", "notifications"] as const;
export type QueueName = (typeof QUEUES)[number];

/** The handler will never succeed with this payload or in this state: go straight to DEAD. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

/** Try again after exactly this delay (for example, a provider's "retry after"), not the default backoff. */
export class RetryAfter extends Error {
  constructor(
    readonly delayMs: number,
    message = "Try again later",
  ) {
    super(message);
    this.name = "RetryAfter";
  }
}

export type JobContext = {
  id: string;
  type: string;
  queue: QueueName;
  /** The attempt number, starting at 1. */
  attempt: number;
  /** Set for per-person jobs. A handler re-checks ownership from this, never from the payload. */
  userId: string | null;
  correlationId: string | null;
  /** Aborted at shutdown or when the job runs past its time limit. */
  signal: AbortSignal;
  log(message: string, context?: Record<string, unknown>): void;
  /** Long handlers call this so the job is not reclaimed while it is still working. */
  extendLock(): Promise<void>;
};

export type JobHandler<P = unknown> = {
  type: string;
  queue: QueueName;
  /** Validates the payload before `run`. Payload versions are handled here (rollback rule). */
  schema: z.ZodType<P>;
  /** Default 5 minutes. */
  timeoutMs?: number;
  run(ctx: JobContext, payload: P): Promise<unknown>;
};
