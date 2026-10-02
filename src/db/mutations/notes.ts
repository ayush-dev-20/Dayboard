import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { inTransaction, type Tx } from "@/db/executor";
import { assertOwnedNote, assertOwnedProject, assertOwnedTask } from "@/db/mutations/guards";
import { notes, taskNotes } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { toPlainText } from "@/lib/editor/projection";
import type { TiptapDoc } from "@/lib/editor/types";
import type { CreateNoteInput } from "@/lib/validations/notes";

// Every function takes the signed-in person's id first and puts it in every WHERE clause. Someone
// else's note behaves exactly like one that doesn't exist.

const EMPTY_DOC: TiptapDoc = { type: "doc", content: [] };

function owned(userId: string, id: string, includeDeleted = false) {
  return and(
    eq(notes.id, id),
    eq(notes.userId, userId),
    includeDeleted ? undefined : isNull(notes.deletedAt),
  );
}

export async function createNote(
  userId: string,
  input: CreateNoteInput,
  outer?: Tx,
): Promise<{ id: string; version: number }> {
  return inTransaction(outer, async (tx) => {
    if (input.projectId) await assertOwnedProject(tx, userId, input.projectId);
    if (input.linkTaskId) await assertOwnedTask(tx, userId, input.linkTaskId);

    const doc = input.contentJson ?? EMPTY_DOC;
    const [created] = await tx
      .insert(notes)
      .values({
        userId,
        projectId: input.projectId ?? null,
        title: input.title ?? "",
        emoji: input.emoji ?? null,
        contentJson: doc,
        contentText: toPlainText(doc),
      })
      .returning({ id: notes.id, version: notes.version });
    if (!created) throw new AppError("INTERNAL_ERROR");

    if (input.linkTaskId) {
      await tx.insert(taskNotes).values({ taskId: input.linkTaskId, noteId: created.id, userId });
    }
    return created;
  });
}

export type SaveResult =
  | { outcome: "saved"; version: number; updatedAt: string }
  /** Someone (another tab or device) saved first. `version` is the latest on the server. */
  | { outcome: "conflict"; version: number };

async function conflictOrMissing(userId: string, id: string): Promise<SaveResult> {
  const [current] = await db
    .select({ version: notes.version })
    .from(notes)
    .where(owned(userId, id))
    .limit(1);
  if (!current) throw new AppError("NOT_FOUND");
  return { outcome: "conflict", version: current.version };
}

/**
 * Saves the document only if the note is still at the version the editor started from. The
 * plain-text copy is rebuilt here from the saved JSON; the client never sends it.
 */
export async function saveNoteContent(
  userId: string,
  input: { id: string; contentJson: TiptapDoc; baseVersion: number },
): Promise<SaveResult> {
  const [row] = await db
    .update(notes)
    .set({
      contentJson: input.contentJson,
      contentText: toPlainText(input.contentJson),
      version: sql`${notes.version} + 1`,
    })
    .where(and(owned(userId, input.id), eq(notes.version, input.baseVersion)))
    .returning({ version: notes.version, updatedAt: notes.updatedAt });
  if (!row) return conflictOrMissing(userId, input.id);
  return { outcome: "saved", version: row.version, updatedAt: row.updatedAt.toISOString() };
}

export async function saveNoteTitle(
  userId: string,
  input: { id: string; title: string; baseVersion: number },
): Promise<SaveResult> {
  const [row] = await db
    .update(notes)
    .set({ title: input.title, version: sql`${notes.version} + 1` })
    .where(and(owned(userId, input.id), eq(notes.version, input.baseVersion)))
    .returning({ version: notes.version, updatedAt: notes.updatedAt });
  if (!row) return conflictOrMissing(userId, input.id);
  return { outcome: "saved", version: row.version, updatedAt: row.updatedAt.toISOString() };
}

/** Emoji only here; the project goes through `assignToProject`. Does not touch `version`. */
export async function updateNoteEmoji(
  userId: string,
  id: string,
  emoji: string | null,
): Promise<void> {
  const [row] = await db
    .update(notes)
    .set({ emoji })
    .where(owned(userId, id))
    .returning({ id: notes.id });
  if (!row) throw new AppError("NOT_FOUND");
}

export async function archiveNote(userId: string, id: string, archived: boolean): Promise<void> {
  const [row] = await db
    .update(notes)
    .set({ archivedAt: archived ? new Date() : null })
    .where(owned(userId, id))
    .returning({ id: notes.id });
  if (!row) throw new AppError("NOT_FOUND");
}

export async function deleteNote(userId: string, id: string): Promise<{ deletedAt: string }> {
  const now = new Date();
  const [row] = await db
    .update(notes)
    .set({ deletedAt: now })
    .where(owned(userId, id))
    .returning({ id: notes.id });
  if (!row) throw new AppError("NOT_FOUND");
  return { deletedAt: now.toISOString() };
}

export async function restoreNote(userId: string, id: string): Promise<void> {
  const [row] = await db
    .update(notes)
    .set({ deletedAt: null })
    .where(owned(userId, id, true))
    .returning({ id: notes.id });
  if (!row) throw new AppError("NOT_FOUND");
}

/** Only from Trash (feature 04). Links and tag rows go with it. */
export async function permanentlyDeleteNote(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(notes)
      .where(owned(userId, id, true))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND");
    if (!row.deletedAt) throw new AppError("CONFLICT", "Move it to Trash first.");
    await tx.delete(notes).where(owned(userId, id, true));
  });
}

/** Both the task and the note must be the person's, or this is NOT_FOUND. Linking twice is a no-op. */
export async function linkTaskNote(userId: string, taskId: string, noteId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await assertOwnedTask(tx, userId, taskId);
    await assertOwnedNote(tx, userId, noteId);
    await tx.insert(taskNotes).values({ taskId, noteId, userId }).onConflictDoNothing();
  });
}

export async function unlinkTaskNote(
  userId: string,
  taskId: string,
  noteId: string,
): Promise<void> {
  await db
    .delete(taskNotes)
    .where(
      and(eq(taskNotes.taskId, taskId), eq(taskNotes.noteId, noteId), eq(taskNotes.userId, userId)),
    );
}
