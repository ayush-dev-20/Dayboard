import "server-only";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  featureEpochs,
  inboxItems,
  notes,
  projects,
  taskScheduleHistory,
  tasks,
  todos,
} from "@/db/schema";
import { busyWindows } from "@/lib/calendar/planning";
import { getStatus } from "@/lib/calendar/store";
import { plainNotes } from "@/db/queries/note-filters";
import { addDays } from "@/lib/dates/calendar";
import { getUserToday, type DayPrefs } from "@/lib/dates/today";
import { env } from "@/lib/env";
import { OPEN_STATUSES } from "@/lib/tasks/status";
import { computeFacts, type FactsInput } from "./facts";
import { LIMITS, type ReviewFacts } from "./types";
import { dayStartInstant, weekWindow, type Week } from "./week";

// Reads one person's data for one week and assembles the facts (V2 feature 15 §4). Every query is scoped to the
// person; nothing reads a note body; the calendar is read only when one is connected and a calendar is selected.

type Activity = Map<string, { completed: number; tasksCreated: number; notesCreated: number }>;

async function activityBetween(userId: string, from: Date, to: Date): Promise<Activity> {
  const out: Activity = new Map();
  const bump = (
    id: string | null,
    key: "completed" | "tasksCreated" | "notesCreated",
    n: number,
  ) => {
    if (!id) return;
    const row = out.get(id) ?? { completed: 0, tasksCreated: 0, notesCreated: 0 };
    row[key] += n;
    out.set(id, row);
  };
  const [done, madeTasks, madeNotes] = await Promise.all([
    db
      .select({ id: tasks.projectId, n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          eq(tasks.status, "DONE"),
          gte(tasks.completedAt, from),
          lt(tasks.completedAt, to),
        ),
      )
      .groupBy(tasks.projectId),
    db
      .select({ id: tasks.projectId, n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          gte(tasks.createdAt, from),
          lt(tasks.createdAt, to),
        ),
      )
      .groupBy(tasks.projectId),
    db
      .select({ id: notes.projectId, n: count() })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          // A daily journal entry is not a note the person made in a project.
          plainNotes,
          isNull(notes.deletedAt),
          gte(notes.createdAt, from),
          lt(notes.createdAt, to),
        ),
      )
      .groupBy(notes.projectId),
  ]);
  for (const r of done) bump(r.id, "completed", r.n);
  for (const r of madeTasks) bump(r.id, "tasksCreated", r.n);
  for (const r of madeNotes) bump(r.id, "notesCreated", r.n);
  return out;
}

async function calendarBusy(userId: string, from: Date, to: Date, timeZone: string) {
  if (!env.calendarAvailable) return null;
  const status = await getStatus(userId);
  // Nothing connected, or no calendar selected: the review has no calendar fact at all.
  if (!status.accounts.some((a) => a.calendars.some((c) => c.selected))) return null;
  return busyWindows(userId, from, to, timeZone);
}

export async function loadFactsInput(
  userId: string,
  week: Week,
  prefs: DayPrefs,
  now: Date,
): Promise<{ input: FactsInput; names: Map<string, string> }> {
  const { from, to } = weekWindow(week, prefs);
  const today = getUserToday(prefs, now);
  const quietFrom = dayStartInstant(addDays(week.start, -14), prefs);
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 3_600_000);

  const [
    doneTasksByProject,
    doneTodosByProject,
    recentTasks,
    recentTodos,
    openDue,
    openDueCounts,
    noteCount,
    noteTitles,
    noteEdits,
    projectRows,
    weekActivity,
    recentActivity,
    busy,
    epoch,
    moved,
    inboxMade,
    inboxConverted,
    inboxArchived,
  ] = await Promise.all([
    db
      .select({ id: tasks.projectId, n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          eq(tasks.status, "DONE"),
          gte(tasks.completedAt, from),
          lt(tasks.completedAt, to),
        ),
      )
      .groupBy(tasks.projectId),
    db
      .select({ id: todos.projectId, n: count() })
      .from(todos)
      .where(
        and(
          eq(todos.userId, userId),
          isNull(todos.deletedAt),
          eq(todos.isComplete, true),
          gte(todos.completedAt, from),
          lt(todos.completedAt, to),
        ),
      )
      .groupBy(todos.projectId),
    db
      .select({ id: tasks.id, title: tasks.title, at: tasks.completedAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          eq(tasks.status, "DONE"),
          gte(tasks.completedAt, from),
          lt(tasks.completedAt, to),
        ),
      )
      .orderBy(desc(tasks.completedAt))
      .limit(LIMITS.completedTitles),
    db
      .select({ id: todos.id, title: todos.title, at: todos.completedAt })
      .from(todos)
      .where(
        and(
          eq(todos.userId, userId),
          isNull(todos.deletedAt),
          eq(todos.isComplete, true),
          gte(todos.completedAt, from),
          lt(todos.completedAt, to),
        ),
      )
      .orderBy(desc(todos.completedAt))
      .limit(LIMITS.completedTitles),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueDate: tasks.dueDate,
        projectId: tasks.projectId,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
          inArray(tasks.status, [...OPEN_STATUSES]),
          isNotNull(tasks.dueDate),
          lte(tasks.dueDate, week.end),
        ),
      )
      .orderBy(tasks.dueDate, tasks.createdAt)
      .limit(LIMITS.overdueItems),
    db
      .select({
        total: count(),
        carried: sql<number>`count(*) filter (where ${tasks.dueDate} >= ${week.start})::int`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
          inArray(tasks.status, [...OPEN_STATUSES]),
          isNotNull(tasks.dueDate),
          lte(tasks.dueDate, week.end),
        ),
      ),
    db
      .select({ n: count() })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          plainNotes,
          isNull(notes.deletedAt),
          gte(notes.createdAt, from),
          lt(notes.createdAt, to),
        ),
      ),
    db
      .select({ id: notes.id, title: notes.title })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          plainNotes,
          isNull(notes.deletedAt),
          gte(notes.createdAt, from),
          lt(notes.createdAt, to),
        ),
      )
      .orderBy(desc(notes.createdAt))
      .limit(LIMITS.noteTitles),
    db
      .select({ n: count() })
      .from(notes)
      .where(
        and(
          eq(notes.userId, userId),
          plainNotes,
          isNull(notes.deletedAt),
          gte(notes.updatedAt, from),
          lt(notes.updatedAt, to),
          lt(notes.createdAt, from),
        ),
      ),
    db
      .select({ id: projects.id, name: projects.name, createdAt: projects.createdAt })
      .from(projects)
      .where(
        and(eq(projects.userId, userId), isNull(projects.deletedAt), eq(projects.status, "ACTIVE")),
      ),
    activityBetween(userId, from, to),
    activityBetween(userId, quietFrom, to),
    calendarBusy(userId, from, to, prefs.timezone),
    db
      .select({ at: featureEpochs.startedAt })
      .from(featureEpochs)
      .where(eq(featureEpochs.name, "task_schedule_history"))
      .limit(1),
    db
      .select({ taskId: taskScheduleHistory.taskId, n: count() })
      .from(taskScheduleHistory)
      .where(
        and(
          eq(taskScheduleHistory.userId, userId),
          gte(taskScheduleHistory.changedAt, fourWeeksAgo),
          isNotNull(taskScheduleHistory.fromDate),
          sql`${taskScheduleHistory.toDate} > ${taskScheduleHistory.fromDate}`,
        ),
      )
      .groupBy(taskScheduleHistory.taskId)
      .having(sql`count(*) >= 2`),
    db
      .select({ n: count() })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, userId),
          isNull(inboxItems.deletedAt),
          gte(inboxItems.createdAt, from),
          lt(inboxItems.createdAt, to),
        ),
      ),
    db
      .select({ n: count() })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, userId),
          isNull(inboxItems.deletedAt),
          gte(inboxItems.convertedAt, from),
          lt(inboxItems.convertedAt, to),
        ),
      ),
    db
      .select({ n: count() })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, userId),
          isNull(inboxItems.deletedAt),
          eq(inboxItems.status, "ARCHIVED"),
          gte(inboxItems.updatedAt, from),
          lt(inboxItems.updatedAt, to),
        ),
      ),
  ]);

  // Titles of the postponed tasks (a deleted task is not worth mentioning).
  const postponedTitles = moved.length
    ? await db
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(
          and(
            eq(tasks.userId, userId),
            isNull(tasks.deletedAt),
            inArray(
              tasks.id,
              moved.map((m) => m.taskId),
            ),
          ),
        )
    : [];
  const titleOf = new Map(postponedTitles.map((t) => [t.id, t.title]));

  const byProject = new Map<string | null, number>();
  for (const r of [...doneTasksByProject, ...doneTodosByProject]) {
    byProject.set(r.id, (byProject.get(r.id) ?? 0) + r.n);
  }
  const names = new Map(projectRows.map((p) => [p.id, p.name]));
  // A project that is no longer active can still have been worked on: name it from the whole table.
  const missing = [...byProject.keys()].filter((id): id is string => id !== null && !names.has(id));
  if (missing.length > 0) {
    const rows = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.userId, userId), inArray(projects.id, missing)));
    for (const r of rows) names.set(r.id, r.name);
  }

  const recent = [
    ...recentTasks.map((r) => ({ type: "task" as const, id: r.id, title: r.title, at: r.at! })),
    ...recentTodos.map((r) => ({ type: "todo" as const, id: r.id, title: r.title, at: r.at! })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, LIMITS.completedTitles);

  const recentlyActive = new Set([...recentActivity.keys()]);
  const input: FactsInput = {
    week,
    today,
    prefs,
    now,
    completedTaskCount: doneTasksByProject.reduce((n, r) => n + r.n, 0),
    completedTodoCount: doneTodosByProject.reduce((n, r) => n + r.n, 0),
    completedByProject: [...byProject].map(([projectId, n]) => ({ projectId, count: n })),
    recentCompleted: recent.map((r) => ({
      type: r.type,
      id: r.id,
      title: r.title,
      completedAt: r.at,
    })),
    openDue: openDue.map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate!,
      projectId: t.projectId,
    })),
    openDueTotal: openDueCounts[0]?.total ?? 0,
    openCarriedTotal: openDueCounts[0]?.carried ?? 0,
    notesCreatedTotal: noteCount[0]?.n ?? 0,
    notesCreated: noteTitles.map((n) => ({ id: n.id, title: n.title || "Untitled" })),
    notesEdited: noteEdits[0]?.n ?? 0,
    projects: projectRows,
    activity: [...weekActivity].map(([projectId, a]) => ({ projectId, ...a })),
    activeRecently: recentlyActive,
    busy,
    historyStartedAt: epoch[0]?.at ?? null,
    postponed: moved
      .filter((m) => titleOf.has(m.taskId))
      .map((m) => ({ taskId: m.taskId, title: titleOf.get(m.taskId)!, count: m.n })),
    inboxCaptured: inboxMade[0]?.n ?? 0,
    inboxProcessed: (inboxConverted[0]?.n ?? 0) + (inboxArchived[0]?.n ?? 0),
  };
  return { input, names };
}

export async function buildFacts(
  userId: string,
  week: Week,
  prefs: DayPrefs,
  now: Date = new Date(),
): Promise<ReviewFacts> {
  const { input, names } = await loadFactsInput(userId, week, prefs, now);
  return computeFacts(input, names);
}

/** Whether the week had anything in it: a quiet week with nothing done and nothing written is not reviewed. */
export const weekHadActivity = (facts: ReviewFacts): boolean =>
  facts.completed.tasks + facts.completed.todos + facts.notes.created > 0;
