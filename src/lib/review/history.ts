import "server-only";
import type { Executor } from "@/db/executor";
import { taskScheduleHistory, type ScheduleReason } from "@/db/schema";

// The log of due-date changes (V2 feature 15 §2). Written by the one task update path, inside its transaction, so
// online edits and offline changes replayed through the sync push are both recorded, and nothing is written when
// the date did not change. It starts when the feature ships; there is no backfill.

/** A postponement is a move to a later date from a date that was set. */
export const isPostponement = (from: string | null, to: string | null): boolean =>
  from !== null && to !== null && to > from;

export async function recordScheduleChange(
  executor: Executor,
  change: {
    userId: string;
    taskId: string;
    from: string | null;
    to: string | null;
    reason?: ScheduleReason;
  },
): Promise<boolean> {
  if (change.from === change.to) return false;
  await executor.insert(taskScheduleHistory).values({
    userId: change.userId,
    taskId: change.taskId,
    fromDate: change.from,
    toDate: change.to,
    reason: change.reason ?? "MANUAL",
  });
  return true;
}
