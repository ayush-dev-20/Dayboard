import { addDays } from "@/lib/dates/calendar";
import { dueInstant } from "@/lib/dates/today";

// Busy windows and free slots (V2 feature 12 §6 and §7). Pure, so edges, work hours, all-day events and the
// day boundary are all tested without a database.

export type Interval = { start: Date; end: Date };

export type BusyEvent = {
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  busy: boolean;
  status: string;
};

/** Sorts and merges overlapping or touching intervals. */
export function mergeBusy(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end.getTime() > i.start.getTime())
    .map((i) => ({ start: new Date(i.start), end: new Date(i.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged.at(-1);
    if (last && next.start.getTime() <= last.end.getTime()) {
      if (next.end.getTime() > last.end.getTime()) last.end = next.end;
    } else {
      merged.push(next);
    }
  }
  return merged;
}

const utcDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The busy intervals for some events. Tentative counts as busy. An all-day event blocks time only when it is
 * marked busy, and then it blocks each of its days in the person's own time zone.
 */
export function busyIntervals(events: BusyEvent[], timeZone: string): Interval[] {
  const out: Interval[] = [];
  for (const event of events) {
    if (!event.busy || event.status === "cancelled") continue;
    if (!event.allDay) {
      out.push({ start: event.startAt, end: event.endAt });
      continue;
    }
    // An all-day event's dates are stored as UTC midnights, end exclusive.
    const first = utcDate(event.startAt);
    const after = utcDate(event.endAt);
    for (let day = first; day < after; day = addDays(day, 1)) {
      out.push({
        start: dueInstant(day, null, timeZone),
        end: dueInstant(addDays(day, 1), null, timeZone),
      });
    }
  }
  return mergeBusy(out);
}

export type SlotOptions = {
  /** "YYYY-MM-DD", the person's day. */
  day: string;
  timeZone: string;
  /** "HH:MM" or "HH:MM:SS" */
  workStart: string;
  workEnd: string;
  durationMinutes: number;
  /** When given, nothing before this moment is offered (so "today" never suggests the past). */
  now?: Date;
};

/**
 * The stretches of the working day with nothing booked, at least `durationMinutes` long. A day with no
 * working time (end not after start) has none.
 */
export function findFreeSlots(busy: Interval[], options: SlotOptions): Interval[] {
  const trim = (t: string) => t.slice(0, 5);
  let cursor = dueInstant(options.day, trim(options.workStart), options.timeZone);
  const end = dueInstant(options.day, trim(options.workEnd), options.timeZone);
  if (end.getTime() <= cursor.getTime()) return [];
  if (options.now && options.now.getTime() > cursor.getTime()) cursor = options.now;

  const need = options.durationMinutes * 60_000;
  const slots: Interval[] = [];
  for (const block of mergeBusy(busy)) {
    if (block.end.getTime() <= cursor.getTime()) continue;
    if (block.start.getTime() >= end.getTime()) break;
    if (block.start.getTime() - cursor.getTime() >= need) {
      slots.push({ start: cursor, end: block.start });
    }
    if (block.end.getTime() > cursor.getTime()) cursor = block.end;
  }
  if (end.getTime() - cursor.getTime() >= need) slots.push({ start: cursor, end });
  return slots;
}
