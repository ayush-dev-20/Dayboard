import "server-only";
import { and, asc, eq, gt, gte, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks } from "@/db/schema";
import { getPreferences } from "@/lib/preferences";
import {
  TOMBSTONE_DAYS,
  type SnapshotPage,
  type SnapshotPreferences,
  type SnapshotTask,
} from "@/lib/sync/snapshot";

const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * One page of the person's tasks, by id, for the offline bootstrap. Owner-scoped. Subtasks are
 * included (completing a repeating task needs them). Deleted tasks are included for the last 30 days.
 */
export async function snapshotTasks(
  userId: string,
  options: { cursor: string | null; limit: number; now?: Date },
): Promise<SnapshotPage<SnapshotTask>> {
  const since = new Date((options.now ?? new Date()).getTime() - TOMBSTONE_DAYS * DAY_MS);
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        or(isNull(tasks.deletedAt), gte(tasks.deletedAt, since)),
        options.cursor ? gt(tasks.id, options.cursor) : undefined,
      ),
    )
    .orderBy(asc(tasks.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  return {
    rows: page.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      parentTaskId: row.parentTaskId,
      title: row.title,
      emoji: row.emoji,
      status: row.status,
      priority: row.priority,
      dueDate: row.dueDate,
      dueTime: row.dueTime,
      startDate: row.startDate,
      startTime: row.startTime,
      recurrenceRule: row.recurrenceRule,
      recurrenceParentId: row.recurrenceParentId,
      sortOrder: row.sortOrder,
      completedAt: iso(row.completedAt),
      archivedAt: iso(row.archivedAt),
      deletedAt: iso(row.deletedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    nextCursor: rows.length > options.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

/** The preferences the offline app needs (the default priority for new tasks, the time zone). */
export async function snapshotPreferences(
  userId: string,
): Promise<SnapshotPage<SnapshotPreferences>> {
  const prefs = await getPreferences(userId);
  return {
    rows: [
      {
        defaultTaskPriority: prefs.defaultTaskPriority,
        timezone: prefs.timezone,
        startOfDay: prefs.startOfDay.slice(0, 5),
      },
    ],
    nextCursor: null,
  };
}
