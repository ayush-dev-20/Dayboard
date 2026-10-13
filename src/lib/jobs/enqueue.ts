import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db/executor";
import { jobs } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import type { QueueName } from "./types";
import { QUEUES } from "./types";

// Adding a job (V2 feature 08 §3). Pass the transaction of the write that needs the job: a rolled-back write
// then leaves no job behind. Payloads are small and hold ids and parameters only.

export const MAX_PAYLOAD_BYTES = 4096;

export type EnqueueInput = {
  type: string;
  payload: Record<string, unknown>;
  payloadVersion?: number;
  /** Set for per-person jobs. Handlers take ownership from this, not from the payload. */
  userId?: string | null;
  queue?: QueueName;
  runAt?: Date;
  /** At most one job that has not finished may hold a key. A repeat returns the existing job's id. */
  dedupeKey?: string | null;
  maxAttempts?: number;
  correlationId?: string | null;
};

export async function enqueue(executor: Executor, input: EnqueueInput): Promise<string> {
  const payloadJson = JSON.stringify(input.payload);
  if (payloadJson.length > MAX_PAYLOAD_BYTES) {
    throw new AppError("VALIDATION_ERROR", "That job's details are too large.");
  }
  const queue = input.queue ?? "default";
  if (!QUEUES.includes(queue)) throw new AppError("VALIDATION_ERROR", `Unknown queue ${queue}.`);

  const id = uuidv7();
  const inserted = await executor
    .insert(jobs)
    .values({
      id,
      queue,
      type: input.type,
      payload: input.payload,
      payloadVersion: input.payloadVersion ?? 1,
      userId: input.userId ?? null,
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
      dedupeKey: input.dedupeKey ?? null,
      correlationId: input.correlationId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });

  if (inserted[0]) return inserted[0].id;

  // The dedupe key is already held by a job that has not finished: that job is the answer.
  const [existing] = await executor
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.dedupeKey, input.dedupeKey ?? ""),
        inArray(jobs.status, ["QUEUED", "RUNNING", "FAILED"]),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  throw new AppError("INTERNAL_ERROR");
}
