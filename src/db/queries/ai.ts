import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { searchWorkspace } from "@/db/queries/search";
import { aiDailySuggestions, inboxItems, notes, projects, tags, tasks, todos } from "@/db/schema";
import { startOfUserDay, getUserToday, type DayPrefs } from "@/lib/dates/today";
import {
  MAX_CANDIDATES,
  excerptAround,
  type Candidate,
  type ContextItem,
  type RankedCandidate,
} from "@/lib/ai/context";
import type { DailyStats } from "@/lib/ai/prompts";
import { bucketToday } from "@/lib/today/buckets";
import { OPEN_STATUSES } from "@/lib/tasks/status";

// What the AI routes read, always by id AND owner. Nothing here trusts content from the client:
// a route sends an id, and the text comes from these loaders.

/** The most text of one record that is ever sent to a model (technical spec §14). */
export const MAX_INPUT_CHARS = 20_000;
const open = inArray(tasks.status, [...OPEN_STATUSES]);

export async function loadNote(userId: string, id: string) {
  const [row] = await db
    .select({ id: notes.id, title: notes.title, text: notes.contentText })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId), isNull(notes.deletedAt)))
    .limit(1);
  return row ? { ...row, text: row.text.slice(0, MAX_INPUT_CHARS) } : null;
}

export async function loadTask(userId: string, id: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.descriptionText,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      parentTaskId: tasks.parentTaskId,
    })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) return null;
  const subs = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.sortOrder))
    .limit(30);
  return {
    ...row,
    description: row.description ? row.description.slice(0, MAX_INPUT_CHARS) : null,
    subtasks: subs.map((s) => s.title),
  };
}

export async function loadInboxItem(userId: string, id: string) {
  const [row] = await db
    .select({ id: inboxItems.id, text: inboxItems.text })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.id, id),
        eq(inboxItems.userId, userId),
        eq(inboxItems.status, "OPEN"),
        isNull(inboxItems.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Open, past-due tasks, oldest first. Same "overdue" as the Today page. */
export async function loadOverdueTasks(userId: string, prefs: DayPrefs, limit = 25) {
  const today = getUserToday(prefs);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.archivedAt),
        isNull(tasks.parentTaskId),
        open,
        isNotNull(tasks.dueDate),
        lte(tasks.dueDate, today),
      ),
    )
    .orderBy(asc(tasks.dueDate))
    .limit(200);
  return bucketToday(rows, prefs)
    .overdue.slice(0, limit)
    .map((r) => ({
      id: r.id,
      title: r.title,
      dueDate: r.dueDate!,
      priority: r.priority,
    }));
}

/** Deterministic numbers for the daily card. No titles ever leave the database for this. */
export async function loadDailyStats(userId: string, prefs: DayPrefs): Promise<DailyStats> {
  const now = new Date();
  const today = getUserToday(prefs, now);
  const dayStart = startOfUserDay(prefs, now);
  const yesterdayStart = startOfUserDay(prefs, new Date(dayStart.getTime() - 3_600_000 * 12));
  const base = and(eq(tasks.userId, userId), isNull(tasks.deletedAt), isNull(tasks.archivedAt));

  const [dated, high, done] = await Promise.all([
    db
      .select({ status: tasks.status, dueDate: tasks.dueDate, dueTime: tasks.dueTime })
      .from(tasks)
      .where(and(base, open, isNotNull(tasks.dueDate), lte(tasks.dueDate, today))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(base, open, eq(tasks.priority, "HIGH"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          base,
          eq(tasks.status, "DONE"),
          gte(tasks.completedAt, yesterdayStart),
          lt(tasks.completedAt, dayStart),
        ),
      ),
  ]);
  const buckets = bucketToday(dated, prefs, now);
  return {
    overdue: buckets.overdue.length,
    dueToday: buckets.today.length + buckets.later.length,
    highPriority: high[0]?.n ?? 0,
    completedYesterday: done[0]?.n ?? 0,
  };
}

export async function getDailySuggestion(userId: string, localDate: string) {
  const [row] = await db
    .select()
    .from(aiDailySuggestions)
    .where(and(eq(aiDailySuggestions.userId, userId), eq(aiDailySuggestions.localDate, localDate)))
    .limit(1);
  return row ?? null;
}

/** Inserts today's suggestion, or replaces it and counts the refresh. */
export async function saveDailySuggestion(
  userId: string,
  localDate: string,
  text: string,
  refreshed: boolean,
): Promise<void> {
  await db
    .insert(aiDailySuggestions)
    .values({ userId, localDate, text, refreshCount: refreshed ? 1 : 0 })
    .onConflictDoUpdate({
      target: [aiDailySuggestions.userId, aiDailySuggestions.localDate],
      set: {
        text,
        createdAt: new Date(),
        refreshCount: refreshed ? sql`${aiDailySuggestions.refreshCount} + 1` : sql`0`,
      },
    });
}

// ---- Ask my workspace: retrieval ------------------------------------------------------------

type Prefs = DayPrefs;

/**
 * Candidates for a question: each keyword is searched with the same lexical search as the Search
 * page (owner-scoped, Trash excluded), and what comes back is merged by record.
 */
export async function findCandidates(
  userId: string,
  keywords: string[],
  prefs: Prefs,
): Promise<Candidate[]> {
  const perKeyword = Math.max(4, Math.ceil(MAX_CANDIDATES / Math.max(keywords.length, 1)));
  const results = await Promise.all(
    keywords.map((q) =>
      searchWorkspace(
        userId,
        { q, tab: "all", status: null, projectId: null, tagId: null, from: null, to: null },
        prefs,
        perKeyword,
      ),
    ),
  );

  const merged = new Map<string, Candidate>();
  results.forEach((result, i) => {
    const keyword = keywords[i]!;
    for (const hit of [
      ...result.task,
      ...result.todo,
      ...result.note,
      ...result.project,
      ...result.tag,
    ]) {
      const key = `${hit.type}:${hit.id}`;
      const entry = merged.get(key) ?? {
        type: hit.type,
        id: hit.id,
        title: hit.title,
        href: hit.href,
        updatedAt: hit.updatedAt,
        projectId: hit.project?.id ?? null,
        matched: [],
        titleMatched: [],
      };
      entry.matched.push(keyword);
      if (hit.title.toLocaleLowerCase().includes(keyword)) entry.titleMatched.push(keyword);
      merged.set(key, entry);
    }
  });
  return [...merged.values()].slice(0, MAX_CANDIDATES * 2);
}

/** Loads the text of the chosen items, by id and owner, and trims it around the keywords. */
export async function loadContextItems(
  userId: string,
  chosen: RankedCandidate[],
  keywords: string[],
): Promise<ContextItem[]> {
  const ids = (type: Candidate["type"]) => chosen.filter((c) => c.type === type).map((c) => c.id);
  const [t, d, n, p, g] = await Promise.all([
    ids("task").length
      ? db
          .select({
            id: tasks.id,
            body: sql<string>`concat_ws(E'\n', 'Status: ' || ${tasks.status}, 'Due: ' || ${tasks.dueDate}, ${tasks.descriptionText})`,
          })
          .from(tasks)
          .where(
            and(eq(tasks.userId, userId), isNull(tasks.deletedAt), inArray(tasks.id, ids("task"))),
          )
      : [],
    ids("todo").length
      ? db
          .select({
            id: todos.id,
            body: sql<string>`concat_ws(E'\n', case when ${todos.isComplete} then 'Done' else 'Open' end, 'Due: ' || ${todos.dueDate})`,
          })
          .from(todos)
          .where(
            and(eq(todos.userId, userId), isNull(todos.deletedAt), inArray(todos.id, ids("todo"))),
          )
      : [],
    ids("note").length
      ? db
          .select({ id: notes.id, body: notes.contentText })
          .from(notes)
          .where(
            and(eq(notes.userId, userId), isNull(notes.deletedAt), inArray(notes.id, ids("note"))),
          )
      : [],
    ids("project").length
      ? db
          .select({
            id: projects.id,
            body: sql<string>`concat_ws(E'\n', 'Status: ' || ${projects.status}, ${projects.description})`,
          })
          .from(projects)
          .where(
            and(
              eq(projects.userId, userId),
              isNull(projects.deletedAt),
              inArray(projects.id, ids("project")),
            ),
          )
      : [],
    ids("tag").length
      ? db
          .select({ id: tags.id, body: tags.name })
          .from(tags)
          .where(and(eq(tags.userId, userId), inArray(tags.id, ids("tag"))))
      : [],
  ]);

  const bodies = new Map<string, string>();
  for (const [type, rows] of [
    ["task", t],
    ["todo", d],
    ["note", n],
    ["project", p],
    ["tag", g],
  ] as const) {
    for (const row of rows) bodies.set(`${type}:${row.id}`, row.body ?? "");
  }

  // Keep the ranked order; an item that vanished or isn't the person's simply isn't included.
  return chosen.flatMap((c) => {
    const body = bodies.get(`${c.type}:${c.id}`);
    if (body === undefined) return [];
    return [
      {
        type: c.type,
        id: c.id,
        title: c.title,
        href: c.href,
        body: excerptAround(body, keywords),
      },
    ];
  });
}
