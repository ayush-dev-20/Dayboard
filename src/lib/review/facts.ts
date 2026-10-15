import { addDays, daysBetween } from "@/lib/dates/calendar";
import { dueInstant, type DayPrefs } from "@/lib/dates/today";
import { FACTS_VERSION, LIMITS, type ProjectCount, type ReviewFacts } from "./types";
import type { Week } from "./week";

// The facts of a week, assembled from rows the loader read for this person alone (V2 feature 15 §4). Pure: no
// database, no model. Nothing here ever touches a note body; a fact is shown only if it could be computed.

export type Interval = { start: Date; end: Date };

export type FactsInput = {
  week: Week;
  /** The person's current day, "YYYY-MM-DD". */
  today: string;
  prefs: DayPrefs;
  now: Date;
  completedTaskCount: number;
  completedTodoCount: number;
  /** Counts per project (null for no project) of what was completed in the week, tasks and todos together. */
  completedByProject: { projectId: string | null; count: number }[];
  /** Most recently completed first. Only the first ten are kept. */
  recentCompleted: { type: "task" | "todo"; id: string; title: string; completedAt: Date }[];
  /** Open tasks due on or before the end of the week, oldest due date first. */
  openDue: { id: string; title: string; dueDate: string; projectId: string | null }[];
  openDueTotal: number;
  /** Of those, how many fall due inside the week (the rest were already late when it began). */
  openCarriedTotal: number;
  notesCreatedTotal: number;
  /** Newest first. */
  notesCreated: { id: string; title: string }[];
  notesEdited: number;
  /** Active, not deleted, with when they were made. */
  projects: { id: string; name: string; createdAt: Date }[];
  /** Activity in the week, per project. */
  activity: { projectId: string; completed: number; tasksCreated: number; notesCreated: number }[];
  /** Projects with any activity in the three weeks that end with this one. */
  activeRecently: Set<string>;
  /** Merged busy intervals of the whole week, or null when no calendar is connected. */
  busy: Interval[] | null;
  /** When schedule history began, or null if nothing has been recorded yet. */
  historyStartedAt: Date | null;
  postponed: { taskId: string; title: string; count: number }[];
  inboxCaptured: number;
  inboxProcessed: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const HOUR = 3_600_000;

/** The days of a week, "YYYY-MM-DD", first to last. */
export function daysOf(week: Week): string[] {
  const out: string[] = [];
  for (let d = week.start; d <= week.end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Hours booked on each day, counting only the part of an interval that falls on that calendar day. */
export function meetingHoursByDay(
  busy: Interval[],
  days: string[],
  timeZone: string,
): { date: string; hours: number }[] {
  return days.map((date) => {
    const from = dueInstant(date, null, timeZone).getTime();
    const to = dueInstant(addDays(date, 1), null, timeZone).getTime();
    let ms = 0;
    for (const slot of busy) {
      const start = Math.max(slot.start.getTime(), from);
      const end = Math.min(slot.end.getTime(), to);
      if (end > start) ms += end - start;
    }
    return { date, hours: round1(ms / HOUR) };
  });
}

/** Days of schedule history needed before "moved later twice" means anything (V2 feature 15 §4). */
export const MIN_HISTORY_DAYS = 14;

export function computeFacts(input: FactsInput, projectNames: Map<string, string>): ReviewFacts {
  const { week, today, prefs, now } = input;
  // A finished week is measured on its last day, an unfinished one on today.
  const asOf = today < week.end ? today : week.end;

  const byProject: ProjectCount[] = input.completedByProject
    .map((row) => ({
      projectId: row.projectId,
      name: row.projectId ? (projectNames.get(row.projectId) ?? null) : null,
      count: row.count,
    }))
    .sort((a, b) => b.count - a.count || (a.name ?? "").localeCompare(b.name ?? ""));

  const days = daysOf(week);
  let calendar: ReviewFacts["calendar"] = null;
  if (input.busy) {
    const perDay = meetingHoursByDay(input.busy, days, prefs.timezone);
    const total = round1(perDay.reduce((sum, d) => sum + d.hours, 0));
    const busiest = perDay.reduce<{ date: string; hours: number } | null>(
      (best, d) => (d.hours > 0 && (!best || d.hours > best.hours) ? d : best),
      null,
    );
    calendar = { days: perDay, busiest, totalHours: total };
  }

  const enough =
    input.historyStartedAt !== null &&
    now.getTime() - input.historyStartedAt.getTime() >= MIN_HISTORY_DAYS * 24 * HOUR;

  const activityById = new Map(input.activity.map((a) => [a.projectId, a]));
  const active = input.projects
    .map((p) => ({ p, a: activityById.get(p.id) }))
    .filter(({ a }) => a && (a.completed > 0 || a.tasksCreated > 0 || a.notesCreated > 0))
    .map(({ p, a }) => ({
      id: p.id,
      name: p.name,
      completed: a!.completed,
      tasksCreated: a!.tasksCreated,
      notesCreated: a!.notesCreated,
    }))
    .sort(
      (x, y) =>
        y.completed +
        y.tasksCreated +
        y.notesCreated -
        (x.completed + x.tasksCreated + x.notesCreated),
    );

  // Quiet: nothing for three weeks. A project made within those weeks has not had the time to be quiet.
  const quietBefore = dueInstant(addDays(week.start, -14), null, prefs.timezone).getTime();
  const quiet = input.projects
    .filter((p) => !input.activeRecently.has(p.id) && p.createdAt.getTime() < quietBefore)
    .map((p) => ({ id: p.id, name: p.name }));

  return {
    version: FACTS_VERSION,
    weekStart: week.start,
    weekEnd: week.end,
    asOf,
    computedAt: now.toISOString(),
    completed: {
      tasks: input.completedTaskCount,
      todos: input.completedTodoCount,
      byProject,
      recent: input.recentCompleted.slice(0, LIMITS.completedTitles).map((c) => ({
        type: c.type,
        id: c.id,
        title: c.title,
        completedAt: c.completedAt.toISOString(),
      })),
    },
    overdue: {
      count: input.openDueTotal,
      carriedForward: input.openCarriedTotal,
      items: input.openDue.slice(0, LIMITS.overdueItems).map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        daysLate: Math.max(0, daysBetween(t.dueDate, asOf)),
        carried: t.dueDate >= week.start,
        projectId: t.projectId,
      })),
    },
    notes: {
      created: input.notesCreatedTotal,
      edited: input.notesEdited,
      titles: input.notesCreated.slice(0, LIMITS.noteTitles),
    },
    projects: { active, quiet },
    calendar,
    postponements: {
      enough,
      items: enough
        ? input.postponed
            .filter((p) => p.count >= 2)
            .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
        : [],
    },
    inbox: { captured: input.inboxCaptured, processed: input.inboxProcessed },
  };
}
