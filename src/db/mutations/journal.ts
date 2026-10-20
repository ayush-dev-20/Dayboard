import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { inTransaction, type Tx } from "@/db/executor";
import { projectDoc, syncNoteLinks } from "@/db/mutations/note-links";
import { notes } from "@/db/schema";
import { journalTitle } from "@/lib/dates/journal";
import type { TiptapDoc } from "@/lib/editor/types";
import { AppError } from "@/lib/errors";

// Writes of the journal (V3 feature 02 §4). An entry is a note that carries a date, so everything about its text,
// title, tags, project, Trash and links is the note's own code; this file only creates one. The date is chosen by
// the caller (the server's own "today"), never by the browser, and it is never changed afterwards.

const EMPTY_DOC: TiptapDoc = { type: "doc", content: [] };

export type CreateEntryResult =
  | { outcome: "created"; id: string; version: number; date: string }
  | { outcome: "exists"; id: string; date: string };

/**
 * Creates the entry for `date`, or says which one already holds it (two tabs, or an entry made on another
 * device). The partial unique index decides, so two calls at once make one entry and the other gets `exists`.
 * The content must already have passed `richTextSchema` (no sub-note blocks).
 */
export async function createJournalEntry(
  userId: string,
  date: string,
  input: { title?: string; contentJson?: TiptapDoc },
  outer?: Tx,
): Promise<CreateEntryResult> {
  return inTransaction(outer, async (tx) => {
    const doc = input.contentJson ?? EMPTY_DOC;
    const { text, titles } = await projectDoc(tx, userId, doc);
    const [created] = await tx
      .insert(notes)
      .values({
        userId,
        journalDate: date,
        title: input.title || journalTitle(date),
        contentJson: doc,
        contentText: text,
      })
      .onConflictDoNothing({
        target: [notes.userId, notes.journalDate],
        where: sql`${notes.journalDate} is not null and ${notes.deletedAt} is null`,
      })
      .returning({ id: notes.id, version: notes.version });
    if (created) {
      await syncNoteLinks(tx, userId, { type: "NOTE", id: created.id }, doc, titles);
      return { outcome: "created", id: created.id, version: created.version, date };
    }

    const [existing] = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.userId, userId), eq(notes.journalDate, date), isNull(notes.deletedAt)))
      .limit(1);
    if (!existing) throw new AppError("INTERNAL_ERROR");
    return { outcome: "exists", id: existing.id, date };
  });
}
