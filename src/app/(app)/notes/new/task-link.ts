import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks } from "@/db/schema";

/** True only for a task that belongs to this person (never reveals whether another's exists). */
export async function isLinkableTask(userId: string, taskId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .limit(1);
  return Boolean(row);
}
