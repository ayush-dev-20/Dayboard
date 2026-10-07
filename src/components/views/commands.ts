import { toast } from "sonner";
import { archiveNote, deleteNote, reorderNote, restoreNote, saveNoteTitle } from "@/actions/notes";
import { assignToProject } from "@/actions/projects";
import { setNoteTags, setTaskTags } from "@/actions/tags";
import {
  archiveTask,
  completeTask,
  deleteTask,
  reorderTask,
  restoreTask,
  setTaskStatus,
  undoCompleteTask,
  unarchiveTask,
  updateTask,
} from "@/actions/tasks";
import {
  archiveTodo,
  deleteTodo,
  reorderTodo,
  restoreTodo,
  setTodoComplete,
  unarchiveTodo,
  updateTodo,
} from "@/actions/todos";
import type { ActionError } from "@/lib/actions";
import type { MoveCommand } from "@/lib/views/move-card";
import type { Collection } from "@/lib/views/types";

// Running the commands a drop, a cell edit or a bulk action produces (V2 feature 06 §5). Every one
// is an ordinary Server Action that the rest of the app already uses, so a change made here is
// exactly the change made anywhere else (completing a repeating task makes its next one, a task's
// subtasks follow its project, and so on). Each command returns how to take it back.

export type CommandResult =
  { ok: true; undo: () => Promise<boolean> } | { ok: false; message: string };

const messageOf = (error: ActionError) =>
  Object.values(error.fieldErrors ?? {})[0] ?? error.message;
const fail = (error: ActionError): CommandResult => ({ ok: false, message: messageOf(error) });
const done = (undo: () => Promise<boolean>): CommandResult => ({ ok: true, undo });

export async function runCommand(command: MoveCommand): Promise<CommandResult> {
  switch (command.type) {
    case "task.status": {
      if (command.status === "DONE") {
        const result = await completeTask({ id: command.id });
        if (!result.ok) return fail(result.error);
        const { previousStatus, nextOccurrenceId } = result.data;
        return done(
          async () =>
            (await undoCompleteTask({ id: command.id, previousStatus, nextOccurrenceId })).ok,
        );
      }
      const result = await setTaskStatus({ id: command.id, status: command.status });
      if (!result.ok) return fail(result.error);
      return done(async () => (await setTaskStatus({ id: command.id, status: command.from })).ok);
    }
    case "task.priority": {
      const result = await updateTask({ id: command.id, priority: command.priority });
      if (!result.ok) return fail(result.error);
      return done(async () => (await updateTask({ id: command.id, priority: command.from })).ok);
    }
    case "task.dueDate": {
      const result = await updateTask({ id: command.id, dueDate: command.dueDate });
      if (!result.ok) return fail(result.error);
      return done(async () => (await updateTask({ id: command.id, dueDate: command.from })).ok);
    }
    case "todo.done": {
      const result = await setTodoComplete({ id: command.id, isComplete: command.done });
      if (!result.ok) return fail(result.error);
      return done(
        async () => (await setTodoComplete({ id: command.id, isComplete: !command.done })).ok,
      );
    }
    case "todo.dueDate": {
      const result = await updateTodo({ id: command.id, dueDate: command.dueDate });
      if (!result.ok) return fail(result.error);
      return done(async () => (await updateTodo({ id: command.id, dueDate: command.from })).ok);
    }
    case "project": {
      const result = await assignToProject({
        itemType: command.itemType,
        itemId: command.id,
        projectId: command.projectId,
      });
      if (!result.ok) return fail(result.error);
      return done(
        async () =>
          (
            await assignToProject({
              itemType: command.itemType,
              itemId: command.id,
              projectId: command.from,
            })
          ).ok,
      );
    }
    case "task.title": {
      const result = await updateTask({ id: command.id, title: command.title });
      if (!result.ok) return fail(result.error);
      return done(async () => (await updateTask({ id: command.id, title: command.from })).ok);
    }
    case "task.startDate": {
      const result = await updateTask({ id: command.id, startDate: command.startDate });
      if (!result.ok) return fail(result.error);
      return done(async () => (await updateTask({ id: command.id, startDate: command.from })).ok);
    }
    case "todo.title": {
      const result = await updateTodo({ id: command.id, title: command.title });
      if (!result.ok) return fail(result.error);
      return done(async () => (await updateTodo({ id: command.id, title: command.from })).ok);
    }
    case "note.title": {
      const result = await saveNoteTitle({
        id: command.id,
        title: command.title,
        baseVersion: command.version,
      });
      if (!result.ok) return fail(result.error);
      if (result.data.outcome === "conflict") {
        return {
          ok: false,
          message: "This note changed somewhere else. Open it to see the latest.",
        };
      }
      const savedVersion = result.data.version;
      return done(
        async () =>
          (await saveNoteTitle({ id: command.id, title: command.from, baseVersion: savedVersion }))
            .ok,
      );
    }
    case "archive": {
      const set = (archived: boolean) =>
        command.itemType === "task"
          ? archived
            ? archiveTask({ id: command.id })
            : unarchiveTask({ id: command.id })
          : command.itemType === "todo"
            ? archived
              ? archiveTodo({ id: command.id })
              : unarchiveTodo({ id: command.id })
            : archiveNote({ id: command.id, archived });
      const result = await set(command.archived);
      if (!result.ok) return fail(result.error);
      return done(async () => (await set(!command.archived)).ok);
    }
    case "trash": {
      const result =
        command.itemType === "task"
          ? await deleteTask({ id: command.id })
          : command.itemType === "todo"
            ? await deleteTodo({ id: command.id })
            : await deleteNote({ id: command.id });
      if (!result.ok) return fail(result.error);
      return done(async () => {
        const restored =
          command.itemType === "task"
            ? await restoreTask({ id: command.id })
            : command.itemType === "todo"
              ? await restoreTodo({ id: command.id })
              : await restoreNote({ id: command.id });
        return restored.ok;
      });
    }
    case "tags": {
      const save = command.itemType === "task" ? setTaskTags : setNoteTags;
      const result = await save({ id: command.id, tagIds: command.tagIds });
      if (!result.ok) return fail(result.error);
      return done(async () => (await save({ id: command.id, tagIds: command.from })).ok);
    }
  }
}

/**
 * Runs the commands in order. If one fails, the ones already done are taken back, so a refused
 * change leaves nothing half-done. One undo takes back all of them (newest first).
 */
export async function runCommands(commands: readonly MoveCommand[]): Promise<CommandResult> {
  const undos: (() => Promise<boolean>)[] = [];
  for (const command of commands) {
    const result = await runCommand(command);
    if (!result.ok) {
      for (const undo of undos.reverse()) await undo();
      return result;
    }
    undos.push(result.undo);
  }
  return done(async () => {
    let allOk = true;
    for (const undo of [...undos].reverse()) allOk = (await undo()) && allOk;
    return allOk;
  });
}

const UNDO_MS = 6000;

/** The toast every change here shows: what happened, and Undo. `after` runs once Undo has finished. */
export function toastWithUndo(
  message: string,
  undo: () => Promise<boolean>,
  after?: () => void,
): void {
  toast(message, {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: async () => {
        if (!(await undo())) toast.error("Couldn't undo that. Try again.");
        after?.();
      },
    },
  });
}

/** Saves a card's place between its new neighbours. `beforeId` is the one above it, `afterId` below. */
export async function reorderItem(
  collection: Collection,
  place: { id: string; beforeId: string | null; afterId: string | null },
): Promise<boolean> {
  const save =
    collection === "TASKS" ? reorderTask : collection === "TODOS" ? reorderTodo : reorderNote;
  return (await save(place)).ok;
}
