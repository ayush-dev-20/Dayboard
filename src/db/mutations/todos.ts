import "server-only";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { todos, type NewTodo } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { toTodoDTO, type TodoDTO } from "@/lib/tasks/dto";
import { orderAtTop, orderBetween, renumber } from "@/lib/tasks/ordering";
import type { CreateTodoInput, UpdateTodoInput } from "@/lib/validations/tasks";

// Same rule as tasks: the owner's id is in every WHERE clause, and someone else's todo behaves
// exactly like one that doesn't exist.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function owned(userId: string, id: string, includeDeleted = false) {
  return and(
    eq(todos.id, id),
    eq(todos.userId, userId),
    includeDeleted ? undefined : isNull(todos.deletedAt),
  );
}

async function loadOwned(
  executor: Tx | typeof db,
  userId: string,
  id: string,
  includeDeleted = false,
) {
  const [row] = await executor
    .select()
    .from(todos)
    .where(owned(userId, id, includeDeleted))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

export async function createTodo(userId: string, input: CreateTodoInput): Promise<TodoDTO> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ min: sql<number | null>`min(${todos.sortOrder})` })
      .from(todos)
      .where(and(eq(todos.userId, userId), isNull(todos.deletedAt)));

    const [created] = await tx
      .insert(todos)
      .values({
        userId,
        title: input.title,
        emoji: input.emoji ?? null,
        dueDate: input.dueDate ?? null,
        sortOrder: orderAtTop(row?.min ?? null),
      })
      .returning();
    if (!created) throw new AppError("INTERNAL_ERROR");
    return toTodoDTO(created);
  });
}

export async function updateTodo(userId: string, input: UpdateTodoInput): Promise<TodoDTO> {
  const patch: Partial<NewTodo> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.emoji !== undefined) patch.emoji = input.emoji;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;

  if (Object.keys(patch).length === 0) return toTodoDTO(await loadOwned(db, userId, input.id));

  const [updated] = await db.update(todos).set(patch).where(owned(userId, input.id)).returning();
  if (!updated) throw new AppError("NOT_FOUND");
  return toTodoDTO(updated);
}

/** Ticks or unticks a todo. Returns the value before, so the caller can offer Undo. */
export async function setTodoComplete(
  userId: string,
  id: string,
  isComplete: boolean,
  now: Date = new Date(),
): Promise<{ todo: TodoDTO; wasComplete: boolean }> {
  return db.transaction(async (tx) => {
    const todo = await loadOwned(tx, userId, id);
    const [updated] = await tx
      .update(todos)
      .set({ isComplete, completedAt: isComplete ? now : null })
      .where(owned(userId, id))
      .returning();
    if (!updated) throw new AppError("NOT_FOUND");
    return { todo: toTodoDTO(updated), wasComplete: todo.isComplete };
  });
}

/** `beforeId` is the neighbour that will sit just above the moved todo, `afterId` just below. */
export async function reorderTodo(
  userId: string,
  input: { id: string; beforeId?: string | null; afterId?: string | null },
): Promise<{ sortOrder: number }> {
  return db.transaction(async (tx) => {
    await loadOwned(tx, userId, input.id);
    const siblings = and(eq(todos.userId, userId), isNull(todos.deletedAt));

    async function neighbour(neighbourId: string | null | undefined) {
      if (!neighbourId) return null;
      if (neighbourId === input.id)
        throw new AppError("VALIDATION_ERROR", "A todo can't go next to itself.");
      const [row] = await tx
        .select({ id: todos.id, sortOrder: todos.sortOrder })
        .from(todos)
        .where(and(siblings, eq(todos.id, neighbourId)))
        .limit(1);
      if (!row) throw new AppError("NOT_FOUND");
      return row;
    }

    const above = await neighbour(input.beforeId);
    const below = await neighbour(input.afterId);
    const { order, needsRenumber } = orderBetween(
      above?.sortOrder ?? null,
      below?.sortOrder ?? null,
    );

    if (!needsRenumber) {
      await tx.update(todos).set({ sortOrder: order }).where(owned(userId, input.id));
      return { sortOrder: order };
    }

    const others = await tx
      .select({ id: todos.id })
      .from(todos)
      .where(and(siblings, ne(todos.id, input.id)))
      .orderBy(asc(todos.sortOrder), asc(todos.createdAt));
    const ids = others.map((r) => r.id);
    const position = above ? ids.indexOf(above.id) + 1 : below ? ids.indexOf(below.id) : ids.length;
    ids.splice(position, 0, input.id);

    const fresh = renumber(ids);
    for (const [todoId, sortOrder] of fresh) {
      await tx.update(todos).set({ sortOrder }).where(owned(userId, todoId));
    }
    return { sortOrder: fresh.get(input.id) as number };
  });
}

export async function archiveTodo(userId: string, id: string, archived: boolean): Promise<TodoDTO> {
  await loadOwned(db, userId, id);
  const [updated] = await db
    .update(todos)
    .set({ archivedAt: archived ? new Date() : null })
    .where(owned(userId, id))
    .returning();
  if (!updated) throw new AppError("NOT_FOUND");
  return toTodoDTO(updated);
}

export async function deleteTodo(userId: string, id: string): Promise<{ deletedAt: string }> {
  await loadOwned(db, userId, id);
  const now = new Date();
  await db.update(todos).set({ deletedAt: now }).where(owned(userId, id));
  return { deletedAt: now.toISOString() };
}

export async function restoreTodo(userId: string, id: string): Promise<TodoDTO> {
  const todo = await loadOwned(db, userId, id, true);
  if (!todo.deletedAt) throw new AppError("NOT_FOUND");
  const [restored] = await db
    .update(todos)
    .set({ deletedAt: null })
    .where(owned(userId, id, true))
    .returning();
  if (!restored) throw new AppError("NOT_FOUND");
  return toTodoDTO(restored);
}

/** Only from Trash (feature 04). */
export async function permanentlyDeleteTodo(userId: string, id: string): Promise<void> {
  const todo = await loadOwned(db, userId, id, true);
  if (!todo.deletedAt) throw new AppError("CONFLICT", "Move it to Trash first.");
  await db.delete(todos).where(owned(userId, id, true));
}
