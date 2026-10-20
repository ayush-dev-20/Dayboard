import { addDays, parseDateString, weekdayIndex } from "./calendar";
import { dueInstant, type DayPrefs } from "./today";

// The day rules of the journal (V3 feature 02 §2). A journal entry belongs to a calendar day written as
// "YYYY-MM-DD", the person's own day (their time zone and start-of-day), which the server works out. Names are
// assembled from parts here, never taken from the runtime's locale data, so the text is the same on every server.

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function partsOf(date: string) {
  const parts = parseDateString(date);
  if (!parts) throw new RangeError(`Not a calendar date: ${date}`);
  return { ...parts, weekday: WEEKDAYS[weekdayIndex(date)]! };
}

/** "Tuesday, 13 October 2026": the title a new entry starts with. The day is not padded. */
export function journalTitle(date: string): string {
  const { y, m, d, weekday } = partsOf(date);
  return `${weekday}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Tue 13 Oct": the short form in the sidebar. */
export function journalShortDate(date: string): string {
  const { m, d, weekday } = partsOf(date);
  return `${weekday.slice(0, 3)} ${d} ${MONTHS[m - 1]!.slice(0, 3)}`;
}

/** "October 2026": the heading over a month of entries. */
export function journalMonthLabel(date: string): string {
  const { y, m } = partsOf(date);
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * The instants a day covers: from its start in the person's time zone to the start of the next day. A day
 * with a daylight-saving change is 23 or 25 hours long; consecutive days share their edge, so a moment is in
 * exactly one of them.
 */
export function dayBounds(date: string, prefs: DayPrefs): { start: Date; end: Date } {
  return {
    start: dueInstant(date, prefs.startOfDay, prefs.timezone),
    end: dueInstant(addDays(date, 1), prefs.startOfDay, prefs.timezone),
  };
}

/** "14:05": the time of day an item was completed, in the person's own time zone. */
export function doneTime(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}
