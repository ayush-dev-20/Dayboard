import "server-only";
import { and, eq, inArray, like, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  notificationLog,
  notificationPreferences,
  pushSubscriptions,
  taskReminders,
  userPreferences,
} from "@/db/schema";
import { getUserToday, startOfUserDay } from "@/lib/dates/today";
import { enqueue } from "@/lib/jobs/enqueue";
import { findHandler, registerHandler } from "@/lib/jobs/registry";
import { PermanentError } from "@/lib/jobs/types";
import { deliverNotification, deliverPayloadSchema } from "./deliver";
import { dueReminders, effectiveAt } from "./reminders";

// The notification jobs (V2 feature 14 §4): a scan every minute that queues one delivery per reminder that has come
// due, the delivery itself, a scan every quarter hour for people whose "start of day + 30 minutes" has come, and a
// daily prune. Every one is safe to run twice, takes the person from `ctx.userId`, and logs counts only.

/** The log keeps 30 days (V2 feature 14 §2). */
export const LOG_RETENTION_DAYS = 30;
/** Reminders already sent or dropped are kept two weeks, then removed. */
export const REMINDER_RETENTION_DAYS = 14;
/** The overdue summary goes out this long after the person's day starts, and is dropped if it is missed by hours. */
export const SUMMARY_DELAY_MINUTES = 30;
export const SUMMARY_WINDOW_HOURS = 6;

/** Queues a delivery for every reminder that is due. A reminder already waiting in the queue is reused. */
export async function scanReminders(now: Date = new Date()): Promise<number> {
  const due = await dueReminders(now);
  for (const row of due) {
    const key = `reminder:${row.id}:${effectiveAt(row).getTime()}`;
    await enqueue(db, {
      type: "notification.deliver",
      payload: {
        category: row.kind === "CALENDAR_START" ? "CALENDAR_REMINDER" : "TASK_REMINDER",
        dedupeKey: key,
        reminderId: row.id,
      },
      userId: row.userId,
      queue: "notifications",
      maxAttempts: 5,
      dedupeKey: key,
    });
  }
  return due.length;
}

/**
 * Queues the overdue summary for each person who asked for it, has a device, and whose day started at least half an
 * hour ago (and not more than six). The summary for a day is made once: its log row is the record.
 */
export async function scanOverdueSummaries(now: Date = new Date()): Promise<number> {
  const people = await db
    .select({
      userId: notificationPreferences.userId,
      timezone: userPreferences.timezone,
      startOfDay: userPreferences.startOfDay,
    })
    .from(notificationPreferences)
    .innerJoin(userPreferences, eq(userPreferences.userId, notificationPreferences.userId))
    .where(
      and(
        eq(notificationPreferences.category, "OVERDUE_SUMMARY"),
        eq(notificationPreferences.enabled, true),
        sql`exists (select 1 from ${pushSubscriptions} where ${pushSubscriptions.userId} = ${notificationPreferences.userId} and ${pushSubscriptions.revokedAt} is null)`,
      ),
    );
  if (people.length === 0) return 0;

  const due = people.flatMap((person) => {
    const prefs = { timezone: person.timezone, startOfDay: person.startOfDay };
    const opens = startOfUserDay(prefs, now).getTime() + SUMMARY_DELAY_MINUTES * 60_000;
    const closes = opens + SUMMARY_WINDOW_HOURS * 3_600_000;
    if (now.getTime() < opens || now.getTime() >= closes) return [];
    const date = getUserToday(prefs, now);
    return [{ userId: person.userId, date, key: `overdue:${date}` }];
  });
  if (due.length === 0) return 0;

  const done = await db
    .select({ userId: notificationLog.userId, key: notificationLog.dedupeKey })
    .from(notificationLog)
    .where(
      and(
        inArray(
          notificationLog.userId,
          due.map((d) => d.userId),
        ),
        like(notificationLog.dedupeKey, "overdue:%"),
      ),
    );
  const handled = new Set(done.map((d) => `${d.userId}:${d.key}`));
  let queued = 0;
  for (const item of due) {
    if (handled.has(`${item.userId}:${item.key}`)) continue;
    await enqueue(db, {
      type: "notification.deliver",
      payload: { category: "OVERDUE_SUMMARY", dedupeKey: item.key, date: item.date },
      userId: item.userId,
      queue: "notifications",
      maxAttempts: 3,
      dedupeKey: item.key,
    });
    queued += 1;
  }
  return queued;
}

/** Trims the delivery log, old finished reminders and old revoked devices. */
export async function pruneNotifications(
  now: Date = new Date(),
): Promise<{ log: number; reminders: number; devices: number }> {
  const day = 24 * 3_600_000;
  const log = await db
    .delete(notificationLog)
    .where(lt(notificationLog.createdAt, new Date(now.getTime() - LOG_RETENTION_DAYS * day)))
    .returning({ id: notificationLog.id });
  const reminders = await db
    .delete(taskReminders)
    .where(
      and(
        inArray(taskReminders.status, ["SENT", "CANCELLED"]),
        lt(taskReminders.remindAt, new Date(now.getTime() - REMINDER_RETENTION_DAYS * day)),
      ),
    )
    .returning({ id: taskReminders.id });
  const devices = await db
    .delete(pushSubscriptions)
    .where(
      and(
        sql`${pushSubscriptions.revokedAt} is not null`,
        lt(pushSubscriptions.revokedAt, new Date(now.getTime() - LOG_RETENTION_DAYS * day)),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  return { log: log.length, reminders: reminders.length, devices: devices.length };
}

export function ensureNotificationHandlers(): void {
  if (!findHandler("reminders.scan")) {
    registerHandler({
      type: "reminders.scan",
      queue: "notifications",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        ctx.log("reminders queued", { count: await scanReminders() });
      },
    });
  }
  if (!findHandler("overdue.scan")) {
    registerHandler({
      type: "overdue.scan",
      queue: "notifications",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        ctx.log("overdue summaries queued", { count: await scanOverdueSummaries() });
      },
    });
  }
  if (!findHandler("notification.deliver")) {
    registerHandler({
      type: "notification.deliver",
      queue: "notifications",
      schema: deliverPayloadSchema,
      run: async (ctx, payload) => {
        if (!ctx.userId) throw new PermanentError("A notification needs a person.");
        const outcome = await deliverNotification(ctx.userId, payload);
        ctx.log("notification handled", { category: payload.category, outcome });
      },
    });
  }
  if (!findHandler("notifications.prune")) {
    registerHandler({
      type: "notifications.prune",
      queue: "default",
      schema: z.object({}).strict(),
      run: async (ctx) => {
        ctx.log("notifications pruned", await pruneNotifications());
      },
    });
  }
}
