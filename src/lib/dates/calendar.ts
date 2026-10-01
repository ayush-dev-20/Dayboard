// Calendar-date maths on "YYYY-MM-DD" strings. Everything runs in UTC on purpose, so the result
// never depends on the server's time zone or on daylight-saving changes.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateString(value: string): { y: number; m: number; d: number } | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isValidDateString(value: string): boolean {
  return parseDateString(value) !== null;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function toUtc(value: string): Date {
  const parts = parseDateString(value);
  if (!parts) throw new RangeError(`Not a calendar date: ${value}`);
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatDateString(y: number, m1: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(value: string, days: number): string {
  const date = toUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(value: string): number {
  return (toUtc(value).getUTCDay() + 6) % 7;
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

const PICKER_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const SHORT_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const SHORT_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Wed, Sep 30" */
export function formatPickerDay(value: string): string {
  return PICKER_FORMAT.format(toUtc(value));
}

/** "Sep 30", or "Sep 30, 2027" when it isn't in the same year as `today`. */
export function formatDay(value: string, today: string): string {
  const sameYear = value.slice(0, 4) === today.slice(0, 4);
  return (sameYear ? SHORT_FORMAT : SHORT_YEAR_FORMAT).format(toUtc(value));
}

/** "06:00:00" or "06:00" to "06:00". */
export function trimTime(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}
