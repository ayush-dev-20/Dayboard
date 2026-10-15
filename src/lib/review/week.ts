import { addDays, daysBetween, weekdayIndex } from "@/lib/dates/calendar";
import { dueInstant, getUserToday, type DayPrefs } from "@/lib/dates/today";
import { endOfWeek, startOfWeek } from "@/lib/views/due-buckets";

// Week boundaries for the review (V2 feature 15 §3, §8): the person's own calendar days, the first one chosen by
// their week-start preference (0 is Sunday ... 6 is Saturday), measured in their time zone and starting each day at
// their start-of-day, so a late-night task still belongs to the day before. Pure.

export type ReviewPrefs = DayPrefs & {
  weekStart: number;
  /** 0 (Sunday) to 6, or null for the last day of the person's week. */
  weeklyReviewDay: number | null;
  /** The person's local hour, 0 to 23. */
  weeklyReviewHour: number;
};

export type Week = { start: string; end: string };

export const weekOf = (day: string, weekStart: number): Week => ({
  start: startOfWeek(day, weekStart),
  end: endOfWeek(day, weekStart),
});

/** The review week that contains the person's today. */
export function currentWeek(prefs: ReviewPrefs, now: Date = new Date()): Week {
  return weekOf(getUserToday(prefs, now), prefs.weekStart);
}

/** The first day of the week after `week`. */
export const nextWeekStart = (week: Week) => addDays(week.end, 1);

/** When the day begins for this person: its date at their start-of-day. */
export function dayStartInstant(date: string, prefs: DayPrefs): Date {
  return dueInstant(date, prefs.startOfDay.slice(0, 5), prefs.timezone);
}

/** The week as instants: when it began and when the next one begins. */
export function weekWindow(week: Week, prefs: DayPrefs): { from: Date; to: Date } {
  return {
    from: dayStartInstant(week.start, prefs),
    to: dayStartInstant(addDays(week.end, 1), prefs),
  };
}

/** 0 (Sunday) to 6, for a "YYYY-MM-DD" day. */
export function weekdayOf(day: string): number {
  return (weekdayIndex(day) + 1) % 7;
}

/** The weekday (0 is Sunday) the review runs on: the person's choice, or the last day of their week. */
export function reviewWeekday(prefs: Pick<ReviewPrefs, "weekStart" | "weeklyReviewDay">): number {
  return prefs.weeklyReviewDay ?? (prefs.weekStart + 6) % 7;
}

const minutes = (hhmm: string) => {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

/** Minutes since the person's day began (their start-of-day), 0 to 1439. */
function minutesIntoDay(now: Date, prefs: DayPrefs): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: prefs.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (hour * 60 + minute - minutes(prefs.startOfDay) + 1440) % 1440;
}

/**
 * Whether this is the day and hour of the person's weekly review. Once it is, it stays true for the rest of the
 * day, so an hourly scan that was late still finds it. The hour is read on the person's own day (which begins at
 * their start-of-day).
 */
export function isReviewDue(prefs: ReviewPrefs, now: Date = new Date()): boolean {
  const today = getUserToday(prefs, now);
  if (weekdayOf(today) !== reviewWeekday(prefs)) return false;
  const due = (prefs.weeklyReviewHour * 60 - minutes(prefs.startOfDay) + 1440) % 1440;
  return minutesIntoDay(now, prefs) >= due;
}

/** "Last 12 weeks": the first day of each, newest first, starting with the week of `day`. */
export function recentWeekStarts(day: string, weekStart: number, count: number): string[] {
  const first = startOfWeek(day, weekStart);
  return Array.from({ length: count }, (_, i) => addDays(first, -7 * i));
}

export { daysBetween };
