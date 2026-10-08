import "server-only";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { inTransaction, type Executor, type Tx } from "@/db/executor";
import { assertOwnedNote, assertOwnedProject, assertOwnedTask } from "@/db/mutations/guards";
import { projectDoc, syncNoteLinks } from "@/db/mutations/note-links";
import { orderAtTopOf } from "@/db/mutations/note-tree";
import { notes, taskNotes } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { orderBetween, renumber } from "@/lib/tasks/ordering";
import type { TiptapDoc } from "@/lib/editor/types";
import type { CreateNoteInput } from "@/lib/validations/notes";

// Trash, archive and everything that moves a note live in `note-tree.ts`; they are re-exported here
// so the rest of the app keeps one place to import notes from.
export {
  archiveNote,
  createSubNote,
  deleteNote,
  moveNote,
  permanentlyDeleteNote,
  restoreNote,
  restoreNoteAsTopLevel,
} from "@/db/mutations/note-tree";

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
    const { text, titles } = await projectDoc(tx, userId, doc);
    const [created] = await tx
      .insert(notes)
      .values({
        userId,
        // A new note goes to the top of the top level (boards, the tree).
        sortOrder: await orderAtTopOf(tx, userId, null),
        projectId: input.projectId ?? null,
        title: input.title ?? "",
        emoji: input.emoji ?? null,
        contentJson: doc,
        contentText: text,
      })
      .returning({ id: notes.id, version: notes.version });
    if (!created) throw new AppError("INTERNAL_ERROR");
    await syncNoteLinks(tx, userId, { type: "NOTE", id: created.id }, doc, titles);

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

async function conflictOrMissing(
  executor: Executor,
  userId: string,
  id: string,
): Promise<SaveResult> {
  const [current] = await executor
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
  return db.transaction(async (tx) => {
    const { text, titles } = await projectDoc(tx, userId, input.contentJson);
    const [row] = await tx
      .update(notes)
      .set({
        contentJson: input.contentJson,
        contentText: text,
        version: sql`${notes.version} + 1`,
      })
      .where(and(owned(userId, input.id), eq(notes.version, input.baseVersion)))
      .returning({ version: notes.version, updatedAt: notes.updatedAt });
    if (!row) return conflictOrMissing(tx, userId, input.id);
    await syncNoteLinks(tx, userId, { type: "NOTE", id: input.id }, input.contentJson, titles);
    return { outcome: "saved", version: row.version, updatedAt: row.updatedAt.toISOString() };
  });
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
  if (!row) return conflictOrMissing(db, userId, input.id);
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

/**
 * Manual order of notes (V2 feature 06 §2): `beforeId` is the note that will sit just above the
 * moved one, `afterId` just below. Does not touch `updated_at`: arranging notes on a board is not
 * editing them.
 */
export async function reorderNote(
  userId: string,
  input: { id: string; beforeId?: string | null; afterId?: string | null },
): Promise<{ sortOrder: number }> {
  return db.transaction(async (tx) => {
    await assertOwnedNote(tx, userId, input.id);
    const siblings = and(eq(notes.userId, userId), isNull(notes.deletedAt));

    async function neighbour(neighbourId: string | null | undefined) {
      if (!neighbourId) return null;
      if (neighbourId === input.id) {
        throw new AppError("VALIDATION_ERROR", "A note can't go next to itself.");
      }
      const [row] = await tx
        .select({ id: notes.id, sortOrder: notes.sortOrder })
        .from(notes)
        .where(and(siblings, eq(notes.id, neighbourId)))
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
    const keepUpdatedAt = { updatedAt: sql`${notes.updatedAt}` };

    if (!needsRenumber) {
      await tx
        .update(notes)
        .set({ sortOrder: order, ...keepUpdatedAt })
        .where(owned(userId, input.id));
      return { sortOrder: order };
    }

    const others = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(and(siblings, ne(notes.id, input.id)))
      .orderBy(asc(notes.sortOrder), asc(notes.createdAt));
    const ids = others.map((r) => r.id);
    const at = above ? ids.indexOf(above.id) + 1 : below ? ids.indexOf(below.id) : ids.length;
    ids.splice(at, 0, input.id);
    const fresh = renumber(ids);
    for (const [noteId, sortOrder] of fresh) {
      await tx
        .update(notes)
        .set({ sortOrder, ...keepUpdatedAt })
        .where(owned(userId, noteId));
    }
    return { sortOrder: fresh.get(input.id) as number };
  });
}
