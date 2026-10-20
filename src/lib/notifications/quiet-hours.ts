import { getUserToday } from "@/lib/dates/today";
import { addDays, trimTime } from "@/lib/dates/calendar";
import { dueInstant } from "@/lib/dates/today";

// Quiet hours (V2 feature 14 §4): a window of the person's day, local time, that may cross midnight (22:00 to 07:00).
// A notification inside it is held until it ends, except the overdue summary, which is dropped (it is only useful at
// the start of the day). Pure, with the time zone passed in.

export type QuietHours = { start: string; end: string };

/** Both set, or neither (the database says the same). */
export function quietHoursOf(
  start: string | null | undefined,
  end: string | null | undefined,
): QuietHours | null {
  const s = trimTime(start ?? null);
  const e = trimTime(end ?? null);
  return s && e && s !== e ? { start: s, end: e } : null;
}

function minutesOf(time: string): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/** Minutes since local midnight, in the person's time zone. */
function localMinutes(timezone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function inQuietHours(quiet: QuietHours | null, timezone: string, now: Date): boolean {
  if (!quiet) return false;
  const at = localMinutes(timezone, now);
  const from = minutesOf(quiet.start);
  const to = minutesOf(quiet.end);
  // Within a day, or across midnight.
  return from < to ? at >= from && at < to : at >= from || at < to;
}

/** When the quiet window ends: the next time the wall clock reads its end time, after `now`. */
export function quietHoursEnd(quiet: QuietHours, timezone: string, now: Date): Date {
  const today = getUserToday({ timezone, startOfDay: "00:00" }, now);
  const todayEnd = dueInstant(today, quiet.end, timezone);
  return todayEnd.getTime() > now.getTime()
    ? todayEnd
    : dueInstant(addDays(today, 1), quiet.end, timezone);
}
