import { z } from "zod";
import { addDays, isValidDateString, trimTime } from "@/lib/dates/calendar";
import { dueInstant } from "@/lib/dates/today";

// When a reminder fires (V2 feature 14 §3). Pure: a reminder is stored as how it was defined (`spec`) and its
// computed instant, and the instant is recomputed from the spec whenever the task's date, time or the person's
// time zone changes. Everything is computed in the person's time zone with `src/lib/dates`, so "9:00 the day
// before" is 9:00 on the wall clock, also across a daylight-saving change.

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00.");

export const reminderSpecSchema = z.discriminatedUnion("type", [
  /** N minutes before the task's time. */
  z.object({ type: z.literal("before"), minutes: z.number().int().min(0).max(10_080) }),
  /** At the task's time. */
  z.object({ type: z.literal("at") }),
  /** On the evening or morning before: the day before the task's date, at a time of day. */
  z.object({ type: z.literal("day-before"), time: timeOfDay }),
  /** At a date and time the person chose. */
  z.object({
    type: z.literal("exact"),
    date: z.string().refine(isValidDateString, "Choose a valid date."),
    time: timeOfDay,
  }),
  /** Before a linked calendar event starts (feature 12). The event's own start is read when it is computed. */
  z.object({ type: z.literal("event-start"), minutes: z.number().int().min(0).max(1440) }),
]);
export type ReminderSpec = z.infer<typeof reminderSpecSchema>;

/** What a custom reminder may be (the specs a person can choose in "Remind me"). */
export const customReminderSpecSchema = reminderSpecSchema.refine((s) => s.type !== "event-start", {
  message: "That kind of reminder is made for you.",
});

export type ReminderTask = {
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  startTime: string | null;
};

/** The date and time a reminder counts from: the due time, else the start time. Null for a task with no time. */
export function timedAnchor(task: ReminderTask): { date: string; time: string } | null {
  if (task.dueDate && task.dueTime) return { date: task.dueDate, time: trimTime(task.dueTime)! };
  if (task.startDate && task.startTime)
    return { date: task.startDate, time: trimTime(task.startTime)! };
  return null;
}

/** The date a "day before" reminder counts back from: the due date, else the start date. */
function dayAnchor(task: ReminderTask): string | null {
  return task.dueDate ?? task.startDate;
}

/**
 * The instant a spec points at for this task, whether or not it has passed (so a stored reminder can be compared
 * with it). Null when the spec needs something the task does not have: a time, or a date.
 */
export function remindInstant(
  spec: ReminderSpec,
  task: ReminderTask,
  timezone: string,
  eventStart?: Date | null,
): Date | null {
  switch (spec.type) {
    case "before": {
      const anchor = timedAnchor(task);
      if (!anchor) return null;
      return new Date(
        dueInstant(anchor.date, anchor.time, timezone).getTime() - spec.minutes * 60_000,
      );
    }
    case "at": {
      const anchor = timedAnchor(task);
      return anchor ? dueInstant(anchor.date, anchor.time, timezone) : null;
    }
    case "day-before": {
      const date = dayAnchor(task);
      return date ? dueInstant(addDays(date, -1), spec.time, timezone) : null;
    }
    case "exact":
      return dueInstant(spec.date, spec.time, timezone);
    case "event-start":
      return eventStart ? new Date(eventStart.getTime() - spec.minutes * 60_000) : null;
  }
}

/** As `remindInstant`, but null for an instant that is not after `now`: a reminder in the past is not made. */
export function computeRemindAt(
  spec: ReminderSpec,
  task: ReminderTask,
  prefs: { timezone: string },
  now: Date = new Date(),
  eventStart?: Date | null,
): Date | null {
  const at = remindInstant(spec, task, prefs.timezone, eventStart);
  return at && at.getTime() > now.getTime() ? at : null;
}

/** The reminder every task with a time gets, at the person's default lead. */
export function defaultLeadSpec(leadMinutes: number): ReminderSpec {
  return { type: "before", minutes: leadMinutes };
}

/** "15 min before", "At the time", "The day before at 09:00": for the chips on the task. */
export function describeReminder(spec: ReminderSpec): string {
  switch (spec.type) {
    case "before":
      if (spec.minutes === 0) return "At the time";
      return spec.minutes % 60 === 0 && spec.minutes >= 60
        ? `${spec.minutes / 60} ${spec.minutes === 60 ? "hour" : "hours"} before`
        : `${spec.minutes} min before`;
    case "at":
      return "At the time";
    case "day-before":
      return spec.time === "18:00" ? "The evening before" : `The day before at ${spec.time}`;
    case "exact":
      return `${spec.date} at ${spec.time}`;
    case "event-start":
      return `${spec.minutes} min before the event`;
  }
}
