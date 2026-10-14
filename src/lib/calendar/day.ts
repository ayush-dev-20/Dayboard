import { addDays } from "@/lib/dates/calendar";
import { dueInstant } from "@/lib/dates/today";
import type { EventDTO } from "./dto";

// Which of the person's days an event falls on (V2 feature 12 §6). A timed event belongs to every local day it
// overlaps. An all-day event belongs to the dates it names, whatever the person's time zone.

const utcDate = (iso: string) => iso.slice(0, 10);

export function eventDays(
  event: Pick<EventDTO, "startAt" | "endAt" | "allDay">,
  timeZone: string,
): string[] {
  const days: string[] = [];
  if (event.allDay) {
    for (let d = utcDate(event.startAt); d < utcDate(event.endAt); d = addDays(d, 1)) days.push(d);
    return days;
  }
  const start = new Date(event.startAt).getTime();
  const end = new Date(event.endAt).getTime();
  // Local date of the start, found by trying the days around its UTC date.
  const guess = utcDate(event.startAt);
  for (let d = addDays(guess, -1); d <= addDays(guess, 1); d = addDays(d, 1)) {
    const from = dueInstant(d, null, timeZone).getTime();
    const to = dueInstant(addDays(d, 1), null, timeZone).getTime();
    // An event that ends exactly at midnight does not belong to the next day. A zero-length one belongs to its day.
    if (start < to && (end > from || (end === start && start >= from))) days.push(d);
  }
  return days;
}

export function eventsByDay<T extends Pick<EventDTO, "startAt" | "endAt" | "allDay">>(
  events: T[],
  range: { from: string; to: string },
  timeZone: string,
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const event of events) {
    for (const day of eventDays(event, timeZone)) {
      if (day < range.from || day > range.to) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), event]);
    }
  }
  for (const list of byDay.values()) {
    // All-day first, then by start time.
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startAt.localeCompare(b.startAt));
  }
  return byDay;
}
