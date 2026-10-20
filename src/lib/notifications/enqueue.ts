import "server-only";
import type { Executor } from "@/db/executor";
import { enqueue } from "@/lib/jobs/enqueue";
import type { NotificationCategory } from "./categories";

// How another feature asks for a notification (V2 feature 14 §4): the weekly review when one is ready, sync when
// changes could not be saved. It only queues a delivery job; whether anything is sent (the category, quiet hours,
// whether there is a device) is decided there. The same `dedupeKey` never notifies twice.

export async function enqueueNotification(
  executor: Executor,
  input: {
    userId: string;
    category: Exclude<NotificationCategory, "TASK_REMINDER" | "CALENDAR_REMINDER">;
    /** What makes it once: `review:<id>`, `sync-failure:<date>`. */
    dedupeKey: string;
    reviewId?: string;
  },
): Promise<string> {
  return enqueue(executor, {
    type: "notification.deliver",
    payload: {
      category: input.category,
      dedupeKey: input.dedupeKey,
      ...(input.reviewId ? { reviewId: input.reviewId } : {}),
    },
    userId: input.userId,
    queue: "notifications",
    maxAttempts: 5,
    dedupeKey: input.dedupeKey,
  });
}
