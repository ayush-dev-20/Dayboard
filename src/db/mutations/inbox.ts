import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { createNote } from "@/db/mutations/notes";
import { createProject } from "@/db/mutations/projects";
import { createTask, updateTaskDescription } from "@/db/mutations/tasks";
import { createTodo } from "@/db/mutations/todos";
import { inboxItems, taskNotes, type ConvertedRef } from "@/db/schema";
import type { StoredSuggestion } from "@/lib/ai/schemas";
import { AppError } from "@/lib/errors";
import { textToDoc } from "@/lib/inbox/convert";
import type { TaskPriority } from "@/lib/tasks/status";
import type { ConvertInboxInput } from "@/lib/validations/inbox";

// Same rules as everything else: the owner's id is in every WHERE, and someone else's item behaves
// exactly like one that doesn't exist.

function owned(userId: string, id: string, includeDeleted = false) {
  return and(
    eq(inboxItems.id, id),
    eq(inboxItems.userId, userId),
    includeDeleted ? undefined : isNull(inboxItems.deletedAt),
  );
}

export async function captureInboxItem(userId: string, text: string): Promise<{ id: string }> {
  const [row] = await db
    .insert(inboxItems)
    .values({ userId, text })
    .returning({ id: inboxItems.id });
  if (!row) throw new AppError("INTERNAL_ERROR");
  return row;
}

/** The AI's guess about an item (feature 05), or null to clear it. Never changes the item's text. */
export async function setInboxSuggestion(
  userId: string,
  id: string,
  suggestion: StoredSuggestion | null,
): Promise<void> {
  const [row] = await db
    .update(inboxItems)
    .set({ aiSuggestion: suggestion })
    .where(and(owned(userId, id), eq(inboxItems.status, "OPEN")))
    .returning({ id: inboxItems.id });
  if (!row) throw new AppError("NOT_FOUND");
}

export async function updateInboxItem(userId: string, id: string, text: string): Promise<void> {
  const [row] = await db
    .update(inboxItems)
    .set({ text })
    .where(and(owned(userId, id), eq(inboxItems.status, "OPEN")))
    .returning({ id: inboxItems.id });
  if (!row) throw new AppError("NOT_FOUND");
}

export async function setInboxArchived(
  userId: string,
  id: string,
  archived: boolean,
): Promise<void> {
  const [row] = await db
    .update(inboxItems)
    .set({ status: archived ? "ARCHIVED" : "OPEN" })
    .where(and(owned(userId, id), eq(inboxItems.status, archived ? "OPEN" : "ARCHIVED")))
    .returning({ id: inboxItems.id });
  if (!row) throw new AppError("NOT_FOUND");
}

export async function deleteInboxItem(userId: string, id: string): Promise<{ deletedAt: string }> {
  const now = new Date();
  const [row] = await db
    .update(inboxItems)
    .set({ deletedAt: now })
    .where(owned(userId, id))
    .returning({ id: inboxItems.id });
  if (!row) throw new AppError("NOT_FOUND");
  return { deletedAt: now.toISOString() };
}

export async function restoreInboxItem(userId: string, id: string): Promise<void> {
  const [row] = await db
    .update(inboxItems)
    .set({ deletedAt: null })
    .where(owned(userId, id, true))
    .returning({ id: inboxItems.id });
  if (!row) throw new AppError("NOT_FOUND");
}

/** Only from Trash. */
export async function permanentlyDeleteInboxItem(userId: string, id: string): Promise<void> {
  const [row] = await db
    .select({ deletedAt: inboxItems.deletedAt })
    .from(inboxItems)
    .where(owned(userId, id, true))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
  if (!row.deletedAt) throw new AppError("CONFLICT", "Move it to Trash first.");
  await db.delete(inboxItems).where(owned(userId, id, true));
}

/**
 * Creates what the person chose and marks the item converted, all in one transaction: either
 * everything happens or nothing does. The destination records are created by the same functions
 * the rest of the app uses, so ownership and limits are checked the same way.
 */
export async function convertInboxItem(
  userId: string,
  input: ConvertInboxInput,
  defaults: { priority: TaskPriority },
): Promise<{ refs: ConvertedRef[] }> {
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(inboxItems).where(owned(userId, input.id)).limit(1);
    if (!item) throw new AppError("NOT_FOUND");
    if (item.status === "CONVERTED")
      throw new AppError("CONFLICT", "That item was already converted.");

    const refs: ConvertedRef[] = [];

    switch (input.target) {
      case "task": {
        const task = await createTask(
          userId,
          {
            title: input.title,
            projectId: input.projectId ?? null,
            dueDate: input.dueDate ?? null,
            status: input.decideLater ? "INBOX" : "PLANNED",
          },
          defaults,
          tx,
        );
        if (input.description?.trim()) {
          await updateTaskDescription(userId, task.id, textToDoc(input.description), tx);
        }
        refs.push({ type: "task", id: task.id });
        break;
      }
      case "todo": {
        const todo = await createTodo(
          userId,
          {
            title: input.title,
            projectId: input.projectId ?? null,
            dueDate: input.dueDate ?? null,
          },
          tx,
        );
        refs.push({ type: "todo", id: todo.id });
        break;
      }
      case "note": {
        const note = await createNote(
          userId,
          {
            title: input.title,
            projectId: input.projectId ?? null,
            contentJson: textToDoc(input.body),
          },
          tx,
        );
        refs.push({ type: "note", id: note.id });
        break;
      }
      case "task_note": {
        const task = await createTask(
          userId,
          {
            title: input.title,
            projectId: input.projectId ?? null,
            dueDate: input.dueDate ?? null,
            status: "PLANNED",
          },
          defaults,
          tx,
        );
        const note = await createNote(
          userId,
          {
            title: Array.from(input.title).slice(0, 300).join(""),
            projectId: input.projectId ?? null,
            contentJson: textToDoc(input.body),
          },
          tx,
        );
        await tx.insert(taskNotes).values({ taskId: task.id, noteId: note.id, userId });
        refs.push({ type: "task", id: task.id }, { type: "note", id: note.id });
        break;
      }
      case "project": {
        const project = await createProject(
          userId,
          { name: input.name, description: input.description?.trim() || null, status: "ON_HOLD" },
          tx,
        );
        refs.push({ type: "project", id: project.id });
        break;
      }
    }

    await tx
      .update(inboxItems)
      .set({ status: "CONVERTED", convertedAt: new Date(), convertedRefs: refs })
      .where(owned(userId, input.id));
    return { refs };
  });
}
