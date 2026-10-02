import { compareDates } from "../dates/calendar";
import { getUserToday, isOverdue, type DayPrefs } from "../dates/today";
import { trimTime } from "../dates/calendar";
import { isOpenStatus, type TaskStatus } from "../tasks/status";

type Bucketable = { status: TaskStatus; dueDate: string | null; dueTime: string | null };

export type TodayBuckets<T> = {
  /** Date has passed, or it is today and the time has passed. */
  overdue: T[];
  /** Due today with no time. */
  today: T[];
  /** Due today at a time that hasn't come yet, earliest first. */
  later: T[];
};

/**
 * Today's task groups, in the person's own day (it rolls over at their start-of-day, so at 02:00
 * "today" is still the previous calendar date). Order inside a group is the order given.
 */
export function bucketToday<T extends Bucketable>(
  tasks: readonly T[],
  prefs: DayPrefs,
  now: Date = new Date(),
): TodayBuckets<T> {
  const today = getUserToday(prefs, now);
  const out: TodayBuckets<T> = { overdue: [], today: [], later: [] };

  for (const task of tasks) {
    if (!isOpenStatus(task.status) || !task.dueDate) continue;
    if (isOverdue(task, prefs, now)) out.overdue.push(task);
    else if (compareDates(task.dueDate, today) === 0) {
      (task.dueTime ? out.later : out.today).push(task);
    }
  }
  out.later.sort((a, b) => (trimTime(a.dueTime) ?? "").localeCompare(trimTime(b.dueTime) ?? ""));
  return out;
}

/** Limits from the feature doc §4. */
export const TODAY_LIMITS = {
  overdue: 10,
  today: 20,
  todos: 10,
  planning: 5,
  notes: 5,
  completed: 20,
} as const;
