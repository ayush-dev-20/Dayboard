import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { listNotes } from "@/db/queries/notes";
import { selectTasks } from "@/db/queries/tasks";
import { listOpenTodos } from "@/db/queries/todos";
import { projectRefsFor } from "@/db/queries/meta";
import { tasks, todos, userPreferences } from "@/db/schema";
import { getUserToday, startOfUserDay, type DayPrefs } from "@/lib/dates/today";
import type { NoteListItemDTO } from "@/lib/notes/dto";
import { OPEN_STATUSES } from "@/lib/tasks/status";
import { toTodoDTO, type TaskDTO, type TodoDTO } from "@/lib/tasks/dto";
import { bucketToday, TODAY_LIMITS } from "@/lib/today/buckets";

export type TodayData = {
  focus: TaskDTO | null;
  overdue: TaskDTO[];
  /** How many tasks are overdue in all, for "Show all". */
  overdueTotal: number;
  /** Due today with no time, then those scheduled later today. */
  today: TaskDTO[];
  laterStart: number;
  todos: TodoDTO[];
  planning: TaskDTO[];
  notes: NoteListItemDTO[];
  completedTasks: TaskDTO[];
  completedTodos: TodoDTO[];
};

const open = inArray(tasks.status, [...OPEN_STATUSES]);

/**
 * Everything Today shows, from one loader: parallel queries, no client fetching. "Today" is the
 * person's own day (it rolls over at their start-of-day). A focus task that has since been
 * completed, cancelled, archived or deleted is cleared here.
 */
export async function getTodayData(
  userId: string,
  prefs: DayPrefs,
  focusTaskId: string | null,
  now: Date = new Date(),
): Promise<TodayData> {
  const today = getUserToday(prefs, now);
  const since = startOfUserDay(prefs, now);

  const [focusRows, dueTasks, openTodos, planning, notes, completedTasks, completedTodoRows] =
    await Promise.all([
      focusTaskId
        ? selectTasks(userId, [eq(tasks.id, focusTaskId), open], {
            orderBy: [asc(tasks.sortOrder)],
            limit: 1,
          })
        : Promise.resolve([] as TaskDTO[]),
      // Everything due today or earlier; bucketing (overdue / today / later) is the pure helper's job.
      selectTasks(userId, [open, isNotNull(tasks.dueDate), lte(tasks.dueDate, today)], {
        orderBy: [asc(tasks.sortOrder), asc(tasks.createdAt)],
        limit: 500,
      }),
      listOpenTodos(userId, { dueByOrUndated: today, limit: TODAY_LIMITS.todos }),
      selectTasks(
        userId,
        [
          open,
          isNull(tasks.dueDate),
          inArray(tasks.priority, ["HIGH", "MEDIUM"]),
          ne(tasks.status, "WAITING"),
        ],
        {
          // High before medium, then the person's own order.
          orderBy: [
            sql`case ${tasks.priority} when 'HIGH' then 0 else 1 end`,
            asc(tasks.sortOrder),
          ],
          limit: TODAY_LIMITS.planning,
        },
      ),
      listNotes(userId, { limit: TODAY_LIMITS.notes }),
      selectTasks(userId, [eq(tasks.status, "DONE"), gte(tasks.completedAt, since)], {
        orderBy: [sql`${tasks.completedAt} desc`],
        limit: TODAY_LIMITS.completed,
      }),
      db
        .select()
        .from(todos)
        .where(
          and(
            eq(todos.userId, userId),
            isNull(todos.deletedAt),
            isNull(todos.archivedAt),
            eq(todos.isComplete, true),
            gte(todos.completedAt, since),
          ),
        )
        .orderBy(desc(todos.completedAt))
        .limit(TODAY_LIMITS.completed),
    ]);

  const focus = focusRows[0] ?? null;
  if (focusTaskId && !focus) {
    await db
      .update(userPreferences)
      .set({ focusTaskId: null })
      .where(eq(userPreferences.userId, userId));
  }

  const buckets = bucketToday(dueTasks, prefs, now);
  const refs = await projectRefsFor(
    db,
    userId,
    completedTodoRows.map((r) => r.projectId),
  );

  return {
    focus,
    overdue: buckets.overdue.slice(0, TODAY_LIMITS.overdue),
    overdueTotal: buckets.overdue.length,
    today: [...buckets.today, ...buckets.later].slice(0, TODAY_LIMITS.today),
    laterStart: Math.min(buckets.today.length, TODAY_LIMITS.today),
    todos: openTodos,
    planning,
    notes,
    completedTasks,
    completedTodos: completedTodoRows.map((r) =>
      toTodoDTO(r, (r.projectId && refs.get(r.projectId)) || null),
    ),
  };
}

/** Open tasks to pick from for "Change focus": matched by title, most recently updated first. */
export async function findFocusCandidates(
  userId: string,
  query: string,
  limit = 8,
): Promise<{ id: string; title: string; emoji: string | null; dueDate: string | null }[]> {
  const term = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return db
    .select({ id: tasks.id, title: tasks.title, emoji: tasks.emoji, dueDate: tasks.dueDate })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.archivedAt),
        isNull(tasks.parentTaskId),
        open,
        term ? sql`${tasks.title} ilike ${`%${term}%`}` : undefined,
      ),
    )
    .orderBy(sql`${tasks.dueDate} asc nulls last`, desc(tasks.updatedAt))
    .limit(limit);
}
