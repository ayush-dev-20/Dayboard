import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { todos } from "@/db/schema";
import { toTodoDTO, type TodoDTO } from "@/lib/tasks/dto";

/** Open todos in the person's manual order. */
export async function listOpenTodos(
  userId: string,
  options: { archived?: boolean } = {},
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
      ),
    )
    .orderBy(asc(todos.sortOrder), asc(todos.createdAt))
    .limit(1000);
  return rows.map(toTodoDTO);
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
  return rows.map(toTodoDTO);
}
