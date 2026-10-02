import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { inboxItems, notes, projects, tasks, todos } from "@/db/schema";
import { TRASH_TYPES, type TrashType } from "@/lib/trash";

/**
 * Permanently deletes everything in Trash for this person (or one type of it) in a single
 * transaction. Subtasks, links and tag rows go with their parents through the foreign keys, and
 * items that were in a deleted project are simply left with no project.
 */
export async function emptyTrash(
  userId: string,
  type?: TrashType | null,
): Promise<{ deleted: number }> {
  const types = type ? [type] : TRASH_TYPES;
  return db.transaction(async (tx) => {
    let deleted = 0;
    for (const t of types) {
      switch (t) {
        case "task":
          deleted += (
            await tx
              .delete(tasks)
              .where(and(eq(tasks.userId, userId), isNotNull(tasks.deletedAt)))
              .returning({ id: tasks.id })
          ).length;
          break;
        case "todo":
          deleted += (
            await tx
              .delete(todos)
              .where(and(eq(todos.userId, userId), isNotNull(todos.deletedAt)))
              .returning({ id: todos.id })
          ).length;
          break;
        case "note":
          deleted += (
            await tx
              .delete(notes)
              .where(and(eq(notes.userId, userId), isNotNull(notes.deletedAt)))
              .returning({ id: notes.id })
          ).length;
          break;
        case "project":
          deleted += (
            await tx
              .delete(projects)
              .where(and(eq(projects.userId, userId), isNotNull(projects.deletedAt)))
              .returning({ id: projects.id })
          ).length;
          break;
        case "inbox":
          deleted += (
            await tx
              .delete(inboxItems)
              .where(and(eq(inboxItems.userId, userId), isNotNull(inboxItems.deletedAt)))
              .returning({ id: inboxItems.id })
          ).length;
          break;
      }
    }
    return { deleted };
  });
}
