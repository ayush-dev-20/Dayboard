import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ensureDefaultViews, listViews } from "@/db/mutations/views";
import { projectRefsFor, tagsForNotes, taskMetaFor } from "@/db/queries/meta";
import { subtaskDone, subtaskTotal } from "@/db/queries/tasks";
import { notes, tasks, todos } from "@/db/schema";
import { makeSnippet, SNIPPET_LENGTH } from "@/lib/notes/dto";
import { toTaskDTO, toTodoDTO } from "@/lib/tasks/dto";
import { OPEN_STATUSES } from "@/lib/tasks/status";
import type { ViewNote, ViewTask, ViewTodo } from "@/lib/views/items";
import { withQuickFilters } from "@/lib/views/quick";
import { itemScope } from "@/lib/views/scope";
import type { Collection, ViewDTO, ViewFilter } from "@/lib/views/types";

// Views for a page render: a collection's tabs, never empty (feature doc §2, "a client that finds
// none creates the default").
export async function getViews(userId: string, collection: Collection): Promise<ViewDTO[]> {
  const views = await listViews(userId, collection);
  if (views.length > 0) return views;
  await ensureDefaultViews(userId, db);
  return listViews(userId, collection);
}

// ---- The items views work on (V2 feature 06 §4) -------------------------------------------------
// Each collection is read in full (up to a cap) and handed to the view engine, which filters, sorts
// and groups it. The only things decided here are the coarse ones that keep the read small: whether
// archived items and finished items are wanted at all, and a project scope.

/** Most items read per collection. A view shows 50 at a time; this is the pool it works from. */
export const VIEW_ITEM_LIMIT = 2000;
/** Finished tasks and todos are the most recent of these (the rest stay in the Completed count). */
export const VIEW_CLOSED_LIMIT = 500;

export type ViewItemScope = {
  /** Only archived items (a view that filters on archived), instead of only live ones. */
  archivedOnly?: boolean;
  /** Include finished items. Off when no filter and no board column could show them. */
  includeClosed?: boolean;
  /** A project page: only this project's items. */
  projectId?: string;
};

const projectCondition = (
  column: typeof tasks.projectId | typeof todos.projectId | typeof notes.projectId,
  scope: ViewItemScope,
) => (scope.projectId ? eq(column, scope.projectId) : undefined);

const noteCount = sql<number>`(select count(*)::int from task_notes tn join notes n on n.id = tn.note_id where tn.task_id = "tasks"."id" and n.deleted_at is null)`;

export async function listTasksForViews(
  userId: string,
  scope: ViewItemScope = {},
): Promise<ViewTask[]> {
  const base = (statusCondition: ReturnType<typeof inArray>) =>
    and(
      eq(tasks.userId, userId),
      isNull(tasks.deletedAt),
      isNull(tasks.parentTaskId),
      scope.archivedOnly ? isNotNull(tasks.archivedAt) : isNull(tasks.archivedAt),
      projectCondition(tasks.projectId, scope),
      statusCondition,
    );

  const select = () =>
    db
      .select({ task: tasks, total: subtaskTotal, done: subtaskDone, notes: noteCount })
      .from(tasks);

  const [open, closed] = await Promise.all([
    select()
      .where(base(inArray(tasks.status, [...OPEN_STATUSES])))
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
      .limit(VIEW_ITEM_LIMIT),
    scope.includeClosed
      ? select()
          .where(base(inArray(tasks.status, ["DONE", "CANCELLED"])))
          .orderBy(sql`${tasks.completedAt} desc nulls last`, desc(tasks.updatedAt))
          .limit(VIEW_CLOSED_LIMIT)
      : Promise.resolve([]),
  ]);

  const rows = [...open, ...closed];
  const meta = await taskMetaFor(
    db,
    userId,
    rows.map((r) => ({ id: r.task.id, projectId: r.task.projectId })),
  );
  return rows.map((r) => ({
    ...toTaskDTO(r.task, { total: r.total, done: r.done }, meta.get(r.task.id)),
    noteCount: r.notes,
  }));
}

export async function listTodosForViews(
  userId: string,
  scope: ViewItemScope = {},
): Promise<ViewTodo[]> {
  const base = (complete: boolean) =>
    and(
      eq(todos.userId, userId),
      isNull(todos.deletedAt),
      eq(todos.isComplete, complete),
      scope.archivedOnly ? isNotNull(todos.archivedAt) : isNull(todos.archivedAt),
      projectCondition(todos.projectId, scope),
    );

  const [open, closed] = await Promise.all([
    db
      .select()
      .from(todos)
      .where(base(false))
      .orderBy(asc(todos.sortOrder), asc(todos.createdAt))
      .limit(VIEW_ITEM_LIMIT),
    scope.includeClosed
      ? db
          .select()
          .from(todos)
          .where(base(true))
          .orderBy(sql`${todos.completedAt} desc nulls last`)
          .limit(VIEW_CLOSED_LIMIT)
      : Promise.resolve([]),
  ]);
  const rows = [...open, ...closed];
  const refs = await projectRefsFor(
    db,
    userId,
    rows.map((r) => r.projectId),
  );
  return rows.map((r) => toTodoDTO(r, (r.projectId && refs.get(r.projectId)) || null));
}

const linkedTaskCount = sql<number>`(select count(*)::int from task_notes tn join tasks t on t.id = tn.task_id where tn.note_id = "notes"."id" and t.deleted_at is null)`;

export async function listNotesForViews(
  userId: string,
  scope: ViewItemScope = {},
): Promise<ViewNote[]> {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      emoji: notes.emoji,
      projectId: notes.projectId,
      sortOrder: notes.sortOrder,
      version: notes.version,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      archivedAt: notes.archivedAt,
      head: sql<string>`left(${notes.contentText}, ${SNIPPET_LENGTH * 3})`,
      // The first picture block at the top of the text: the gallery shows it as the cover.
      cover: sql<
        string | null
      >`jsonb_path_query_first(${notes.contentJson}, '$.content[*] ? (@.type == "image").attrs.attachmentId') #>> '{}'`,
      taskCount: linkedTaskCount,
    })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        isNull(notes.deletedAt),
        scope.archivedOnly ? isNotNull(notes.archivedAt) : isNull(notes.archivedAt),
        // The views list top-level notes; sub-notes are reached through their parent, the sidebar
        // tree and the Tree view (feature 07).
        isNull(notes.parentNoteId),
        projectCondition(notes.projectId, scope),
      ),
    )
    .orderBy(asc(notes.sortOrder), desc(notes.updatedAt))
    .limit(VIEW_ITEM_LIMIT);

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
    cover: r.cover,
    updatedAt: r.updatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    archived: r.archivedAt !== null,
    sortOrder: r.sortOrder,
    version: r.version,
    taskCount: r.taskCount,
    project: (r.projectId && refs.get(r.projectId)) || null,
    tags: tagMap.get(r.id) ?? [],
  }));
}

/**
 * The items one view needs, read with the scope its effective settings call for (the view's own
 * filters with the URL's quick filters laid over them): finished and archived items only when a
 * filter or board column could show them, and a project page's own project.
 */
export async function loadViewItems(
  userId: string,
  collection: Collection,
  view: ViewDTO,
  quick: ViewFilter[],
  projectId: string | null,
): Promise<ViewTask[] | ViewTodo[] | ViewNote[]> {
  const effective = withQuickFilters(view.config, quick);
  const scope = {
    ...itemScope(collection, view.type, effective),
    ...(projectId ? { projectId } : {}),
  };
  if (collection === "TASKS") return listTasksForViews(userId, scope);
  if (collection === "TODOS") return listTodosForViews(userId, scope);
  return listNotesForViews(userId, scope);
}
