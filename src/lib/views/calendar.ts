import { addDays, compareDates, daysBetween } from "../dates/calendar";
import { endOfWeek, startOfWeek } from "./due-buckets";

// Calendar layout (V2 feature 06 §5): which days a month or week shows, and which items sit on
// which day. All on "YYYY-MM-DD" strings, so no time zone can move a date.

export type CalendarMode = "month" | "week";

/** The first and last day shown for the page that contains `anchor`. */
export function visibleRange(
  anchor: string,
  mode: CalendarMode,
  weekStart: number,
): { from: string; to: string } {
  if (mode === "week")
    return { from: startOfWeek(anchor, weekStart), to: endOfWeek(anchor, weekStart) };
  const first = `${anchor.slice(0, 7)}-01`;
  const lastOfMonth = addDays(addDays(first, 32).slice(0, 7) + "-01", -1);
  return { from: startOfWeek(first, weekStart), to: endOfWeek(lastOfMonth, weekStart) };
}

/** Days from `from` to `to` inclusive, in order. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; compareDates(day, to) <= 0; day = addDays(day, 1)) out.push(day);
  return out;
}

/** The days split into weeks of seven. */
export function weeksOf(days: readonly string[]): string[][] {
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

export function shiftAnchor(anchor: string, mode: CalendarMode, direction: -1 | 1): string {
  if (mode === "week") return addDays(anchor, direction * 7);
  const [y, m] = anchor.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(y, m - 1 + direction, 1));
  return date.toISOString().slice(0, 10);
}

type Dated = { dueDate: string | null; startDate?: string | null };

/**
 * The days an item appears on: its due date, or every day from its start to its due date when it
 * has both (and they are in order). Items without a due date are not on the calendar.
 */
export function daysForItem(item: Dated): string[] {
  if (!item.dueDate) return [];
  const start = item.startDate;
  if (start && compareDates(start, item.dueDate) < 0 && daysBetween(start, item.dueDate) <= 62) {
    return daysOf(start, item.dueDate);
  }
  return [item.dueDate];
}

/** Items by day, for the days in `range`. An item that spans days is on each of them. */
export function itemsByDay<T extends Dated>(
  items: readonly T[],
  range: { from: string; to: string },
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    for (const day of daysForItem(item)) {
      if (compareDates(day, range.from) < 0 || compareDates(day, range.to) > 0) continue;
      const list = map.get(day) ?? [];
      list.push(item);
      map.set(day, list);
    }
  }
  return map;
}
