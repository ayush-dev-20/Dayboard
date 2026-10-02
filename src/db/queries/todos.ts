import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { projectRefsFor } from "@/db/queries/meta";
import { todos } from "@/db/schema";
import { toTodoDTO, type TodoDTO } from "@/lib/tasks/dto";

async function withProjects(
  userId: string,
  rows: (typeof todos.$inferSelect)[],
): Promise<TodoDTO[]> {
  const refs = await projectRefsFor(
    db,
    userId,
    rows.map((r) => r.projectId),
  );
  return rows.map((r) => toTodoDTO(r, (r.projectId && refs.get(r.projectId)) || null));
}

/** Open todos in the person's manual order. */
export async function listOpenTodos(
  userId: string,
  options: {
    archived?: boolean;
    projectId?: string;
    /** Today: only todos due on or before this date, or with no date. Dated ones come first. */
    dueByOrUndated?: string;
    limit?: number;
  } = {},
): Promise<TodoDTO[]> {
  const rows = await db
    .select()
    .from(todos)
    .where(
      and(
        eq(todos.userId, userId),
        isNull(todos.deletedAt),
        eq(todos.isComplete, false),
        options.archived ? isNotNull(todos.archivedAt) : isNull(todos.archivedAt),
        options.projectId ? eq(todos.projectId, options.projectId) : undefined,
        options.dueByOrUndated
          ? or(isNull(todos.dueDate), lte(todos.dueDate, options.dueByOrUndated))
          : undefined,
      ),
    )
    .orderBy(
      ...(options.dueByOrUndated
        ? [sql`${todos.dueDate} asc nulls last`, asc(todos.sortOrder)]
        : [asc(todos.sortOrder), asc(todos.createdAt)]),
    )
    .limit(options.limit ?? 1000);
  return withProjects(userId, rows);
}

/** Todos ticked off since `since` (the start of the person's day), newest first. */
export async function listCompletedTodosSince(userId: string, since: Date): Promise<TodoDTO[]> {
  const rows = await db
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
    .limit(200);
  return withProjects(userId, rows);
}
