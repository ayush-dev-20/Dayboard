import { eq, sql } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "@/db/client";
import { projectNoteFromLive } from "@/db/mutations/notes";
import { noteCollabDocs, noteSnapshots, notes } from "@/db/schema";
import { readLive, seedYDoc } from "@/lib/collab/convert";
import { SNAPSHOTS_KEPT } from "@/db/mutations/note-snapshots";
import { logger } from "@/lib/logger";
import { noteEditorIds } from "@/modules/permissions/editors";

// Persistence of live notes (V3 feature 05 §4). Ids and sizes only in logs: never the text.

export const MAX_DOC_BYTES = 2 * 1024 * 1024;

export type SnapshotReason = "INTERVAL" | "LAST_DISCONNECT" | "BEFORE_ROLLBACK";

/**
 * The shared document for a note, seeded from the note once under a per-note lock. A stored document is reused when it is
 * the one the note is at (seeded from this version, or last projected at it); otherwise the note was changed some other
 * way (an ordinary save, a restore) and the document is seeded again.
 */
export async function loadLiveDoc(
  noteId: string,
): Promise<{ ydoc: Y.Doc; ownerId: string } | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`collab:${noteId}`}))`);
    const [note] = await tx
      .select({
        ownerId: notes.userId,
        version: notes.version,
        title: notes.title,
        emoji: notes.emoji,
        contentJson: notes.contentJson,
        deletedAt: notes.deletedAt,
        journalDate: notes.journalDate,
      })
      .from(notes)
      .where(eq(notes.id, noteId))
      .limit(1);
    if (!note || note.deletedAt || note.journalDate) return null;

    const [row] = await tx.select().from(noteCollabDocs).where(eq(noteCollabDocs.noteId, noteId));
    if (row && (row.baseVersion === note.version || row.projectedVersion === note.version)) {
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, row.ydoc);
      return { ydoc, ownerId: note.ownerId };
    }

    const ydoc = seedYDoc({
      contentJson: note.contentJson as never,
      title: note.title,
      emoji: note.emoji,
    });
    const state = Y.encodeStateAsUpdate(ydoc);
    await tx
      .insert(noteCollabDocs)
      .values({ noteId, ydoc: state, baseVersion: note.version, projectedVersion: note.version })
      .onConflictDoUpdate({
        target: noteCollabDocs.noteId,
        set: {
          ydoc: state,
          baseVersion: note.version,
          projectedVersion: note.version,
          updatedAt: new Date(),
        },
      });
    return { ydoc, ownerId: note.ownerId };
  });
}

/**
 * Saves the document and projects it into the note. A body that cannot be cleaned keeps the last good projection (the
 * state is still saved, so nothing typed is lost). Returns whether the projection was written.
 */
export async function storeLiveDoc(
  noteId: string,
  ydoc: Y.Doc,
  updatedBy: string | null,
): Promise<boolean> {
  const state = Y.encodeStateAsUpdate(ydoc);
  const [note] = await db
    .select({ ownerId: notes.userId, deletedAt: notes.deletedAt })
    .from(notes)
    .where(eq(notes.id, noteId))
    .limit(1);
  if (!note || note.deletedAt) return false;

  let projected: { version: number } | null = null;
  try {
    const live = readLive(ydoc);
    projected = await projectNoteFromLive(note.ownerId, {
      id: noteId,
      contentJson: live.doc,
      title: live.title,
      emoji: live.emoji,
      updatedBy: updatedBy && updatedBy !== note.ownerId ? updatedBy : null,
    });
  } catch (error) {
    logger.warn("collab projection failed; keeping the last good one", {
      noteId,
      error: error instanceof Error ? error.name : "unknown",
    });
  }

  await db
    .update(noteCollabDocs)
    .set({
      ydoc: state,
      updatedAt: new Date(),
      ...(projected ? { projectedVersion: projected.version } : {}),
    })
    .where(eq(noteCollabDocs.noteId, noteId));
  return projected !== null;
}

/** A safety-net copy (never shown or restored by anything yet). Keeps the newest `SNAPSHOTS_KEPT` per note. */
export async function takeSnapshot(
  noteId: string,
  ydoc: Y.Doc,
  reason: SnapshotReason,
  createdBy: string | null,
): Promise<void> {
  const state = Y.encodeStateAsUpdate(ydoc);
  if (state.byteLength > MAX_DOC_BYTES) return;
  let content;
  try {
    content = readLive(ydoc).doc;
  } catch {
    return;
  }
  await db
    .insert(noteSnapshots)
    .values({ noteId, ydoc: state, contentJson: content, createdBy, reason });
  await db.execute(sql`
    delete from note_snapshots where note_id = ${noteId} and id not in (
      select id from note_snapshots where note_id = ${noteId} order by created_at desc, id desc limit ${SNAPSHOTS_KEPT})`);
}

/**
 * The last person left. If nobody else can edit the note any more, project it a final time, keep a snapshot and delete the
 * live document, so the note is an ordinary one again. Otherwise the document stays for the next session.
 */
export async function retireIfNoEditors(
  noteId: string,
  ydoc: Y.Doc,
  lastUser: string | null,
): Promise<boolean> {
  if ((await noteEditorIds(noteId)).length > 0) return false;
  await storeLiveDoc(noteId, ydoc, lastUser);
  await takeSnapshot(noteId, ydoc, "LAST_DISCONNECT", lastUser);
  await db.delete(noteCollabDocs).where(eq(noteCollabDocs.noteId, noteId));
  return true;
}
