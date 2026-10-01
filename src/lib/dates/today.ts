import { TZDate } from "@date-fns/tz";
import { addDays, compareDates, formatDateString, formatDay, trimTime } from "./calendar";

// "Today" is the person's calendar day in their own time zone, rolling over at their start-of-day
// (default 06:00), so a task due "today" is still today at 1 a.m.

export type DayPrefs = {
  timezone: string;
  /** "HH:MM" or "HH:MM:SS" */
  startOfDay: string;
};

export type Dated = {
  status: string;
  dueDate: string | null;
  dueTime: string | null;
};

// A TZDate prints itself in its own zone (toISOString shows "+05:30"). Callers want an instant.
function plainDate(zoned: Date): Date {
  return new Date(zoned.getTime());
}

function startOfDayMinutes(startOfDay: string): number {
  const [h = "0", m = "0"] = startOfDay.split(":");
  return Number(h) * 60 + Number(m);
}

/** The person's current "today", as "YYYY-MM-DD". */
export function getUserToday(prefs: DayPrefs, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - startOfDayMinutes(prefs.startOfDay) * 60_000);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: prefs.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

/** The moment today began for this person (today's date at their start-of-day). */
export function startOfUserDay(prefs: DayPrefs, now: Date = new Date()): Date {
  const [y, m, d] = getUserToday(prefs, now).split("-").map(Number) as [number, number, number];
  const minutes = startOfDayMinutes(prefs.startOfDay);
  return plainDate(
    new TZDate(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0, prefs.timezone),
  );
}

/** The exact moment a date and optional time fall on in the person's time zone. */
export function dueInstant(dueDate: string, dueTime: string | null, timezone: string): Date {
  const [y, m, d] = dueDate.split("-").map(Number) as [number, number, number];
  const [hh = "0", mm = "0"] = (trimTime(dueTime) ?? "00:00").split(":");
  return plainDate(new TZDate(y, m - 1, d, Number(hh), Number(mm), 0, timezone));
}

function isClosed(status: string): boolean {
  return status === "DONE" || status === "CANCELLED";
}

export function isOverdue(task: Dated, prefs: DayPrefs, now: Date = new Date()): boolean {
  if (isClosed(task.status) || !task.dueDate) return false;
  if (task.dueTime)
    return now.getTime() > dueInstant(task.dueDate, task.dueTime, prefs.timezone).getTime();
  return compareDates(task.dueDate, getUserToday(prefs, now)) < 0;
}

export function isDueToday(task: Dated, prefs: DayPrefs, now: Date = new Date()): boolean {
  return !isClosed(task.status) && task.dueDate === getUserToday(prefs, now);
}

/**
 * The chip text for a due date. A timed task due today shows its time ("18:00"); anything else
 * shows the date ("Sep 30").
 */
export function formatDueLabel(
  due: { dueDate: string; dueTime: string | null },
  prefs: DayPrefs,
  now: Date = new Date(),
): string {
  const today = getUserToday(prefs, now);
  if (due.dueDate === today && due.dueTime) return trimTime(due.dueTime) as string;
  return formatDay(due.dueDate, today);
}

export function tomorrowOf(prefs: DayPrefs, now: Date = new Date()): string {
  return addDays(getUserToday(prefs, now), 1);
}

/** The coming Monday (never today). */
export function nextMondayOf(prefs: DayPrefs, now: Date = new Date()): string {
  const today = getUserToday(prefs, now);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(formatDateString(y, m, d), 7 - weekday);
}
