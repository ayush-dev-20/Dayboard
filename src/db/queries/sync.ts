import "server-only";
import { and, asc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { changeLog, syncRetention, tasks, type Task } from "@/db/schema";
import { getPreferences } from "@/lib/preferences";
import {
  TOMBSTONE_DAYS,
  type SnapshotPage,
  type SnapshotPreferences,
  type SnapshotTask,
} from "@/lib/sync/snapshot";

const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** A task row as the device stores it. Used by the snapshot, the pull and the push results. */
export function toSnapshotTask(row: Task): SnapshotTask {
  return {
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
    version: row.version,
  };
}

/** One of the person's tasks, or null (another person's, or none). */
export async function snapshotTaskById(userId: string, id: string): Promise<SnapshotTask | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
    .limit(1);
  return row ? toSnapshotTask(row) : null;
}

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
    rows: page.map(toSnapshotTask),
    nextCursor: rows.length > options.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * The changes after `cursor` (a change-log position), newest per entity, with each entity read fresh.
 * An entity whose row is gone (permanently deleted) comes back as a DELETE.
 */
export async function pullTaskChanges(
  userId: string,
  options: { cursor: number; limit: number },
): Promise<
  | {
      snapshotRequired: false;
      changes: {
        entityType: "task";
        entityId: string;
        op: "UPSERT" | "DELETE";
        version: number;
        entity?: SnapshotTask;
      }[];
      nextCursor: number;
      hasMore: boolean;
    }
  | { snapshotRequired: true; headCursor: number }
> {
  // Rows at or below the retention floor were pruned (feature 08). A cursor below it may have missed
  // changes, so the device takes a fresh snapshot instead.
  const [retention] = await db
    .select({ value: syncRetention.value })
    .from(syncRetention)
    .where(eq(syncRetention.key, "change_log"));
  const floor = retention?.value ?? 0;
  if (options.cursor < floor) {
    const [head] = await db
      .select({ head: sql<number>`coalesce(max(${changeLog.seq}), 0)::bigint` })
      .from(changeLog);
    return { snapshotRequired: true, headCursor: Number(head?.head ?? 0) };
  }

  const log = await db
    .select({
      seq: changeLog.seq,
      entityId: changeLog.entityId,
      op: changeLog.op,
      version: changeLog.version,
    })
    .from(changeLog)
    .where(and(eq(changeLog.userId, userId), gt(changeLog.seq, options.cursor)))
    .orderBy(asc(changeLog.seq))
    .limit(options.limit + 1);

  const page = log.slice(0, options.limit);
  // Keep the last change for each entity, in the order those last changes happened.
  const latest = new Map<string, (typeof page)[number]>();
  for (const row of page) {
    latest.delete(row.entityId);
    latest.set(row.entityId, row);
  }

  const ids = [...latest.keys()];
  const current = ids.length
    ? await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)))
    : [];
  const byId = new Map(current.map((row) => [row.id, toSnapshotTask(row)]));

  const changes = [...latest.values()].map((row) => {
    const entity = byId.get(row.entityId);
    if (!entity) {
      return {
        entityType: "task" as const,
        entityId: row.entityId,
        op: "DELETE" as const,
        version: row.version,
      };
    }
    return {
      entityType: "task" as const,
      entityId: row.entityId,
      op: "UPSERT" as const,
      version: entity.version,
      entity,
    };
  });

  return {
    snapshotRequired: false,
    changes,
    nextCursor: page.at(-1)?.seq ?? options.cursor,
    hasMore: log.length > options.limit,
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
