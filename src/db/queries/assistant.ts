import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { findCandidates, loadContextItems } from "@/db/queries/ai";
import { notes, projects, taskNotes, tasks } from "@/db/schema";
import { extractKeywords, rankCandidates } from "@/lib/ai/context";
import type {
  ContextRef,
  CreateRow,
  LinkRow,
  Proposal,
  TaskPriority,
  TaskStatusName,
  UpdateRow,
} from "@/lib/ai/assistant-types";
import { buildScope, inScope, type Scope } from "@/lib/ai/assistant/scope";
import { READ_CHARS } from "@/lib/ai/assistant/registry";
import { getUserToday, type DayPrefs } from "@/lib/dates/today";
import { AppError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { OPEN_STATUSES } from "@/lib/tasks/status";
import type { ProposalBody } from "@/lib/validations/assistant";

// What the assistant's tools read (feature 11 §4). Every function takes the signed-in person's id and
// filters on it, and (when the person pointed the assistant at items) on the scope, so a tool can
// never reach an id that is not theirs or not in scope. Nothing here writes.

export type ItemType = "note" | "task" | "project";

export type LoadedItem = {
  type: ItemType;
  id: string;
  title: string;
  href: string;
  /** The text the model sees, already cut to `READ_CHARS`. */
  body: string;
};

export const hrefFor = (type: ItemType, id: string) =>
  type === "note" ? `/notes/${id}` : type === "task" ? `/tasks?task=${id}` : `/projects/${id}`;

const MEMBER_LIST_MAX = 100;

const lines = (parts: (string | null | undefined | false)[]) =>
  parts.filter((p): p is string => typeof p === "string" && p !== "").join("\n");

// ---- One item, in full -------------------------------------------------------------------------

/** One note, task or project of the person's, or null when it is missing, in Trash or not theirs. */
export async function readItem(
  userId: string,
  type: ItemType,
  id: string,
): Promise<(LoadedItem & { members?: { tasks: string[]; notes: string[] } }) | null> {
  if (type === "note") {
    const [row] = await db
      .select({ id: notes.id, title: notes.title, text: notes.contentText })
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId), isNull(notes.deletedAt)))
      .limit(1);
    return row
      ? {
          type,
          id,
          title: row.title || "Untitled",
          href: hrefFor(type, id),
          body: row.text.slice(0, READ_CHARS),
        }
      : null;
  }

  if (type === "task") {
    const [row] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.descriptionText,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        project: projects.name,
      })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!row) return null;
    const subs = await db
      .select({ title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.sortOrder))
      .limit(30);
    const body = lines([
      `Status: ${row.status}`,
      `Priority: ${row.priority}`,
      `Due: ${row.dueDate ?? "none"}`,
      row.project ? `Project: ${row.project}` : null,
      row.description,
      subs.length ? `Subtasks: ${subs.map((s) => `${s.title} (${s.status})`).join("; ")}` : null,
    ]);
    return { type, id, title: row.title, href: hrefFor(type, id), body: body.slice(0, READ_CHARS) };
  }

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
    })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) return null;
  const [memberTasks, memberNotes] = await Promise.all([
    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.projectId, id),
          isNull(tasks.deletedAt),
          isNull(tasks.parentTaskId),
        ),
      )
      .orderBy(desc(tasks.updatedAt))
      .limit(MEMBER_LIST_MAX),
    db
      .select({ id: notes.id, title: notes.title })
      .from(notes)
      .where(and(eq(notes.userId, userId), eq(notes.projectId, id), isNull(notes.deletedAt)))
      .orderBy(desc(notes.updatedAt))
      .limit(MEMBER_LIST_MAX),
  ]);
  const body = lines([
    `Status: ${project.status}`,
    project.description,
    memberTasks.length
      ? `Tasks: ${memberTasks.map((t) => `${t.title} (${t.status}${t.dueDate ? `, due ${t.dueDate}` : ""})`).join("; ")}`
      : "Tasks: none",
    memberNotes.length
      ? `Notes: ${memberNotes.map((n) => n.title || "Untitled").join("; ")}`
      : "Notes: none",
  ]);
  return {
    type,
    id,
    title: project.name,
    href: hrefFor(type, id),
    body: body.slice(0, READ_CHARS),
    members: { tasks: memberTasks.map((t) => t.id), notes: memberNotes.map((n) => n.id) },
  };
}

// ---- The items a person pointed the assistant at -----------------------------------------------

/**
 * Loads each pointed-at item by id and owner. Any id that is missing, in Trash or not theirs is the
 * same `NOT_FOUND`, and the turn does not run (feature 11 §4).
 */
export async function loadScope(
  userId: string,
  refs: ContextRef[],
): Promise<{ items: LoadedItem[]; scope: Scope }> {
  const loaded = await Promise.all(refs.map((ref) => readItem(userId, ref.type, ref.id)));
  if (loaded.some((item) => item === null)) throw new AppError("NOT_FOUND");
  const items = loaded as NonNullable<(typeof loaded)[number]>[];
  const members = { tasks: [] as string[], notes: [] as string[] };
  for (const item of items) {
    members.tasks.push(...(item.members?.tasks ?? []));
    members.notes.push(...(item.members?.notes ?? []));
  }
  return {
    items: items.map((item) => ({
      type: item.type,
      id: item.id,
      title: item.title,
      href: item.href,
      body: item.body,
    })),
    scope: buildScope(refs, members),
  };
}

// ---- Search ------------------------------------------------------------------------------------

export type FoundItem = LoadedItem & { terms: string[] };

/**
 * The V1 lexical search the Search page and Ask use, as a tool: the question's keywords, owner-scoped
 * candidates (Trash excluded), ranked, with a short excerpt of each. Todos and tags are left out:
 * the assistant answers about notes, tasks and projects. (Feature 10 will replace the retrieval here
 * with hybrid search; the shape returned stays the same.)
 */
export async function searchItems(
  userId: string,
  query: string,
  prefs: DayPrefs,
  options: { types?: ItemType[]; scope: Scope | null; limit?: number },
): Promise<{ keywords: string[]; items: FoundItem[] }> {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return { keywords, items: [] };
  const candidates = await findCandidates(userId, keywords, prefs);
  const allowed = new Set<string>(options.types ?? ["note", "task", "project"]);
  const ranked = rankCandidates(
    candidates.filter((c) => allowed.has(c.type) && inScope(options.scope, c.type, c.id)),
  ).slice(0, options.limit ?? 8);
  if (ranked.length === 0) return { keywords, items: [] };
  const withBodies = await loadContextItems(userId, ranked, keywords);
  const byKey = new Map(ranked.map((r) => [`${r.type}:${r.id}`, r]));
  return {
    keywords,
    items: withBodies.map((item) => ({
      type: item.type as ItemType,
      id: item.id,
      title: item.title,
      href: item.href,
      body: item.body,
      terms: byKey.get(`${item.type}:${item.id}`)?.matched ?? [],
    })),
  };
}

// ---- Tasks by simple filters -------------------------------------------------------------------

export type TaskListFilter = "open" | "overdue" | "dueToday";

export type ListedTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  project: string | null;
};

export async function listTasksFor(
  userId: string,
  prefs: DayPrefs,
  options: { filter: TaskListFilter; projectId?: string; scope: Scope | null; limit: number },
): Promise<ListedTask[]> {
  const today = getUserToday(prefs);
  if (options.scope && options.scope.task.size === 0) return [];
  const conditions = [
    eq(tasks.userId, userId),
    isNull(tasks.deletedAt),
    isNull(tasks.archivedAt),
    isNull(tasks.parentTaskId),
    inArray(tasks.status, [...OPEN_STATUSES]),
  ];
  if (options.filter === "overdue") conditions.push(lt(tasks.dueDate, today));
  if (options.filter === "dueToday") conditions.push(eq(tasks.dueDate, today));
  if (options.projectId) conditions.push(eq(tasks.projectId, options.projectId));
  if (options.scope) conditions.push(inArray(tasks.id, [...options.scope.task]));
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      project: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(...conditions))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.sortOrder))
    .limit(options.limit);
}

// ---- Related items -----------------------------------------------------------------------------

/** Words that make a title or text distinctive: the same keyword rules as Ask, from the item itself. */
export function relatedKeywords(title: string, body: string, max = 6): string[] {
  return extractKeywords(`${title} ${body.slice(0, 600)}`, max);
}

/**
 * Notes and tasks that share words with an item, excluding the item and what it is already linked to.
 * Keyword-based for now (feature 10 will bring meaning-based neighbours); the reasons are the shared
 * words, recorded here and not written by a model.
 */
export async function findRelatedItems(
  userId: string,
  type: "note" | "task",
  id: string,
  prefs: DayPrefs,
  options: { scope: Scope | null; limit?: number },
): Promise<{ item: LoadedItem; related: FoundItem[] } | null> {
  const item = await readItem(userId, type, id);
  if (!item) return null;
  const keywords = relatedKeywords(item.title, item.body);
  if (keywords.length === 0) return { item, related: [] };

  const linked = await linkedIds(userId, type, id);
  const candidates = await findCandidates(userId, keywords, prefs);
  const ranked = rankCandidates(
    candidates.filter(
      (c) =>
        (c.type === "note" || c.type === "task") &&
        !(c.type === type && c.id === id) &&
        !linked.has(`${c.type}:${c.id}`) &&
        inScope(options.scope, c.type, c.id),
    ),
  )
    // One shared word is a coincidence; two or more is a reason.
    .filter((c) => c.matched.length >= Math.min(2, keywords.length))
    .slice(0, options.limit ?? 5);
  if (ranked.length === 0) return { item, related: [] };
  const withBodies = await loadContextItems(userId, ranked, keywords);
  const byKey = new Map(ranked.map((r) => [`${r.type}:${r.id}`, r]));
  return {
    item,
    related: withBodies.map((r) => ({
      type: r.type as ItemType,
      id: r.id,
      title: r.title,
      href: r.href,
      body: r.body,
      terms: byKey.get(`${r.type}:${r.id}`)?.matched ?? [],
    })),
  };
}

/** `note:<id>` / `task:<id>` of everything already linked to the item. */
async function linkedIds(userId: string, type: "note" | "task", id: string): Promise<Set<string>> {
  const rows =
    type === "task"
      ? await db
          .select({ other: taskNotes.noteId })
          .from(taskNotes)
          .where(and(eq(taskNotes.userId, userId), eq(taskNotes.taskId, id)))
      : await db
          .select({ other: taskNotes.taskId })
          .from(taskNotes)
          .where(and(eq(taskNotes.userId, userId), eq(taskNotes.noteId, id)));
  return new Set(rows.map((r) => `${type === "task" ? "note" : "task"}:${r.other}`));
}

// ---- Chips and the picker ----------------------------------------------------------------------

/** Titles for ids a client holds (a drop, a menu item). Anything missing or not theirs is left out. */
export async function describeItems(
  userId: string,
  refs: ContextRef[],
): Promise<{ type: ItemType; id: string; title: string }[]> {
  const ids = (type: ItemType) => refs.filter((r) => r.type === type).map((r) => r.id);
  const [n, t, p] = await Promise.all([
    ids("note").length
      ? db
          .select({ id: notes.id, title: notes.title })
          .from(notes)
          .where(
            and(eq(notes.userId, userId), isNull(notes.deletedAt), inArray(notes.id, ids("note"))),
          )
      : [],
    ids("task").length
      ? db
          .select({ id: tasks.id, title: tasks.title })
          .from(tasks)
          .where(
            and(eq(tasks.userId, userId), isNull(tasks.deletedAt), inArray(tasks.id, ids("task"))),
          )
      : [],
    ids("project").length
      ? db
          .select({ id: projects.id, title: projects.name })
          .from(projects)
          .where(
            and(
              eq(projects.userId, userId),
              isNull(projects.deletedAt),
              inArray(projects.id, ids("project")),
            ),
          )
      : [],
  ]);
  const found = new Map<string, string>();
  for (const row of n) found.set(`note:${row.id}`, row.title || "Untitled");
  for (const row of t) found.set(`task:${row.id}`, row.title);
  for (const row of p) found.set(`project:${row.id}`, row.title);
  // Keep the order the client sent.
  return refs.flatMap((ref) => {
    const title = found.get(`${ref.type}:${ref.id}`);
    return title === undefined ? [] : [{ type: ref.type, id: ref.id, title }];
  });
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/** The "Add item…" picker: the person's notes, tasks and projects by title, most recent first. */
export async function findPickerItems(
  userId: string,
  query: string,
  limit = 8,
): Promise<{ type: ItemType; id: string; title: string }[]> {
  const q = query.trim();
  const like = q ? `%${escapeLike(q)}%` : null;
  const per = Math.ceil(limit * 1.5);
  const [n, t, p] = await Promise.all([
    db
      .select({ id: notes.id, title: notes.title, at: notes.updatedAt })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          isNull(notes.deletedAt),
          like ? ilike(notes.title, like) : undefined,
        ),
      )
      .orderBy(desc(notes.updatedAt))
      .limit(per),
    db
      .select({ id: tasks.id, title: tasks.title, at: tasks.updatedAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          isNull(tasks.parentTaskId),
          like ? ilike(tasks.title, like) : undefined,
        ),
      )
      .orderBy(desc(tasks.updatedAt))
      .limit(per),
    db
      .select({ id: projects.id, title: projects.name, at: projects.updatedAt })
      .from(projects)
      .where(
        and(
          eq(projects.userId, userId),
          isNull(projects.deletedAt),
          like ? ilike(projects.name, like) : undefined,
        ),
      )
      .orderBy(desc(projects.updatedAt))
      .limit(per),
  ]);
  return [
    ...n.map((r) => ({ type: "note" as const, id: r.id, title: r.title || "Untitled", at: r.at })),
    ...t.map((r) => ({ type: "task" as const, id: r.id, title: r.title, at: r.at })),
    ...p.map((r) => ({ type: "project" as const, id: r.id, title: r.title, at: r.at })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit)
    .map(({ type, id, title }) => ({ type, id, title }));
}

// ---- Checking a proposal, and showing it -------------------------------------------------------

type TaskRow = {
  id: string;
  title: string;
  status: TaskStatusName;
  priority: TaskPriority;
  dueDate: string | null;
  projectName: string | null;
};

/**
 * Turns what the model proposed into a proposal the person can review: every id must be theirs (and
 * live), titles and names come from the database, and `before` is what each task is now. Throws
 * `VALIDATION_ERROR` for an id that is not theirs, so the model is told and nothing is shown.
 */
export async function buildProposal(userId: string, body: ProposalBody): Promise<Proposal> {
  const id = uuidv7();
  const taskIds = new Set<string>();
  const noteIds = new Set<string>();
  const projectIds = new Set<string>();
  if (body.kind === "createTasks") {
    for (const item of body.items) {
      if (item.linkNoteId) noteIds.add(item.linkNoteId);
      if (item.projectId) projectIds.add(item.projectId);
    }
  } else if (body.kind === "updateTasks") {
    for (const change of body.changes) {
      taskIds.add(change.taskId);
      if (change.set.projectId) projectIds.add(change.set.projectId);
    }
  } else {
    for (const link of body.links) {
      taskIds.add(link.taskId);
      noteIds.add(link.noteId);
    }
  }

  const [taskRows, noteRows, projectRows] = await Promise.all([
    taskIds.size
      ? db
          .select({
            id: tasks.id,
            title: tasks.title,
            status: tasks.status,
            priority: tasks.priority,
            dueDate: tasks.dueDate,
            projectName: projects.name,
          })
          .from(tasks)
          .leftJoin(projects, eq(projects.id, tasks.projectId))
          .where(
            and(eq(tasks.userId, userId), isNull(tasks.deletedAt), inArray(tasks.id, [...taskIds])),
          )
      : [],
    noteIds.size
      ? db
          .select({ id: notes.id, title: notes.title })
          .from(notes)
          .where(
            and(eq(notes.userId, userId), isNull(notes.deletedAt), inArray(notes.id, [...noteIds])),
          )
      : [],
    projectIds.size
      ? db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(
            and(
              eq(projects.userId, userId),
              isNull(projects.deletedAt),
              inArray(projects.id, [...projectIds]),
            ),
          )
      : [],
  ]);
  const taskById = new Map<string, TaskRow>(taskRows.map((r) => [r.id, r as TaskRow]));
  const noteById = new Map(noteRows.map((r) => [r.id, r.title || "Untitled"]));
  const projectById = new Map(projectRows.map((r) => [r.id, r.name]));
  const missing =
    [...taskIds].some((x) => !taskById.has(x)) ||
    [...noteIds].some((x) => !noteById.has(x)) ||
    [...projectIds].some((x) => !projectById.has(x));
  if (missing) {
    throw new AppError("VALIDATION_ERROR", "One of those items is not in the workspace.");
  }

  if (body.kind === "createTasks") {
    const items: CreateRow[] = body.items.map((item) => ({
      title: item.title,
      dueDate: item.dueDate ?? null,
      priority: item.priority ?? "NONE",
      projectId: item.projectId ?? null,
      projectName: item.projectId ? (projectById.get(item.projectId) ?? null) : null,
      linkNoteId: item.linkNoteId ?? null,
      linkNoteTitle: item.linkNoteId ? (noteById.get(item.linkNoteId) ?? null) : null,
    }));
    return { id, kind: "createTasks", items };
  }
  if (body.kind === "updateTasks") {
    const changes: UpdateRow[] = body.changes.map((change) => {
      const task = taskById.get(change.taskId)!;
      return {
        taskId: task.id,
        title: task.title,
        set: change.set,
        before: {
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          projectName: task.projectName,
        },
        projectName: change.set.projectId ? (projectById.get(change.set.projectId) ?? null) : null,
      };
    });
    return { id, kind: "updateTasks", changes };
  }
  const links: LinkRow[] = body.links.map((link) => ({
    taskId: link.taskId,
    taskTitle: taskById.get(link.taskId)!.title,
    noteId: link.noteId,
    noteTitle: noteById.get(link.noteId)!,
  }));
  return { id, kind: "linkNotes", links };
}
