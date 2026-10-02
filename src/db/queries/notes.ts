import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { projectRefsFor, tagsForNotes } from "@/db/queries/meta";
import { notes, taskNotes, tasks } from "@/db/schema";
import { makeSnippet, type NoteDTO, type NoteListItemDTO } from "@/lib/notes/dto";
import { SNIPPET_LENGTH } from "@/lib/notes/dto";

export type NoteFilters = {
  /** A project id, or "none" for notes with no (visible) project. */
  projectId?: string | "none";
  tagId?: string;
};

function filterConditions(userId: string, filters: NoteFilters) {
  const out = [];
  if (filters.projectId === "none") {
    out.push(
      sql`("notes"."project_id" is null or not exists (select 1 from projects p where p.id = "notes"."project_id" and p.user_id = ${userId} and p.deleted_at is null))`,
    );
  } else if (filters.projectId) {
    out.push(
      sql`("notes"."project_id" = ${filters.projectId} and exists (select 1 from projects p where p.id = "notes"."project_id" and p.user_id = ${userId} and p.deleted_at is null))`,
    );
  }
  if (filters.tagId) {
    out.push(
      sql`exists (select 1 from note_tags nt where nt.note_id = "notes"."id" and nt.tag_id = ${filters.tagId} and nt.user_id = ${userId})`,
    );
  }
  return out;
}

/**
 * Notes for the list, most recently updated first. Only a short slice of the text is read from the
 * database; the document itself (`content_json`) is never sent in a list.
 */
export async function listNotes(
  userId: string,
  options: { archived?: boolean; limit?: number } & NoteFilters = {},
): Promise<NoteListItemDTO[]> {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      emoji: notes.emoji,
      projectId: notes.projectId,
      updatedAt: notes.updatedAt,
      archivedAt: notes.archivedAt,
      head: sql<string>`left(${notes.contentText}, ${SNIPPET_LENGTH * 3})`,
    })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        isNull(notes.deletedAt),
        options.archived ? isNotNull(notes.archivedAt) : isNull(notes.archivedAt),
        ...filterConditions(userId, options),
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(options.limit ?? 500);

  const [refs, tagMap] = await Promise.all([
    projectRefsFor(
      db,
      userId,
      rows.map((r) => r.projectId),
    ),
    tagsForNotes(
      db,
      userId,
      rows.map((r) => r.id),
    ),
  ]);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    snippet: makeSnippet(r.head),
    updatedAt: r.updatedAt.toISOString(),
    archived: r.archivedAt !== null,
    project: (r.projectId && refs.get(r.projectId)) || null,
    tags: tagMap.get(r.id) ?? [],
  }));
}

/** How many notes there are in total (not deleted), split by archived, under the same filters. */
export async function countNotes(
  userId: string,
  filters: NoteFilters = {},
): Promise<{ active: number; archived: number }> {
  const [row] = await db
    .select({
      active: sql<number>`count(*) filter (where ${notes.archivedAt} is null)::int`,
      archived: sql<number>`count(*) filter (where ${notes.archivedAt} is not null)::int`,
    })
    .from(notes)
    .where(
      and(eq(notes.userId, userId), isNull(notes.deletedAt), ...filterConditions(userId, filters)),
    );
  return { active: row?.active ?? 0, archived: row?.archived ?? 0 };
}

/** One note with its document, tags and linked tasks (open ones first). Null if it isn't theirs. */
export async function getNote(userId: string, id: string): Promise<NoteDTO | null> {
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId), isNull(notes.deletedAt)))
    .limit(1);
  if (!row) return null;

  const [refs, tagMap, linked] = await Promise.all([
    projectRefsFor(db, userId, [row.projectId]),
    tagsForNotes(db, userId, [row.id]),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        emoji: tasks.emoji,
        status: tasks.status,
        dueDate: tasks.dueDate,
      })
      .from(taskNotes)
      .innerJoin(tasks, eq(tasks.id, taskNotes.taskId))
      .where(
        and(
          eq(taskNotes.noteId, id),
          eq(taskNotes.userId, userId),
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
        ),
      )
      .orderBy(asc(taskNotes.createdAt)),
  ]);

  const linkedTasks = linked
    .map((t) => ({
      id: t.id,
      title: t.title,
      emoji: t.emoji,
      isDone: t.status === "DONE" || t.status === "CANCELLED",
      dueDate: t.dueDate,
    }))
    .sort((a, b) => Number(a.isDone) - Number(b.isDone));

  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    contentJson: row.contentJson,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archived: row.archivedAt !== null,
    project: (row.projectId && refs.get(row.projectId)) || null,
    tags: tagMap.get(row.id) ?? [],
    tasks: linkedTasks,
  };
}

/** Candidates for "Link a note" on a task: the person's own notes, matched by title. */
export async function searchNotesForLinking(
  userId: string,
  query: string,
  limit = 8,
): Promise<{ id: string; title: string; emoji: string | null }[]> {
  const term = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return db
    .select({ id: notes.id, title: notes.title, emoji: notes.emoji })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        isNull(notes.deletedAt),
        term ? sql`${notes.title} ilike ${`%${term}%`}` : undefined,
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(limit);
}

/** Candidates for "Link a task" on a note: open or recent tasks matched by title. */
export async function searchTasksForLinking(
  userId: string,
  query: string,
  limit = 8,
): Promise<{ id: string; title: string; emoji: string | null; dueDate: string | null }[]> {
  const term = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return db
    .select({ id: tasks.id, title: tasks.title, emoji: tasks.emoji, dueDate: tasks.dueDate })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.parentTaskId),
        term ? sql`${tasks.title} ilike ${`%${term}%`}` : undefined,
      ),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);
}
