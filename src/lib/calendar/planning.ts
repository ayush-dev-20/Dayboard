import "server-only";
import { env } from "@/lib/env";
import { addDays } from "@/lib/dates/calendar";
import { dueInstant } from "@/lib/dates/today";
import { busyIntervals, findFreeSlots, type Interval } from "./busy";
import { eventDays } from "./day";
import { eventsBetween, getStatus } from "./store";

// What Plan my day learns from the calendar (V2 feature 12 §6): the stretches of the working day with nothing
// booked, and, only if the person turned it on, the titles of today's events. By default the model learns when
// the person is busy, never what the events are. Planning still sets no times: the person confirms everything.

export type PlanningCalendar = {
  /** "HH:MM–HH:MM" in the person's time zone. */
  freeWindows: string[];
  /** "HH:MM title" lines, present only when the person allowed planning to see titles. */
  events?: string[];
};

const hhmm = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);

/** Merged busy intervals between two instants, from the person's selected calendars. Tentative counts as busy. */
export async function busyWindows(
  userId: string,
  from: Date,
  to: Date,
  timeZone: string,
): Promise<Interval[]> {
  const events = await eventsBetween(userId, from, to);
  return busyIntervals(
    events.map((e) => ({
      startAt: new Date(e.startAt),
      endAt: new Date(e.endAt),
      allDay: e.allDay,
      busy: e.busy,
      status: e.status,
    })),
    timeZone,
  );
}

export async function planningCalendar(
  userId: string,
  options: {
    today: string;
    timeZone: string;
    workStart: string;
    workEnd: string;
    seesTitles: boolean;
    now?: Date;
  },
): Promise<PlanningCalendar | undefined> {
  if (!env.calendarAvailable) return undefined;
  const status = await getStatus(userId);
  // Nothing connected, or no calendar selected: planning works exactly as it did before.
  if (!status.accounts.some((a) => a.calendars.some((c) => c.selected))) return undefined;

  const { today, timeZone } = options;
  const events = await eventsBetween(
    userId,
    dueInstant(addDays(today, -1), null, timeZone),
    dueInstant(addDays(today, 2), null, timeZone),
  );
  const todays = events.filter((e) => eventDays(e, timeZone).includes(today));
  const busy = busyIntervals(
    todays.map((e) => ({
      startAt: new Date(e.startAt),
      endAt: new Date(e.endAt),
      allDay: e.allDay,
      busy: e.busy,
      status: e.status,
    })),
    timeZone,
  );
  const slots = findFreeSlots(busy, {
    day: today,
    timeZone,
    workStart: options.workStart,
    workEnd: options.workEnd,
    durationMinutes: 30,
    now: options.now,
  });

  return {
    freeWindows: slots.map((s) => `${hhmm(s.start, timeZone)}–${hhmm(s.end, timeZone)}`),
    ...(options.seesTitles
      ? {
          events: todays
            .sort((a, b) => a.startAt.localeCompare(b.startAt))
            .map((e) => `${e.allDay ? "all day" : hhmm(new Date(e.startAt), timeZone)} ${e.title}`),
        }
      : {}),
  };
}
