import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks } from "@/db/schema";
import { toTaskDTO, type TaskDetailDTO, type TaskDTO } from "@/lib/tasks/dto";
import { OPEN_STATUSES, type TaskStatus } from "@/lib/tasks/status";

// Subtask counts come from correlated subqueries, so the whole list is one query (no N+1).
// The outer table is written as "tasks"."id" on purpose: in a single-table query Drizzle prints
// `${tasks.id}` as a bare "id", which inside the subquery would silently mean the subtask's own id.
const subtaskTotal = sql<number>`(select count(*)::int from tasks s where s.parent_task_id = "tasks"."id" and s.deleted_at is null)`;
const subtaskDone = sql<number>`(select count(*)::int from tasks s where s.parent_task_id = "tasks"."id" and s.deleted_at is null and s.status = 'DONE')`;

const LIST_LIMIT = 1000;

/** Top-level tasks in the person's manual order. Every row belongs to `userId`. */
export async function listTasks(
  userId: string,
  options: { statuses?: readonly TaskStatus[]; archived?: boolean } = {},
): Promise<TaskDTO[]> {
  const statuses = options.statuses ?? OPEN_STATUSES;
  if (statuses.length === 0) return [];

  const rows = await db
    .select({ task: tasks, total: subtaskTotal, done: subtaskDone })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.parentTaskId),
        options.archived ? isNotNull(tasks.archivedAt) : isNull(tasks.archivedAt),
        inArray(tasks.status, [...statuses]),
      ),
    )
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    .limit(LIST_LIMIT);

  return rows.map((r) => toTaskDTO(r.task, { total: r.total, done: r.done }));
}

/** Done and cancelled tasks, most recently finished first. */
export async function listClosedTasks(
  userId: string,
  options: { statuses?: readonly TaskStatus[]; archived?: boolean; limit?: number } = {},
): Promise<TaskDTO[]> {
  const statuses = options.statuses ?? (["DONE", "CANCELLED"] as const);
  if (statuses.length === 0) return [];

  const rows = await db
    .select({ task: tasks, total: subtaskTotal, done: subtaskDone })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.parentTaskId),
        options.archived ? isNotNull(tasks.archivedAt) : isNull(tasks.archivedAt),
        inArray(tasks.status, [...statuses]),
      ),
    )
    .orderBy(sql`${tasks.completedAt} desc nulls last`, desc(tasks.updatedAt))
    .limit(options.limit ?? 50);

  return rows.map((r) => toTaskDTO(r.task, { total: r.total, done: r.done }));
}

export async function countTasksByGroup(
  userId: string,
  options: { archived?: boolean } = {},
): Promise<{ open: number; done: number }> {
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${tasks.status} in ('INBOX','PLANNED','IN_PROGRESS','WAITING'))::int`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'DONE')::int`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.parentTaskId),
        options.archived ? isNotNull(tasks.archivedAt) : isNull(tasks.archivedAt),
      ),
    );
  return { open: row?.open ?? 0, done: row?.done ?? 0 };
}

/** One task with its subtasks and description, or null when it doesn't exist or isn't theirs. */
export async function getTaskDetail(userId: string, id: string): Promise<TaskDetailDTO | null> {
  const [row] = await db
    .select({ task: tasks, total: subtaskTotal, done: subtaskDone })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) return null;

  const subtasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));

  return {
    ...toTaskDTO(row.task, { total: row.total, done: row.done }),
    descriptionJson: row.task.descriptionJson ?? null,
    subtasks: subtasks.map((s) => toTaskDTO(s)),
  };
}
