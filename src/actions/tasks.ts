"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/tasks";
import { runAction, type ActionResult } from "@/lib/actions";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import type { TaskDTO } from "@/lib/tasks/dto";
import type { TaskStatus } from "@/lib/tasks/status";
import {
  createTaskSchema,
  idOnlySchema,
  reorderSchema,
  setTaskStatusSchema,
  undoCompleteSchema,
  updateTaskDescriptionSchema,
  updateTaskSchema,
} from "@/lib/validations/tasks";

// Every action: who is asking -> is the input valid -> do it, scoped to that person -> refresh.

function refreshTasks() {
  revalidatePath("/tasks", "layout");
  revalidatePath("/today");
}

export async function createTask(input: unknown): Promise<ActionResult<TaskDTO>> {
  return runAction("tasks.create", async () => {
    const user = await requireUser();
    const values = createTaskSchema.parse(input);
    const { defaultTaskPriority } = await getPreferences(user.id);
    const task = await mutations.createTask(user.id, values, { priority: defaultTaskPriority });
    refreshTasks();
    return task;
  });
}

export async function updateTask(input: unknown): Promise<ActionResult<TaskDTO>> {
  return runAction("tasks.update", async () => {
    const user = await requireUser();
    const task = await mutations.updateTask(user.id, updateTaskSchema.parse(input));
    refreshTasks();
    return task;
  });
}

/** Autosaved while typing, so it does not refresh the page. */
export async function updateTaskDescription(
  input: unknown,
): Promise<ActionResult<{ updatedAt: string }>> {
  return runAction("tasks.updateDescription", async () => {
    const user = await requireUser();
    const { id, descriptionJson } = updateTaskDescriptionSchema.parse(input);
    return mutations.updateTaskDescription(user.id, id, descriptionJson);
  });
}

/**
 * Does not refresh the page: the row stays where it is while the Undo toast is showing. The
 * client refreshes when the toast closes.
 */
export async function completeTask(
  input: unknown,
): Promise<ActionResult<mutations.CompleteResult>> {
  return runAction("tasks.complete", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    return mutations.completeTask(user.id, id);
  });
}

export async function undoCompleteTask(
  input: unknown,
): Promise<ActionResult<{ task: TaskDTO; removedOccurrence: boolean }>> {
  return runAction("tasks.undoComplete", async () => {
    const user = await requireUser();
    const result = await mutations.undoCompleteTask(user.id, undoCompleteSchema.parse(input));
    refreshTasks();
    return result;
  });
}

export async function setTaskStatus(input: unknown): Promise<ActionResult<TaskDTO>> {
  return runAction("tasks.setStatus", async () => {
    const user = await requireUser();
    const { id, status } = setTaskStatusSchema.parse(input);
    const task = await mutations.setTaskStatus(user.id, id, status as TaskStatus);
    refreshTasks();
    return task;
  });
}

export async function reorderTask(input: unknown): Promise<ActionResult<{ sortOrder: number }>> {
  return runAction("tasks.reorder", async () => {
    const user = await requireUser();
    const result = await mutations.reorderTask(user.id, reorderSchema.parse(input));
    refreshTasks();
    return result;
  });
}

export async function archiveTask(input: unknown): Promise<ActionResult<TaskDTO>> {
  return runAction("tasks.archive", async () => {
    const user = await requireUser();
    const task = await mutations.archiveTask(user.id, idOnlySchema.parse(input).id, true);
    refreshTasks();
    return task;
  });
}

export async function unarchiveTask(input: unknown): Promise<ActionResult<TaskDTO>> {
  return runAction("tasks.unarchive", async () => {
    const user = await requireUser();
    const task = await mutations.archiveTask(user.id, idOnlySchema.parse(input).id, false);
    refreshTasks();
    return task;
  });
}

export async function deleteTask(input: unknown): Promise<ActionResult<{ deletedAt: string }>> {
  return runAction("tasks.delete", async () => {
    const user = await requireUser();
    const result = await mutations.deleteTask(user.id, idOnlySchema.parse(input).id);
    refreshTasks();
    return result;
  });
}

export async function restoreTask(input: unknown): Promise<ActionResult<TaskDTO>> {
  return runAction("tasks.restore", async () => {
    const user = await requireUser();
    const task = await mutations.restoreTask(user.id, idOnlySchema.parse(input).id);
    refreshTasks();
    return task;
  });
}

/** Called from Trash (feature 04). */
export async function permanentlyDeleteTask(input: unknown): Promise<ActionResult> {
  return runAction("tasks.permanentlyDelete", async () => {
    const user = await requireUser();
    await mutations.permanentlyDeleteTask(user.id, idOnlySchema.parse(input).id);
    refreshTasks();
  });
}
