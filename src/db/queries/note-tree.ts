import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notes } from "@/db/schema";
import type { BacklinkDTO, NoteChildDTO, NoteCrumbDTO, NoteTreeRow } from "@/lib/notes/dto";
import { noteState, type NoteMeta } from "@/lib/notes/links";
import { rankPickerResults, type PickerCandidate } from "@/lib/notes/picker";

// Reads for the hierarchy and for links (V2 feature 07 §3): the sidebar tree, breadcrumbs, the
// automatic Sub-notes list, "Linked from", link states and the note picker. Every one is scoped to
// the signed-in person; a note id that is not theirs is simply not there.

/** The sidebar shows this many top-level notes (and everything under them). */
export const SIDEBAR_ROOTS = 50;
/** The most notes the Tree view and the Move-to picker load. */
export const OUTLINE_LIMIT = 2000;

type TreeRaw = {
  id: string;
  parent_note_id: string | null;
  title: string;
  emoji: string | null;
  sort_order: number;
  depth: number;
};

const toRow = (r: TreeRaw): NoteTreeRow => ({
  id: r.id,
  parentId: r.parent_note_id,
  title: r.title,
  emoji: r.emoji,
  sortOrder: r.sort_order,
  depth: r.depth,
});

/**
 * The first 50 top-level notes, by manual order, and every note under them: what the sidebar tree
 * shows. Archived and trashed notes are left out. `rootTotal` says how many top-level notes there
 * are, so the sidebar can offer "Show all notes" past 50.
 */
export async function getNoteTree(
  userId: string,
  limit = SIDEBAR_ROOTS,
): Promise<{ rows: NoteTreeRow[]; rootTotal: number }> {
  const [rows, total] = await Promise.all([
    db.execute(sql`
      with recursive roots as (
        select id from notes
        where user_id = ${userId} and parent_note_id is null and deleted_at is null and archived_at is null
        order by sort_order asc, created_at desc
        limit ${limit}
      ),
      tree as (
        select n.id, n.parent_note_id, n.title, n.emoji, n.sort_order, n.depth
        from notes n join roots r on r.id = n.id
        union all
        select c.id, c.parent_note_id, c.title, c.emoji, c.sort_order, c.depth
        from notes c join tree t on c.parent_note_id = t.id
        where c.user_id = ${userId} and c.deleted_at is null and c.archived_at is null
      )
      select * from tree
      limit ${OUTLINE_LIMIT}`),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          isNull(notes.parentNoteId),
          isNull(notes.deletedAt),
          isNull(notes.archivedAt),
        ),
      ),
  ]);
  return {
    rows: (rows as unknown as TreeRaw[]).map(toRow),
    rootTotal: total[0]?.n ?? 0,
  };
}

/** Every live, unarchived note, for the Tree view and the Move-to picker. */
export async function getOutline(userId: string, limit = OUTLINE_LIMIT): Promise<NoteTreeRow[]> {
  const rows = await db
    .select({
      id: notes.id,
      parentId: notes.parentNoteId,
      title: notes.title,
      emoji: notes.emoji,
      sortOrder: notes.sortOrder,
      depth: notes.depth,
    })
    .from(notes)
    .where(and(eq(notes.userId, userId), isNull(notes.deletedAt), isNull(notes.archivedAt)))
    .orderBy(asc(notes.sortOrder), desc(notes.createdAt))
    .limit(limit);
  return rows;
}

/** The notes above `noteId`, top-level first. Empty for a top-level note or one that isn't theirs. */
export async function getBreadcrumb(userId: string, noteId: string): Promise<NoteCrumbDTO[]> {
  const byNote = await ancestorsFor(userId, [noteId]);
  return byNote.get(noteId) ?? [];
}

/** The titles of each note's ancestors, top-level first, for many notes at once. */
export async function ancestorsFor(
  userId: string,
  ids: readonly string[],
): Promise<Map<string, NoteCrumbDTO[]>> {
  const out = new Map<string, NoteCrumbDTO[]>();
  if (ids.length === 0) return out;
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    with recursive up as (
      select n.id as start_id, n.parent_note_id as anc_id, 1 as lvl
      from notes n
      where n.user_id = ${userId} and n.id in (${list}) and n.parent_note_id is not null
      union all
      select u.start_id, p.parent_note_id, u.lvl + 1
      from up u join notes p on p.id = u.anc_id
      where p.user_id = ${userId} and p.parent_note_id is not null and u.lvl < 6
    )
    select up.start_id, a.id, a.title, a.emoji, up.lvl
    from up join notes a on a.id = up.anc_id and a.user_id = ${userId}
    order by up.start_id, up.lvl desc`)) as unknown as {
    start_id: string;
    id: string;
    title: string;
    emoji: string | null;
  }[];
  for (const row of rows) {
    const list = out.get(row.start_id) ?? [];
    list.push({ id: row.id, title: row.title, emoji: row.emoji });
    out.set(row.start_id, list);
  }
  return out;
}

/** A note's sub-notes in manual order, in every state but Trash (none is ever hidden). */
export async function getChildren(userId: string, noteId: string): Promise<NoteChildDTO[]> {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      emoji: notes.emoji,
      archivedAt: notes.archivedAt,
    })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.parentNoteId, noteId), isNull(notes.deletedAt)))
    .orderBy(asc(notes.sortOrder), desc(notes.createdAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    archived: r.archivedAt !== null,
  }));
}

/**
 * The person's own notes and tasks that link to this note, newest first. A source in Trash is left
 * out, and so is anything that is not theirs.
 */
export async function getBacklinks(userId: string, noteId: string): Promise<BacklinkDTO[]> {
  const rows = (await db.execute(sql`
    select nl.source_type, nl.source_id, nl.snippet,
           coalesce(n.title, t.title) as title, coalesce(n.emoji, t.emoji) as emoji
    from note_links nl
    left join notes n on nl.source_type = 'NOTE' and n.id = nl.source_id
         and n.user_id = ${userId} and n.deleted_at is null
    left join tasks t on nl.source_type = 'TASK' and t.id = nl.source_id
         and t.user_id = ${userId} and t.deleted_at is null
    where nl.target_note_id = ${noteId} and nl.user_id = ${userId}
      and (n.id is not null or t.id is not null)
    order by coalesce(n.updated_at, t.updated_at) desc
    limit 200`)) as unknown as {
    source_type: "NOTE" | "TASK";
    source_id: string;
    snippet: string;
    title: string;
    emoji: string | null;
  }[];
  return rows.map((r) => ({
    kind: r.source_type === "NOTE" ? "note" : "task",
    id: r.source_id,
    title: r.title,
    emoji: r.emoji,
    snippet: r.snippet,
  }));
}

/** How many notes and tasks link here (the number in "Linked from N"). */
export async function countBacklinks(userId: string, noteId: string): Promise<number> {
  return (await getBacklinks(userId, noteId)).length;
}

/**
 * The title, emoji and state of each requested note, for the links and sub-note blocks on a page.
 * A note that is not theirs, or is gone for good, comes back as `missing`.
 */
export async function getNoteMeta(userId: string, ids: readonly string[]): Promise<NoteMeta[]> {
  const unique = [...new Set(ids)].slice(0, 200);
  if (unique.length === 0) return [];
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      emoji: notes.emoji,
      archivedAt: notes.archivedAt,
      deletedAt: notes.deletedAt,
    })
    .from(notes)
    .where(and(eq(notes.userId, userId), inArray(notes.id, unique)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return unique.map((id) => {
    const row = byId.get(id);
    return {
      id,
      title: row?.title ?? "",
      emoji: row?.emoji ?? null,
      state: noteState(row),
    };
  });
}

export type NotePickerHit = PickerCandidate & { archived: boolean };

const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The note picker behind `@` and `[[`: recent notes when nothing is typed, otherwise title matches
 * first and body matches after, never the note being edited, each with its path so two notes with
 * the same title can be told apart. Notes in Trash are not offered.
 */
export async function searchNotesForNoteLink(
  userId: string,
  query: string,
  excludeId?: string | null,
): Promise<NotePickerHit[]> {
  const term = escapeLike(query.trim());
  const pattern = `%${term}%`;
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      emoji: notes.emoji,
      updatedAt: notes.updatedAt,
      archivedAt: notes.archivedAt,
      bodyMatch: term ? sql<boolean>`${notes.contentText} ilike ${pattern}` : sql<boolean>`false`,
    })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        isNull(notes.deletedAt),
        term
          ? sql`(${notes.title} ilike ${pattern} or ${notes.contentText} ilike ${pattern})`
          : undefined,
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(60);

  const paths = await ancestorsFor(
    userId,
    rows.map((r) => r.id),
  );
  const candidates: NotePickerHit[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    updatedAt: r.updatedAt.toISOString(),
    path: (paths.get(r.id) ?? []).map((c) => c.title),
    bodyMatch: r.bodyMatch,
    archived: r.archivedAt !== null,
  }));
  return rankPickerResults(candidates, query, { excludeId }) as NotePickerHit[];
}
