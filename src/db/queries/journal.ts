import "server-only";
import { and, count, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { projectRefsFor } from "@/db/queries/meta";
import { journalEntries } from "@/db/queries/note-filters";
import { getNote } from "@/db/queries/notes";
import { notes, tasks, todos } from "@/db/schema";
import { dayBounds } from "@/lib/dates/journal";
import { getUserToday, type DayPrefs } from "@/lib/dates/today";
import {
  DONE_LIMIT,
  JOURNAL_PAGE,
  SIDEBAR_ENTRIES,
  type DoneItem,
  type DoneOnDay,
  type JournalEntryRow,
  type JournalSidebarEntry,
  type JournalTarget,
} from "@/lib/journal/dto";
import { makeSnippet, SNIPPET_LENGTH, type NoteDTO } from "@/lib/notes/dto";

// Reads of the journal (V3 feature 02 §4). Every one is scoped to the signed-in person. "Done on this day" is
// worked out here when a page opens and is never stored in the note.

/** One entry with its document, or null when it is not theirs, is in Trash or is an ordinary note. */
export async function getJournalEntry(userId: string, id: string): Promise<NoteDTO | null> {
  const note = await getNote(userId, id);
  return note?.journalDate ? note : null;
}

/** How many tasks and todos were completed on each of the given days, in one query. */
export async function countDoneByDay(
  userId: string,
  dates: readonly string[],
  prefs: DayPrefs,
): Promise<Map<string, number>> {
  const unique = [...new Set(dates)];
  const out = new Map<string, number>(unique.map((d) => [d, 0]));
  if (unique.length === 0) return out;
  const days = unique.map((date) => {
    const { start, end } = dayBounds(date, prefs);
    return sql`(${date}::date, ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz)`;
  });
  const rows = (await db.execute(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(*)::int from tasks t
         where t.user_id = ${userId} and t.status = 'DONE' and t.deleted_at is null
           and (t.kind <> 'STICKY' or exists (select 1 from canvases c where c.id = t.board_canvas_id and c.deleted_at is null and c.archived_at is null))
           and t.completed_at >= d.starts and t.completed_at < d.ends)
      + (select count(*)::int from todos o
         where o.user_id = ${userId} and o.is_complete and o.deleted_at is null
           and o.completed_at >= d.starts and o.completed_at < d.ends) as n
    from (values ${sql.join(days, sql`, `)}) as d(day, starts, ends)`)) as unknown as {
    day: string;
    n: number;
  }[];
  for (const r of rows) out.set(r.day, r.n);
  return out;
}

/**
 * What was completed on `date`: tasks (archived and sub-tasks included, each completed occurrence of a repeating
 * task is its own row) and todos, never anything in Trash, never anything marked not done again. In the order
 * they were completed, capped, with the true total.
 */
export async function getDoneOnDay(
  userId: string,
  date: string,
  prefs: DayPrefs,
): Promise<DoneOnDay> {
  const { start, end } = dayBounds(date, prefs);
  const parent = sql`(select p.title from tasks p where p.id = ${tasks.parentTaskId})`;
  const [taskRows, todoRows, [taskTotal], [todoTotal]] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        emoji: tasks.emoji,
        projectId: tasks.projectId,
        completedAt: tasks.completedAt,
        parentTitle: sql<string | null>`${parent}`,
        boardId: tasks.boardCanvasId,
        boardTitle: sql<
          string | null
        >`(select c.title from canvases c where c.id = ${tasks.boardCanvasId})`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.status, "DONE"),
          isNull(tasks.deletedAt),
          // A sticky note counts too, unless its board is in Trash or archived.
          sql`(${tasks.kind} <> 'STICKY' or exists (select 1 from canvases c where c.id = ${tasks.boardCanvasId} and c.deleted_at is null and c.archived_at is null))`,
          sql`${tasks.completedAt} >= ${start.toISOString()}::timestamptz`,
          sql`${tasks.completedAt} < ${end.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(tasks.completedAt, tasks.id)
      .limit(DONE_LIMIT),
    db
      .select({
        id: todos.id,
        title: todos.title,
        emoji: todos.emoji,
        projectId: todos.projectId,
        completedAt: todos.completedAt,
        dueDate: todos.dueDate,
      })
      .from(todos)
      .where(
        and(
          eq(todos.userId, userId),
          eq(todos.isComplete, true),
          isNull(todos.deletedAt),
          sql`${todos.completedAt} >= ${start.toISOString()}::timestamptz`,
          sql`${todos.completedAt} < ${end.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(todos.completedAt, todos.id)
      .limit(DONE_LIMIT),
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.status, "DONE"),
          isNull(tasks.deletedAt),
          // A sticky note counts too, unless its board is in Trash or archived.
          sql`(${tasks.kind} <> 'STICKY' or exists (select 1 from canvases c where c.id = ${tasks.boardCanvasId} and c.deleted_at is null and c.archived_at is null))`,
          sql`${tasks.completedAt} >= ${start.toISOString()}::timestamptz`,
          sql`${tasks.completedAt} < ${end.toISOString()}::timestamptz`,
        ),
      ),
    db
      .select({ n: count() })
      .from(todos)
      .where(
        and(
          eq(todos.userId, userId),
          eq(todos.isComplete, true),
          isNull(todos.deletedAt),
          sql`${todos.completedAt} >= ${start.toISOString()}::timestamptz`,
          sql`${todos.completedAt} < ${end.toISOString()}::timestamptz`,
        ),
      ),
  ]);

  const refs = await projectRefsFor(db, userId, [
    ...taskRows.map((r) => r.projectId),
    ...todoRows.map((r) => r.projectId),
  ]);
  const items: DoneItem[] = [
    ...taskRows.map((r) => ({
      type: "task" as const,
      id: r.id,
      title: r.title,
      emoji: r.emoji,
      project: (r.projectId && refs.get(r.projectId)) || null,
      completedAt: r.completedAt!.toISOString(),
      parentTitle: r.parentTitle,
      dueDate: null,
      board: r.boardId ? { id: r.boardId, title: r.boardTitle ?? "" } : null,
    })),
    ...todoRows.map((r) => ({
      type: "todo" as const,
      id: r.id,
      title: r.title,
      emoji: r.emoji,
      project: (r.projectId && refs.get(r.projectId)) || null,
      completedAt: r.completedAt!.toISOString(),
      parentTitle: null,
      dueDate: r.dueDate,
      board: null,
    })),
  ].sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));

  return {
    items: items.slice(0, DONE_LIMIT),
    total: (taskTotal?.n ?? 0) + (todoTotal?.n ?? 0),
  };
}

/**
 * The person's entries, newest day first, 30 to a page. `before` is the date of the last row of the previous
 * page. With `archived`, the archived ones instead (they collapse into a group at the bottom of the list).
 */
export async function listJournalEntries(
  userId: string,
  prefs: DayPrefs,
  options: { before?: string | null; archived?: boolean; limit?: number } = {},
): Promise<{ items: JournalEntryRow[]; next: string | null }> {
  const limit = options.limit ?? JOURNAL_PAGE;
  const rows = await db
    .select({
      id: notes.id,
      date: notes.journalDate,
      title: notes.title,
      emoji: notes.emoji,
      archivedAt: notes.archivedAt,
      head: sql<string>`left(${notes.contentText}, ${SNIPPET_LENGTH * 3})`,
    })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        journalEntries,
        isNull(notes.deletedAt),
        options.archived ? isNotNull(notes.archivedAt) : isNull(notes.archivedAt),
        options.before ? lt(notes.journalDate, options.before) : undefined,
      ),
    )
    .orderBy(desc(notes.journalDate))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const counts = await countDoneByDay(
    userId,
    page.map((r) => r.date!),
    prefs,
  );
  return {
    items: page.map((r) => ({
      id: r.id,
      date: r.date!,
      title: r.title,
      firstLine: makeSnippet(r.head),
      emoji: r.emoji,
      archived: r.archivedAt !== null,
      doneCount: counts.get(r.date!) ?? 0,
    })),
    next: rows.length > limit ? (page[page.length - 1]?.date ?? null) : null,
  };
}

/** The latest entries for the sidebar section (unarchived, newest day first). */
export async function listSidebarEntries(
  userId: string,
  limit = SIDEBAR_ENTRIES,
): Promise<JournalSidebarEntry[]> {
  const rows = await db
    .select({
      id: notes.id,
      date: notes.journalDate,
      head: sql<string>`left(${notes.contentText}, ${SNIPPET_LENGTH})`,
    })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        journalEntries,
        isNull(notes.deletedAt),
        isNull(notes.archivedAt),
      ),
    )
    .orderBy(desc(notes.journalDate))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, date: r.date!, firstLine: makeSnippet(r.head) }));
}

/** Today's entry (if any) and how much has been completed today. The server decides the day. */
export async function getJournalTarget(
  userId: string,
  prefs: DayPrefs,
  now: Date = new Date(),
): Promise<JournalTarget> {
  const date = getUserToday(prefs, now);
  const [[entry], counts] = await Promise.all([
    db
      .select({ id: notes.id, archivedAt: notes.archivedAt })
      .from(notes)
      .where(and(eq(notes.userId, userId), eq(notes.journalDate, date), isNull(notes.deletedAt)))
      .limit(1),
    countDoneByDay(userId, [date], prefs),
  ]);
  return {
    date,
    entryId: entry?.id ?? null,
    archived: Boolean(entry?.archivedAt),
    doneCount: counts.get(date) ?? 0,
  };
}
