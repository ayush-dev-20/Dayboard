import { addDays, compareDates, weekdayIndex } from "../dates/calendar";
import { dueInstant, getUserToday, type DayPrefs } from "../dates/today";

// The one definition of "due bucket" (V2 feature 06 §4): Overdue, Today, This week, Later, No date.
// Filters, grouping, the Board's drop rules and the Calendar all read it from here.

export const DUE_BUCKETS = ["overdue", "today", "week", "later", "none"] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number];

export const DUE_BUCKET_LABELS: Record<DueBucket | "upcoming" | "done", string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No date",
  upcoming: "Upcoming",
  done: "Completed",
};

/** What `inBucket` accepts: the five buckets, and "upcoming" (this week and later together). */
export const FILTER_BUCKETS = [...DUE_BUCKETS, "upcoming"] as const;
export type FilterBucket = (typeof FILTER_BUCKETS)[number];

type Dated = { dueDate: string | null; dueTime: string | null; open: boolean };

/** The last day of the week the given day is in. `weekStart` is 0 for Sunday ... 6 for Saturday. */
export function endOfWeek(day: string, weekStart: number): string {
  // weekdayIndex is Monday = 0; convert to "days since the week started".
  const sinceMonday = weekdayIndex(day);
  const startIndexFromMonday = (weekStart + 6) % 7; // Sunday(0) -> 6, Monday(1) -> 0, ...
  const since = (sinceMonday - startIndexFromMonday + 7) % 7;
  return addDays(day, 6 - since);
}

export function startOfWeek(day: string, weekStart: number): string {
  return addDays(endOfWeek(day, weekStart), -6);
}

/** The first day of the next week, which is where "Later" begins. */
export function startOfNextWeek(day: string, weekStart: number): string {
  return addDays(endOfWeek(day, weekStart), 1);
}

/**
 * The person's day, worked out once: a view looks at thousands of items against the same "today", so
 * the date maths (and the time-zone conversion for timed tasks) must not be repeated per item.
 */
export type DayClock = {
  today: string;
  weekEnd: string;
  isOverdue(dueDate: string, dueTime: string | null): boolean;
};

export function makeClock(prefs: DayPrefs, now: Date, weekStart: number): DayClock {
  const today = getUserToday(prefs, now);
  const instants = new Map<string, number>();
  return {
    today,
    weekEnd: endOfWeek(today, weekStart),
    isOverdue(dueDate, dueTime) {
      if (!dueTime) return compareDates(dueDate, today) < 0;
      const key = `${dueDate} ${dueTime}`;
      let at = instants.get(key);
      if (at === undefined) {
        at = dueInstant(dueDate, dueTime, prefs.timezone).getTime();
        instants.set(key, at);
      }
      return now.getTime() > at;
    },
  };
}

const clocks = new WeakMap<object, DayClock>();

/** The clock for an engine context, made on first use and kept for as long as the context lives. */
export function clockFor(ctx: { prefs: DayPrefs; now: Date; weekStart: number }): DayClock {
  let clock = clocks.get(ctx);
  if (!clock) {
    clock = makeClock(ctx.prefs, ctx.now, ctx.weekStart);
    clocks.set(ctx, clock);
  }
  return clock;
}

/**
 * Where an item sits: open items by their date in the person's own day; closed items are "done"
 * (a finished task is not overdue, and not due later).
 */
export function dueBucketOf(item: Dated, clock: DayClock): DueBucket | "done" {
  if (!item.open) return "done";
  if (!item.dueDate) return "none";
  if (clock.isOverdue(item.dueDate, item.dueTime)) return "overdue";
  if (compareDates(item.dueDate, clock.today) <= 0) return "today";
  return compareDates(item.dueDate, clock.weekEnd) <= 0 ? "week" : "later";
}

/** Whether an item is in a bucket for the `inBucket` filter. Closed items match none of them. */
export function inFilterBucket(item: Dated, bucket: FilterBucket, clock: DayClock): boolean {
  const own = dueBucketOf(item, clock);
  if (own === "done") return false;
  if (bucket === "upcoming") return own === "week" || own === "later";
  return own === bucket;
}
