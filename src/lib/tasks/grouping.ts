import { compareDates } from "../dates/calendar";
import { getUserToday, isOverdue, type DayPrefs } from "../dates/today";
import { isOpenStatus, type TaskStatus } from "./status";

export type GroupKey = "overdue" | "today" | "upcoming" | "nodate";
export const GROUP_ORDER: readonly GroupKey[] = ["overdue", "today", "upcoming", "nodate"];
export const GROUP_LABELS: Record<GroupKey, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  nodate: "No date",
};

type Groupable = { status: TaskStatus; dueDate: string | null; dueTime: string | null };

/**
 * Splits open tasks into the list's groups. Order within a group is whatever order came in (the
 * person's manual order). Closed tasks are not grouped; they live under "Completed".
 */
export function groupTasks<T extends Groupable>(
  tasks: readonly T[],
  prefs: DayPrefs,
  now: Date = new Date(),
): Record<GroupKey, T[]> {
  const groups: Record<GroupKey, T[]> = { overdue: [], today: [], upcoming: [], nodate: [] };
  const today = getUserToday(prefs, now);

  for (const task of tasks) {
    if (!isOpenStatus(task.status)) continue;
    if (!task.dueDate) groups.nodate.push(task);
    else if (isOverdue(task, prefs, now)) groups.overdue.push(task);
    else if (compareDates(task.dueDate, today) === 0) groups.today.push(task);
    else groups.upcoming.push(task);
  }
  return groups;
}

export type DueFilter = "any" | "overdue" | "today" | "upcoming" | "none";
export const DUE_FILTERS: readonly DueFilter[] = ["any", "overdue", "today", "upcoming", "none"];
export const DUE_FILTER_LABELS: Record<DueFilter, string> = {
  any: "Any",
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  none: "No date",
};

const FILTER_TO_GROUP: Record<Exclude<DueFilter, "any">, GroupKey> = {
  overdue: "overdue",
  today: "today",
  upcoming: "upcoming",
  none: "nodate",
};

export function applyDueFilter(groups: Record<GroupKey, unknown[]>, filter: DueFilter): GroupKey[] {
  if (filter === "any") return GROUP_ORDER.filter((key) => groups[key].length > 0);
  const key = FILTER_TO_GROUP[filter];
  return groups[key].length > 0 ? [key] : [];
}
