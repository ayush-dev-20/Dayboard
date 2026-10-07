import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { notes, taskNotes, tasks } from "@/db/schema";
import { taskMetaFor } from "@/db/queries/meta";
import { toTaskDTO, type TaskDetailDTO, type TaskDTO } from "@/lib/tasks/dto";
import { OPEN_STATUSES, type TaskStatus } from "@/lib/tasks/status";

// Subtask counts come from correlated subqueries, so the whole list is one query (no N+1).
// The outer table is written as "tasks"."id" on purpose: in a single-table query Drizzle prints
// `${tasks.id}` as a bare "id", which inside the subquery would silently mean the subtask's own id.
export const subtaskTotal = sql<number>`(select count(*)::int from tasks s where s.parent_task_id = "tasks"."id" and s.deleted_at is null)`;
export const subtaskDone = sql<number>`(select count(*)::int from tasks s where s.parent_task_id = "tasks"."id" and s.deleted_at is null and s.status = 'DONE')`;

const LIST_LIMIT = 1000;

export type TaskFilters = {
  /** A project id, or "none" for tasks that have no (visible) project. */
  projectId?: string | "none";
  tagId?: string;
};

// Narrowing by project or tag. "No project" includes tasks whose project is in Trash, matching how
// those rows are shown. Written as SQL subqueries so the list is still one round trip.
function filterConditions(userId: string, filters: TaskFilters) {
  const out = [];
  if (filters.projectId === "none") {
    out.push(
      sql`("tasks"."project_id" is null or not exists (select 1 from projects p where p.id = "tasks"."project_id" and p.user_id = ${userId} and p.deleted_at is null))`,
    );
  } else if (filters.projectId) {
    out.push(
      sql`("tasks"."project_id" = ${filters.projectId} and exists (select 1 from projects p where p.id = "tasks"."project_id" and p.user_id = ${userId} and p.deleted_at is null))`,
    );
  }
  if (filters.tagId) {
    out.push(
      sql`exists (select 1 from task_tags tt where tt.task_id = "tasks"."id" and tt.tag_id = ${filters.tagId} and tt.user_id = ${userId})`,
    );
  }
  return out;
}

async function withMeta(
  userId: string,
  rows: {
    task: Parameters<typeof toTaskDTO>[0] & { projectId: string | null };
    total: number;
    done: number;
  }[],
): Promise<TaskDTO[]> {
  const meta = await taskMetaFor(
    db,
    userId,
    rows.map((r) => ({ id: r.task.id, projectId: r.task.projectId })),
  );
  return rows.map((r) => toTaskDTO(r.task, { total: r.total, done: r.done }, meta.get(r.task.id)));
}

/**
 * Top-level, not archived, not deleted tasks matching `extra`, as DTOs with subtask counts, project
 * and tags. The building block for views like Today that need their own filter and order.
 */
export async function selectTasks(
  userId: string,
  extra: (SQL | undefined)[],
  options: { orderBy: SQL[]; limit: number },
): Promise<TaskDTO[]> {
  const rows = await db
    .select({ task: tasks, total: subtaskTotal, done: subtaskDone })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.archivedAt),
        isNull(tasks.parentTaskId),
        ...extra,
      ),
    )
    .orderBy(...options.orderBy)
    .limit(options.limit);
  return withMeta(userId, rows);
}

/** Top-level tasks in the person's manual order. Every row belongs to `userId`. */
export async function listTasks(
  userId: string,
  options: { statuses?: readonly TaskStatus[]; archived?: boolean } & TaskFilters = {},
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
        ...filterConditions(userId, options),
      ),
    )
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    .limit(LIST_LIMIT);

  return withMeta(userId, rows);
}

/** Done and cancelled tasks, most recently finished first. */
export async function listClosedTasks(
  userId: string,
  options: {
    statuses?: readonly TaskStatus[];
    archived?: boolean;
    limit?: number;
  } & TaskFilters = {},
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
        ...filterConditions(userId, options),
      ),
    )
    .orderBy(sql`${tasks.completedAt} desc nulls last`, desc(tasks.updatedAt))
    .limit(options.limit ?? 50);

  return withMeta(userId, rows);
}

export async function countTasksByGroup(
  userId: string,
  options: { archived?: boolean } & TaskFilters = {},
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
        ...filterConditions(userId, options),
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

  const [subtasks, meta, linked] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt)),
    taskMetaFor(db, userId, [{ id: row.task.id, projectId: row.task.projectId }]),
    // Notes that are in Trash are hidden here, and come back with them when restored.
    db
      .select({ id: notes.id, title: notes.title, emoji: notes.emoji })
      .from(taskNotes)
      .innerJoin(notes, eq(notes.id, taskNotes.noteId))
      .where(
        and(
          eq(taskNotes.taskId, id),
          eq(taskNotes.userId, userId),
          eq(notes.userId, userId),
          isNull(notes.deletedAt),
        ),
      )
      .orderBy(asc(taskNotes.createdAt)),
  ]);

  const taskMeta = meta.get(row.task.id);
  return {
    ...toTaskDTO(row.task, { total: row.total, done: row.done }, taskMeta),
    descriptionJson: row.task.descriptionJson ?? null,
    // A subtask always follows its parent's project (feature doc §3).
    subtasks: subtasks.map((s) =>
      toTaskDTO(s, undefined, { project: taskMeta?.project ?? null, tags: [] }),
    ),
    notes: linked,
  };
}
