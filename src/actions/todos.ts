"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/todos";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/session";
import type { TodoDTO } from "@/lib/tasks/dto";
import {
  createTodoSchema,
  idOnlySchema,
  reorderSchema,
  setTodoCompleteSchema,
  updateTodoSchema,
} from "@/lib/validations/tasks";

function refreshTodos() {
  revalidatePath("/tasks", "layout");
  revalidatePath("/today");
}

export async function createTodo(input: unknown): Promise<ActionResult<TodoDTO>> {
  return runAction("todos.create", async () => {
    const user = await requireUser();
    const todo = await mutations.createTodo(user.id, createTodoSchema.parse(input));
    refreshTodos();
    return todo;
  });
}

export async function updateTodo(input: unknown): Promise<ActionResult<TodoDTO>> {
  return runAction("todos.update", async () => {
    const user = await requireUser();
    const todo = await mutations.updateTodo(user.id, updateTodoSchema.parse(input));
    refreshTodos();
    return todo;
  });
}

/**
 * Ticks or unticks. Does not refresh the page, so the row stays put while the Undo toast shows;
 * the client refreshes when it closes. Returns the previous value for Undo.
 */
export async function setTodoComplete(
  input: unknown,
): Promise<ActionResult<{ todo: TodoDTO; wasComplete: boolean }>> {
  return runAction("todos.setComplete", async () => {
    const user = await requireUser();
    const { id, isComplete } = setTodoCompleteSchema.parse(input);
    return mutations.setTodoComplete(user.id, id, isComplete);
  });
}

export async function reorderTodo(input: unknown): Promise<ActionResult<{ sortOrder: number }>> {
  return runAction("todos.reorder", async () => {
    const user = await requireUser();
    const result = await mutations.reorderTodo(user.id, reorderSchema.parse(input));
    refreshTodos();
    return result;
  });
}

export async function archiveTodo(input: unknown): Promise<ActionResult<TodoDTO>> {
  return runAction("todos.archive", async () => {
    const user = await requireUser();
    const todo = await mutations.archiveTodo(user.id, idOnlySchema.parse(input).id, true);
    refreshTodos();
    return todo;
  });
}

export async function deleteTodo(input: unknown): Promise<ActionResult<{ deletedAt: string }>> {
  return runAction("todos.delete", async () => {
    const user = await requireUser();
    const result = await mutations.deleteTodo(user.id, idOnlySchema.parse(input).id);
    refreshTodos();
    return result;
  });
}

export async function restoreTodo(input: unknown): Promise<ActionResult<TodoDTO>> {
  return runAction("todos.restore", async () => {
    const user = await requireUser();
    const todo = await mutations.restoreTodo(user.id, idOnlySchema.parse(input).id);
    refreshTodos();
    return todo;
  });
}

/** Called from Trash (feature 04). */
export async function permanentlyDeleteTodo(input: unknown): Promise<ActionResult> {
  return runAction("todos.permanentlyDelete", async () => {
    const user = await requireUser();
    await mutations.permanentlyDeleteTodo(user.id, idOnlySchema.parse(input).id);
    refreshTodos();
  });
}
