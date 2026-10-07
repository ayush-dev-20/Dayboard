import type { AnyItem, ViewNote, ViewTask, ViewTodo } from "./items";
import type { MoveCommand } from "./move-card";
import type { EngineContext } from "./values";

// What a command changes on the item as the screen shows it (V2 feature 06 §5). A card moves the
// instant it is dropped; the server's answer arrives a moment later and replaces this guess. Pure.

/** The fields of `item` that `command` changes, with their new values. */
export function patchForCommand(
  command: MoveCommand,
  ctx: Pick<EngineContext, "projects" | "tags">,
  now: Date,
): Partial<ViewTask & ViewTodo & ViewNote> {
  switch (command.type) {
    case "task.status":
      return {
        status: command.status,
        completedAt: command.status === "DONE" ? now.toISOString() : null,
      };
    case "task.priority":
      return { priority: command.priority };
    case "task.dueDate":
    case "todo.dueDate":
      return { dueDate: command.dueDate };
    case "todo.done":
      return { isComplete: command.done, completedAt: command.done ? now.toISOString() : null };
    case "project": {
      const project = command.projectId
        ? (ctx.projects.find((p) => p.id === command.projectId) ?? null)
        : null;
      return { project };
    }
    case "task.title":
    case "todo.title":
    case "note.title":
      return { title: command.title };
    case "task.startDate":
      return { startDate: command.startDate };
    case "archive":
      return { archived: command.archived };
    case "trash":
      // Out of the way at once; the server's list no longer has it after the refresh.
      return { archived: true };
    case "tags":
      return {
        tags: command.tagIds
          .map((id) => ctx.tags.find((t) => t.id === id))
          .filter((t): t is NonNullable<typeof t> => t !== undefined),
      };
  }
}

export function applyPatch<T extends AnyItem>(item: T, patch: Partial<AnyItem> | undefined): T {
  return patch ? ({ ...item, ...patch } as T) : item;
}
