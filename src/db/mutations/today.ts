import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks, userPreferences } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { OPEN_STATUSES } from "@/lib/tasks/status";

export async function setFocusTask(userId: string, taskId: string | null): Promise<void> {
  if (taskId) {
    // Only an open task of the person's own can be the focus. Anything else is just "not found".
    const [row] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
          isNull(tasks.parentTaskId),
          inArray(tasks.status, [...OPEN_STATUSES]),
        ),
      )
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND");
  }
  await db
    .update(userPreferences)
    .set({ focusTaskId: taskId })
    .where(eq(userPreferences.userId, userId));
}
