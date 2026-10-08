import "server-only";
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { projectRefsFor } from "@/db/queries/meta";
import { ancestorsFor } from "@/db/queries/note-tree";
import { notes, projects, tags, tasks, todos } from "@/db/schema";
import { dueInstant, type DayPrefs } from "@/lib/dates/today";
import { addDays } from "@/lib/dates/calendar";
import { containsPattern, prefixPattern } from "@/lib/search/query";
import { buildSnippet } from "@/lib/search/snippet";
import type { SearchHit, SearchParams, SearchResults, SearchType } from "@/lib/search/types";
import type { TaskStatus } from "@/lib/tasks/status";

// Lexical search with ILIKE on bounded fields, always scoped to the signed-in person and never
// returning anything in Trash. Archived items are included and labelled. See feature doc §5.

const WINDOW = 260;
const EMPTY: SearchResults = { task: [], todo: [], note: [], project: [], tag: [], total: 0 };

/** Position-based window of body text around the first match, cut in SQL so a long note isn't shipped. */
const windowOf = (body: SQL | AnyPgColumn, q: string) =>
  sql<string | null>`case when position(lower(${q}) in lower(${body})) > 0
    then substr(${body}, greatest(position(lower(${q}) in lower(${body})) - 100, 1), ${WINDOW}) end`;

/** 0 exact title, 1 title prefix, 2 title contains, 3 body only. */
const rankOf = (title: SQL | AnyPgColumn, q: string) =>
  sql<number>`case when lower(${title}) = lower(${q}) then 0
    when ${title} ilike ${prefixPattern(q)} then 1
    when ${title} ilike ${containsPattern(q)} then 2 else 3 end`;

type Instants = { from: Date | null; toExclusive: Date | null };

function instants(params: SearchParams, prefs: DayPrefs): Instants {
  return {
    from: params.from ? dueInstant(params.from, null, prefs.timezone) : null,
    toExclusive: params.to ? dueInstant(addDays(params.to, 1), null, prefs.timezone) : null,
  };
}

function hit(
  partial: Partial<SearchHit> & Pick<SearchHit, "type" | "id" | "title" | "href" | "updatedAt">,
): SearchHit {
  return {
    emoji: null,
    archived: false,
    project: null,
    snippet: null,
    path: [],
    status: null,
    dueDate: null,
    done: false,
    taskCount: 0,
    noteCount: 0,
    ...partial,
  };
}

async function searchTasks(userId: string, p: SearchParams, limit: number): Promise<SearchHit[]> {
  const q = p.q;
  const projectCond =
    p.projectId === "none"
      ? sql`(${tasks.projectId} is null or not exists (select 1 from projects pr where pr.id = ${tasks.projectId} and pr.user_id = ${userId} and pr.deleted_at is null))`
      : p.projectId
        ? eq(tasks.projectId, p.projectId)
        : undefined;

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      emoji: tasks.emoji,
      status: tasks.status,
      archivedAt: tasks.archivedAt,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
      updatedAt: tasks.updatedAt,
      rank: rankOf(tasks.title, q),
      window: windowOf(sql`coalesce(${tasks.descriptionText}, '')`, q),
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        or(
          ilike(tasks.title, containsPattern(q)),
          ilike(tasks.descriptionText, containsPattern(q)),
        ),
        p.status ? eq(tasks.status, p.status as TaskStatus) : undefined,
        projectCond,
        p.tagId
          ? sql`exists (select 1 from task_tags tt where tt.task_id = ${tasks.id} and tt.tag_id = ${p.tagId} and tt.user_id = ${userId})`
          : undefined,
        p.from ? sql`${tasks.dueDate} >= ${p.from}` : undefined,
        p.to ? sql`${tasks.dueDate} <= ${p.to}` : undefined,
      ),
    )
    .orderBy(rankOf(tasks.title, q), desc(tasks.updatedAt))
    .limit(limit);

  const refs = await projectRefsFor(
    db,
    userId,
    rows.map((r) => r.projectId),
  );
  return rows.map((r) =>
    hit({
      type: "task",
      id: r.id,
      title: r.title,
      emoji: r.emoji,
      href: `/tasks?task=${r.id}`,
      archived: r.archivedAt !== null,
      project: (r.projectId && refs.get(r.projectId)) || null,
      snippet: r.rank === 3 && r.window ? buildSnippet(r.window, q) : null,
      status: r.status,
      dueDate: r.dueDate,
      done: r.status === "DONE" || r.status === "CANCELLED",
      updatedAt: r.updatedAt.toISOString(),
    }),
  );
}

async function searchTodos(userId: string, p: SearchParams, limit: number): Promise<SearchHit[]> {
  const q = p.q;
  const projectCond =
    p.projectId === "none"
      ? sql`(${todos.projectId} is null or not exists (select 1 from projects pr where pr.id = ${todos.projectId} and pr.user_id = ${userId} and pr.deleted_at is null))`
      : p.projectId
        ? eq(todos.projectId, p.projectId)
        : undefined;
  const rows = await db
    .select({
      id: todos.id,
      title: todos.title,
      emoji: todos.emoji,
      isComplete: todos.isComplete,
      archivedAt: todos.archivedAt,
      dueDate: todos.dueDate,
      projectId: todos.projectId,
      updatedAt: todos.updatedAt,
    })
    .from(todos)
    .where(
      and(
        eq(todos.userId, userId),
        isNull(todos.deletedAt),
        ilike(todos.title, containsPattern(q)),
        projectCond,
        p.from ? sql`${todos.dueDate} >= ${p.from}` : undefined,
        p.to ? sql`${todos.dueDate} <= ${p.to}` : undefined,
      ),
    )
    .orderBy(rankOf(todos.title, q), desc(todos.updatedAt))
    .limit(limit);
  const refs = await projectRefsFor(
    db,
    userId,
    rows.map((r) => r.projectId),
  );
  return rows.map((r) =>
    hit({
      type: "todo",
      id: r.id,
      title: r.title,
      emoji: r.emoji,
      href: "/tasks?view=todos",
      archived: r.archivedAt !== null,
      project: (r.projectId && refs.get(r.projectId)) || null,
      dueDate: r.dueDate,
      done: r.isComplete,
      updatedAt: r.updatedAt.toISOString(),
    }),
  );
}

async function searchNotes(
  userId: string,
  p: SearchParams,
  prefs: DayPrefs,
  limit: number,
): Promise<SearchHit[]> {
  const q = p.q;
  const { from, toExclusive } = instants(p, prefs);
  const projectCond =
    p.projectId === "none"
      ? sql`(${notes.projectId} is null or not exists (select 1 from projects pr where pr.id = ${notes.projectId} and pr.user_id = ${userId} and pr.deleted_at is null))`
      : p.projectId
        ? eq(notes.projectId, p.projectId)
        : undefined;
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      emoji: notes.emoji,
      archivedAt: notes.archivedAt,
      projectId: notes.projectId,
      updatedAt: notes.updatedAt,
      rank: rankOf(notes.title, q),
      window: windowOf(sql`${notes.contentText}`, q),
    })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        isNull(notes.deletedAt),
        or(ilike(notes.title, containsPattern(q)), ilike(notes.contentText, containsPattern(q))),
        projectCond,
        p.tagId
          ? sql`exists (select 1 from note_tags nt where nt.note_id = ${notes.id} and nt.tag_id = ${p.tagId} and nt.user_id = ${userId})`
          : undefined,
        from ? sql`${notes.updatedAt} >= ${from.toISOString()}::timestamptz` : undefined,
        toExclusive
          ? sql`${notes.updatedAt} < ${toExclusive.toISOString()}::timestamptz`
          : undefined,
      ),
    )
    .orderBy(rankOf(notes.title, q), desc(notes.updatedAt))
    .limit(limit);
  const [refs, paths] = await Promise.all([
    projectRefsFor(
      db,
      userId,
      rows.map((r) => r.projectId),
    ),
    ancestorsFor(
      userId,
      rows.map((r) => r.id),
    ),
  ]);
  return rows.map((r) =>
    hit({
      type: "note",
      id: r.id,
      title: r.title || "Untitled",
      emoji: r.emoji,
      href: `/notes/${r.id}`,
      archived: r.archivedAt !== null,
      project: (r.projectId && refs.get(r.projectId)) || null,
      path: (paths.get(r.id) ?? []).map((c) => c.title),
      snippet: r.rank === 3 && r.window ? buildSnippet(r.window, q) : null,
      updatedAt: r.updatedAt.toISOString(),
    }),
  );
}

async function searchProjects(
  userId: string,
  p: SearchParams,
  prefs: DayPrefs,
  limit: number,
): Promise<SearchHit[]> {
  const q = p.q;
  const { from, toExclusive } = instants(p, prefs);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      color: projects.color,
      status: projects.status,
      archivedAt: projects.archivedAt,
      updatedAt: projects.updatedAt,
      rank: rankOf(projects.name, q),
      window: windowOf(sql`coalesce(${projects.description}, '')`, q),
    })
    .from(projects)
    .where(
      and(
        eq(projects.userId, userId),
        isNull(projects.deletedAt),
        or(
          ilike(projects.name, containsPattern(q)),
          ilike(projects.description, containsPattern(q)),
        ),
        p.projectId && p.projectId !== "none" ? eq(projects.id, p.projectId) : undefined,
        from ? sql`${projects.updatedAt} >= ${from.toISOString()}::timestamptz` : undefined,
        toExclusive
          ? sql`${projects.updatedAt} < ${toExclusive.toISOString()}::timestamptz`
          : undefined,
      ),
    )
    .orderBy(rankOf(projects.name, q), desc(projects.updatedAt))
    .limit(limit);
  return rows.map((r) =>
    hit({
      type: "project",
      id: r.id,
      title: r.name,
      href: `/projects/${r.id}`,
      archived: r.archivedAt !== null,
      project: { id: r.id, name: r.name, color: r.color, status: r.status },
      snippet: r.rank === 3 && r.window ? buildSnippet(r.window, q) : null,
      updatedAt: r.updatedAt.toISOString(),
    }),
  );
}

async function searchTags(userId: string, p: SearchParams, limit: number): Promise<SearchHit[]> {
  const q = p.q;
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      updatedAt: tags.updatedAt,
      taskCount: sql<number>`(select count(*)::int from task_tags tt join tasks t on t.id = tt.task_id where tt.tag_id = "tags"."id" and t.deleted_at is null and t.user_id = ${userId})`,
      noteCount: sql<number>`(select count(*)::int from note_tags nt join notes n on n.id = nt.note_id where nt.tag_id = "tags"."id" and n.deleted_at is null and n.user_id = ${userId})`,
    })
    .from(tags)
    .where(and(eq(tags.userId, userId), ilike(tags.name, containsPattern(q))))
    .orderBy(rankOf(tags.name, q), desc(tags.updatedAt))
    .limit(limit);
  return rows.map((r) =>
    hit({
      type: "tag",
      id: r.id,
      title: r.name,
      // A tag match leads to its tasks; its notes are one more click away.
      href: `/tasks?tag=${r.id}`,
      taskCount: r.taskCount,
      noteCount: r.noteCount,
      updatedAt: r.updatedAt.toISOString(),
    }),
  );
}

/**
 * Searches everything the person owns. Filters narrow what applies to each type: a status means
 * tasks only (nothing else has a task status), a tag means tasks and notes, a project means tasks,
 * todos, notes and that project itself.
 */
export async function searchWorkspace(
  userId: string,
  params: SearchParams,
  prefs: DayPrefs,
  limitPerType: number,
): Promise<SearchResults> {
  const { tab, status, tagId, projectId, from, to } = params;
  const want = (type: SearchType) => tab === "all" || tab === type;
  const hasDate = Boolean(from || to);

  const [t, d, n, pr, tg] = await Promise.all([
    want("task") ? searchTasks(userId, params, limitPerType) : [],
    want("todo") && !status && !tagId ? searchTodos(userId, params, limitPerType) : [],
    want("note") && !status ? searchNotes(userId, params, prefs, limitPerType) : [],
    want("project") && !status && !tagId ? searchProjects(userId, params, prefs, limitPerType) : [],
    tab === "all" && !status && !tagId && !projectId && !hasDate
      ? searchTags(userId, params, limitPerType)
      : [],
  ]);
  return {
    task: t,
    todo: d,
    note: n,
    project: pr,
    tag: tg,
    total: t.length + d.length + n.length + pr.length + tg.length,
  };
}

export { EMPTY as NO_RESULTS };

/** What the command menu shows before anything is typed: the five most recently updated tasks and notes. */
export async function recentItems(userId: string, limit = 5): Promise<SearchHit[]> {
  const [t, n] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        emoji: tasks.emoji,
        status: tasks.status,
        archivedAt: tasks.archivedAt,
        projectId: tasks.projectId,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt), isNull(tasks.parentTaskId)))
      .orderBy(desc(tasks.updatedAt))
      .limit(limit),
    db
      .select({
        id: notes.id,
        title: notes.title,
        emoji: notes.emoji,
        archivedAt: notes.archivedAt,
        projectId: notes.projectId,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(and(eq(notes.userId, userId), isNull(notes.deletedAt)))
      .orderBy(desc(notes.updatedAt))
      .limit(limit),
  ]);
  const [refs, paths] = await Promise.all([
    projectRefsFor(db, userId, [...t.map((r) => r.projectId), ...n.map((r) => r.projectId)]),
    ancestorsFor(
      userId,
      n.map((r) => r.id),
    ),
  ]);
  const all = [
    ...t.map((r) =>
      hit({
        type: "task",
        id: r.id,
        title: r.title,
        emoji: r.emoji,
        href: `/tasks?task=${r.id}`,
        archived: r.archivedAt !== null,
        project: (r.projectId && refs.get(r.projectId)) || null,
        status: r.status,
        updatedAt: r.updatedAt.toISOString(),
      }),
    ),
    ...n.map((r) =>
      hit({
        type: "note",
        id: r.id,
        title: r.title || "Untitled",
        emoji: r.emoji,
        href: `/notes/${r.id}`,
        archived: r.archivedAt !== null,
        project: (r.projectId && refs.get(r.projectId)) || null,
        path: (paths.get(r.id) ?? []).map((c) => c.title),
        updatedAt: r.updatedAt.toISOString(),
      }),
    ),
  ];
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}
