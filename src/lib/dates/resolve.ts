import {
  addDays,
  formatDateString,
  isValidDateString,
  parseDateString,
  weekdayIndex,
} from "./calendar";

// Turns what a model (or a person) wrote for a date into "YYYY-MM-DD", relative to the person's
// own "today" (see `getUserToday`, which already accounts for their time zone and start of day).
// Returns null when it can't tell, so a guess never becomes a due date.

// Monday first, to match `weekdayIndex`.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** `today` is the person's current day as "YYYY-MM-DD". */
export function resolveDuePhrase(value: string | null | undefined, today: string): string | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return isValidDateString(text) ? text : null;
  if (text === "today" || text === "tonight") return today;
  if (text === "tomorrow") return addDays(today, 1);
  if (text === "next week") return addDays(today, 7);

  // "oct 3", "october 3rd": the next time that day comes round, this year or next.
  const monthDay =
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/.exec(
      text,
    );
  if (monthDay) {
    const month = MONTHS.indexOf(monthDay[1]!) + 1;
    const day = Number(monthDay[2]);
    const year = parseDateString(today)!.y;
    for (const y of [year, year + 1]) {
      const candidate = formatDateString(y, month, day);
      if (isValidDateString(candidate) && candidate >= today) return candidate;
    }
    return null;
  }

  const inDays = /^in (\d{1,3}) days?$/.exec(text);
  if (inDays) return addDays(today, Number(inDays[1]));
  const inWeeks = /^in (\d{1,2}) weeks?$/.exec(text);
  if (inWeeks) return addDays(today, Number(inWeeks[1]) * 7);

  // "friday", "next friday", "this friday": the next one strictly after today, except that
  // "this friday" on a Friday means today.
  const named =
    /^(?:(this|next|on)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(text);
  if (named) {
    const target = WEEKDAYS.indexOf(named[2]!);
    const here = weekdayIndex(today);
    let ahead = (target - here + 7) % 7;
    if (ahead === 0 && named[1] !== "this") ahead = 7;
    return addDays(today, ahead);
  }
  return null;
}
