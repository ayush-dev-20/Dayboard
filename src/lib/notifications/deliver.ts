import "server-only";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { plainTasks } from "@/db/queries/task-filters";
import { notificationLog, pushSubscriptions, taskReminders, tasks } from "@/db/schema";
import { formatDay } from "@/lib/dates/calendar";
import { getUserToday, isDueToday, isOverdue } from "@/lib/dates/today";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs/enqueue";
import { RetryAfter } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";
import { NOTIFICATION_CATEGORIES, type LogStatus, type NotificationCategory } from "./categories";
import { notificationClock } from "./clock";
import { getPushSender } from "./index";
import {
  overdueSummaryPayload,
  reminderPayload,
  serializePayload,
  syncFailurePayload,
  topicOf,
  ttlSeconds,
  weeklyReviewPayload,
  type PushPayload,
} from "./payload";
import { inQuietHours, quietHoursEnd } from "./quiet-hours";
import { effectiveAt } from "./reminders";
import { reminderSpecSchema } from "./remind-at";
import type { PushSender } from "./sender";
import { signSnoozeToken } from "./snooze-token";
import { loadNotificationSettings } from "./settings";
import { activeSubscriptions, markGone } from "./subscriptions";

// Delivery (V2 feature 14 §4). One entry point per notification: it applies the person's choices (category, quiet
// hours, the app being open), builds the payload, sends to each device, and records what happened. It is safe to run
// twice for the same notification (the log's unique key says it was handled), and it logs ids and statuses only.

/** A device whose tab was active within this long is "looking at the app": the in-app reminder replaces the push. */
export const OPEN_WINDOW_MS = 90_000;
/** A reminder that is this much past its time is no longer useful and is dropped (the push TTL for reminders). */
export const REMINDER_EXPIRES_MS = 3_600_000;

export const deliverPayloadSchema = z.strictObject({
  category: z.enum(NOTIFICATION_CATEGORIES),
  /** What makes the delivery happen once. */
  dedupeKey: z.string().min(1).max(200),
  reminderId: z.uuid().optional(),
  reviewId: z.uuid().optional(),
  /** The local date an overdue summary is for. */
  date: z.string().optional(),
});
export type DeliverPayload = z.infer<typeof deliverPayloadSchema>;

export type DeliveryOutcome =
  | "sent"
  | "no-devices"
  | "already-handled"
  | "suppressed-pref"
  | "suppressed-quiet"
  | "held"
  | "suppressed-open"
  | "expired"
  | "failed"
  | "nothing-to-say";

async function record(
  userId: string,
  category: NotificationCategory,
  dedupeKey: string,
  status: LogStatus,
  extra: { subscriptionId?: string | null; errorCode?: string | null } = {},
): Promise<void> {
  await db
    .insert(notificationLog)
    .values({
      userId,
      category,
      dedupeKey,
      status,
      subscriptionId: extra.subscriptionId ?? null,
      errorCode: extra.errorCode ?? null,
    })
    .onConflictDoNothing();
}

async function alreadyLogged(userId: string, dedupeKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(and(eq(notificationLog.userId, userId), eq(notificationLog.dedupeKey, dedupeKey)))
    .limit(1);
  return Boolean(row);
}

type Sent = {
  sent: string[];
  open: number;
  gone: number;
  failedStatus: number | null;
  retryable: boolean;
};

/** Sends one payload to each live device. A device that says it is gone is revoked on the spot. */
async function sendToDevices(
  userId: string,
  payload: PushPayload,
  sender: PushSender,
  now: Date,
  options: { skipOpen: boolean },
): Promise<Sent & { devices: number }> {
  const subs = await activeSubscriptions(userId);
  const result: Sent = { sent: [], open: 0, gone: 0, failedStatus: null, retryable: false };
  const body = serializePayload(payload);
  for (const sub of subs) {
    if (options.skipOpen && now.getTime() - sub.lastSeenAt.getTime() < OPEN_WINDOW_MS) {
      result.open += 1;
      continue;
    }
    const outcome = await sender.send(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      body,
      { ttlSeconds: ttlSeconds(payload.category), topic: topicOf(payload.tag) },
    );
    if (outcome.ok) result.sent.push(sub.id);
    else if (outcome.gone) {
      await markGone(sub.id);
      result.gone += 1;
    } else {
      result.failedStatus = outcome.status;
      if (outcome.retryable) result.retryable = true;
    }
  }
  return { ...result, devices: subs.length };
}

/** Turns what happened across devices into the log row (or a retry). Returns the outcome. */
async function finish(
  userId: string,
  category: NotificationCategory,
  dedupeKey: string,
  r: Sent & { devices: number },
): Promise<DeliveryOutcome> {
  if (r.sent.length > 0) {
    await record(userId, category, dedupeKey, "SENT", {
      subscriptionId: r.sent.length === 1 ? r.sent[0] : null,
    });
    return "sent";
  }
  if (r.devices > 0 && r.open === r.devices) {
    await record(userId, category, dedupeKey, "SUPPRESSED_OPEN");
    return "suppressed-open";
  }
  // Every device failed. A temporary failure is tried again by the job; a permanent one is logged and left.
  if (r.retryable) throw new RetryAfter(60_000, "push service unavailable");
  await record(userId, category, dedupeKey, "FAILED", {
    errorCode: r.gone > 0 && r.failedStatus === null ? "gone" : String(r.failedStatus ?? "none"),
  });
  return "failed";
}

/** "Due at 14:30", "Starts at 09:00", "Due Tomorrow". */
function whenLabel(
  task: { dueDate: string | null; dueTime: string | null; startTime: string | null },
  timezone: string,
  now: Date,
): string {
  if (task.dueTime) return `Due at ${task.dueTime.slice(0, 5)}`;
  if (task.startTime) return `Starts at ${task.startTime.slice(0, 5)}`;
  if (task.dueDate) {
    const today = getUserToday({ timezone, startOfDay: "00:00" }, now);
    return `Due ${formatDay(task.dueDate, today)}`;
  }
  return "Coming up";
}

function eventTimeLabel(start: Date, timezone: string): string {
  return `Event at ${new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(start)}`;
}

async function deliverReminder(
  userId: string,
  payload: DeliverPayload,
  now: Date,
  sender: PushSender,
): Promise<DeliveryOutcome> {
  const [row] = await db
    .select()
    .from(taskReminders)
    .where(and(eq(taskReminders.id, payload.reminderId!), eq(taskReminders.userId, userId)))
    .limit(1);
  if (!row || (row.status !== "PENDING" && row.status !== "SNOOZED")) return "already-handled";
  const at = effectiveAt(row);
  // The reminder moved after this job was queued: the new time has its own delivery.
  if (payload.dedupeKey !== `reminder:${row.id}:${at.getTime()}`) return "already-handled";
  if (at.getTime() > now.getTime()) return "already-handled";

  const category: NotificationCategory =
    row.kind === "CALENDAR_START" ? "CALENDAR_REMINDER" : "TASK_REMINDER";
  const cancel = () =>
    db.update(taskReminders).set({ status: "CANCELLED" }).where(eq(taskReminders.id, row.id));

  const [task] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      archivedAt: tasks.archivedAt,
      deletedAt: tasks.deletedAt,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      startTime: tasks.startTime,
    })
    .from(tasks)
    .where(and(eq(tasks.id, row.taskId), eq(tasks.userId, userId)))
    .limit(1);
  // The task is done, archived or gone: nothing to remind about.
  if (
    !task ||
    task.status === "DONE" ||
    task.status === "CANCELLED" ||
    task.archivedAt ||
    task.deletedAt
  ) {
    await cancel();
    await record(userId, category, payload.dedupeKey, "EXPIRED");
    return "expired";
  }
  // Too late to be useful (the worker was down, say).
  if (now.getTime() - at.getTime() > REMINDER_EXPIRES_MS) {
    await cancel();
    await record(userId, category, payload.dedupeKey, "EXPIRED");
    return "expired";
  }

  const settings = await loadNotificationSettings(db, userId);
  if (!settings.categories[category]) {
    await cancel();
    await record(userId, category, payload.dedupeKey, "SUPPRESSED_PREF");
    return "suppressed-pref";
  }

  // Quiet hours hold it until they end: it waits as a snooze to that moment, and is delivered then.
  if (inQuietHours(settings.quiet, settings.timezone, now)) {
    const until = quietHoursEnd(settings.quiet!, settings.timezone, now);
    await db
      .update(taskReminders)
      .set({ status: "SNOOZED", snoozedUntil: until })
      .where(eq(taskReminders.id, row.id));
    await record(userId, category, `${payload.dedupeKey}:quiet`, "SUPPRESSED_QUIET");
    return "held";
  }

  const subs = await activeSubscriptions(userId);
  const stamp = now;
  // Whether or not a device can be pushed to, this reminder was due: the in-app banner shows it.
  await db
    .update(taskReminders)
    .set({ status: "SENT", sentAt: stamp, acknowledgedAt: null })
    .where(eq(taskReminders.id, row.id));
  if (subs.length === 0) return "no-devices";

  const spec = reminderSpecSchema.safeParse(row.spec);
  const when =
    row.kind === "CALENDAR_START" && spec.success && spec.data.type === "event-start"
      ? eventTimeLabel(
          new Date(row.remindAt.getTime() + spec.data.minutes * 60_000),
          settings.timezone,
        )
      : whenLabel(task, settings.timezone, now);
  const message = reminderPayload({
    taskId: task.id,
    taskTitle: task.title,
    showTitles: settings.showTitles,
    when,
    reminderId: row.id,
    token: signSnoozeToken(
      { reminderId: row.id, userId, stamp: stamp.getTime() },
      env.BETTER_AUTH_SECRET,
      now,
    ),
    calendar: row.kind === "CALENDAR_START",
  });
  try {
    return await finish(
      userId,
      category,
      payload.dedupeKey,
      await sendToDevices(userId, message, sender, now, { skipOpen: true }),
    );
  } catch (error) {
    if (error instanceof RetryAfter) {
      // Put it back, so the retry (and the scan) still see it as waiting.
      await db
        .update(taskReminders)
        .set({ status: row.status, sentAt: row.sentAt })
        .where(eq(taskReminders.id, row.id));
    }
    throw error;
  }
}

async function deliverGeneric(
  userId: string,
  payload: DeliverPayload,
  now: Date,
  sender: PushSender,
): Promise<DeliveryOutcome> {
  const { category, dedupeKey } = payload;
  const settings = await loadNotificationSettings(db, userId);
  if (!settings.categories[category]) {
    await record(userId, category, dedupeKey, "SUPPRESSED_PREF");
    return "suppressed-pref";
  }

  if (inQuietHours(settings.quiet, settings.timezone, now)) {
    await record(userId, category, `${dedupeKey}:quiet`, "SUPPRESSED_QUIET");
    // The overdue summary is only useful at the start of the day: dropped. The rest wait for the window to end.
    if (category === "OVERDUE_SUMMARY") return "suppressed-quiet";
    await enqueue(db, {
      type: "notification.deliver",
      payload,
      userId,
      queue: "notifications",
      runAt: quietHoursEnd(settings.quiet!, settings.timezone, now),
      dedupeKey: `${dedupeKey}:held`,
    });
    return "held";
  }

  let message: PushPayload;
  if (category === "OVERDUE_SUMMARY") {
    const counts = await overdueCounts(userId, settings, now);
    if (counts.overdue + counts.dueToday === 0) {
      // Said once for the day, so the scan does not look again every quarter of an hour.
      await record(userId, category, dedupeKey, "EXPIRED", { errorCode: "nothing" });
      return "nothing-to-say";
    }
    message = overdueSummaryPayload({
      ...counts,
      date: payload.date ?? getUserToday(settings, now),
      showTitles: settings.showTitles,
    });
  } else if (category === "WEEKLY_REVIEW_READY") {
    message = weeklyReviewPayload(payload.reviewId ?? dedupeKey);
  } else {
    message = syncFailurePayload();
  }

  const result = await sendToDevices(userId, message, sender, now, { skipOpen: true });
  if (result.devices === 0) return "no-devices";
  return finish(userId, category, dedupeKey, result);
}

/** How many tasks are overdue and how many are due today, as the person's day counts them. */
export async function overdueCounts(
  userId: string,
  settings: { timezone: string; startOfDay: string },
  now: Date,
): Promise<{ overdue: number; dueToday: number }> {
  const today = getUserToday(settings, now);
  const rows = await db
    .select({ status: tasks.status, dueDate: tasks.dueDate, dueTime: tasks.dueTime })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.archivedAt),
        isNull(tasks.deletedAt),
        isNull(tasks.parentTaskId),
        plainTasks,
        sql`${tasks.dueDate} is not null and ${tasks.dueDate} <= ${today}`,
        sql`${tasks.status} not in ('DONE', 'CANCELLED')`,
      ),
    )
    .limit(1000);
  let overdue = 0;
  let dueToday = 0;
  for (const row of rows) {
    if (isOverdue(row, settings, now)) overdue += 1;
    else if (isDueToday(row, settings, now)) dueToday += 1;
  }
  return { overdue, dueToday };
}

/** The deliver job's work. Returns what happened, for logs and tests. */
export async function deliverNotification(
  userId: string,
  payload: DeliverPayload,
  options: { now?: Date; sender?: PushSender } = {},
): Promise<DeliveryOutcome> {
  const now = options.now ?? notificationClock.now();
  const sender = options.sender ?? getPushSender();
  if (await alreadyLogged(userId, payload.dedupeKey)) return "already-handled";
  const outcome =
    payload.category === "TASK_REMINDER" || payload.category === "CALENDAR_REMINDER"
      ? payload.reminderId
        ? await deliverReminder(userId, payload, now, sender)
        : "already-handled"
      : await deliverGeneric(userId, payload, now, sender);
  logger.info("notification handled", { category: payload.category, outcome });
  return outcome;
}

/** Test notifications: sent to one device the person owns, however busy it is, and counted so they stay rare. */
export const TEST_LIMIT_PER_HOUR = 3;

export async function testsSentLastHour(userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.userId, userId),
        sql`${notificationLog.dedupeKey} like 'test:%'`,
        gte(notificationLog.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    );
  return row?.n ?? 0;
}

export async function sendTest(
  userId: string,
  subscriptionId: string,
  payload: PushPayload,
  sender: PushSender = getPushSender(),
): Promise<{ ok: boolean }> {
  const [sub] = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.id, subscriptionId),
        eq(pushSubscriptions.userId, userId),
        isNull(pushSubscriptions.revokedAt),
      ),
    )
    .limit(1);
  if (!sub) return { ok: false };
  const result = await sender.send(
    { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
    serializePayload(payload),
    { ttlSeconds: 300, topic: "test" },
  );
  if (!result.ok && result.gone) await markGone(sub.id);
  await record(
    userId,
    "TASK_REMINDER",
    `test:${crypto.randomUUID()}`,
    result.ok ? "SENT" : "FAILED",
    { subscriptionId: sub.id, errorCode: result.ok ? null : String(result.status) },
  );
  return { ok: result.ok };
}
