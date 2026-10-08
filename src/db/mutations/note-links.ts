import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db/executor";
import { noteLinks, notes } from "@/db/schema";
import { toPlainText } from "@/lib/editor/projection";
import type { TiptapDoc } from "@/lib/editor/types";
import { allNoteRefs, collectNoteRefs, linkSnippets } from "@/lib/notes/links";

// Keeps what a document points at in step with what is saved (V2 feature 07 §2). Called inside the
// same transaction as every save of a note's text or a task's description:
//   - the plain-text copy gets the title of each note it links to or holds (so a search for a title
//     also finds the notes that mention it), and
//   - `note_links` is rebuilt, one row per distinct note link, for the "Linked from" list.

export type TitleMap = Map<string, string>;

/** Titles of the person's own notes (in any state: a link to a note in Trash still names it). */
export async function noteTitles(
  executor: Executor,
  userId: string,
  ids: readonly string[],
): Promise<TitleMap> {
  if (ids.length === 0) return new Map();
  const rows = await executor
    .select({ id: notes.id, title: notes.title })
    .from(notes)
    .where(and(eq(notes.userId, userId), inArray(notes.id, [...ids])));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/** The searchable text for a document, with link and sub-note titles filled in. */
export async function projectDoc(
  executor: Executor,
  userId: string,
  doc: TiptapDoc,
): Promise<{ text: string; titles: TitleMap }> {
  const titles = await noteTitles(executor, userId, allNoteRefs(doc));
  return { text: toPlainText(doc, (id) => titles.get(id)), titles };
}

/**
 * Rebuilds the rows for one source. A link to a note that is not the person's, or no longer
 * exists, stores nothing (the document keeps the link, which then reads "Note no longer exists").
 * A note linking to itself is not a backlink.
 */
export async function syncNoteLinks(
  executor: Executor,
  userId: string,
  source: { type: "NOTE" | "TASK"; id: string },
  doc: TiptapDoc | null,
  titles?: TitleMap,
): Promise<void> {
  await executor
    .delete(noteLinks)
    .where(
      and(
        eq(noteLinks.userId, userId),
        eq(noteLinks.sourceType, source.type),
        eq(noteLinks.sourceId, source.id),
      ),
    );
  if (!doc) return;

  const wanted = collectNoteRefs(doc).links.filter(
    (id) => !(source.type === "NOTE" && id === source.id),
  );
  if (wanted.length === 0) return;

  const known = titles ?? (await noteTitles(executor, userId, wanted));
  const targets = wanted.filter((id) => known.has(id));
  if (targets.length === 0) return;
  const snippets = linkSnippets(doc, (id) => known.get(id));

  await executor
    .insert(noteLinks)
    .values(
      targets.map((targetNoteId) => ({
        sourceType: source.type,
        sourceId: source.id,
        targetNoteId,
        userId,
        snippet: snippets.get(targetNoteId) ?? "",
      })),
    )
    .onConflictDoNothing();
}
