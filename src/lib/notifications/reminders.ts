import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Executor } from "@/db/executor";
import {
  calendarEvents,
  calendarTaskLinks,
  taskReminders,
  tasks,
  userPreferences,
} from "@/db/schema";
import { addDays } from "@/lib/dates/calendar";
import { dueInstant, getUserToday } from "@/lib/dates/today";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { MAX_CUSTOM_REMINDERS, type ReminderKind } from "./categories";
import {
  customReminderSpecSchema,
  defaultLeadSpec,
  describeReminder,
  remindInstant,
  reminderSpecSchema,
  timedAnchor,
  type ReminderSpec,
  type ReminderTask,
} from "./remind-at";
import { loadNotificationSettings } from "./settings";

// Reminders stay in step with their tasks (V2 feature 14 §3). A reminder is stored as how it was defined and the
// instant that gives; `reconcileTaskReminders` recomputes the instant from the task as it is now, so there is one
// place that decides what a task's reminders should be. It runs from the same two helpers every task write already
// calls (`logTaskUpserts`), so a new way of changing a task cannot forget it.
//
// What the status means: PENDING waits for its time; SNOOZED waits for `snoozed_until` (a person's snooze, or a
// reminder held for quiet hours); SENT has been delivered; CANCELLED was dropped by the system (the task closed, the
// time passed) and comes back if the task reopens or moves to a time that is still ahead.

type ReminderRow = typeof taskReminders.$inferSelect;
type TaskFacts = ReminderTask & {
  id: string;
  status: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
};

const closed = (task: TaskFacts) =>
  task.status === "DONE" ||
  task.status === "CANCELLED" ||
  task.archivedAt !== null ||
  task.deletedAt !== null;

const sameSpec = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The time a reminder is waiting for now: a snooze's time while snoozed, else its own. */
export const effectiveAt = (
  row: Pick<ReminderRow, "remindAt" | "snoozedUntil" | "status">,
): Date => (row.status === "SNOOZED" && row.snoozedUntil ? row.snoozedUntil : row.remindAt);

/**
 * Brings the reminders of these tasks in line with the tasks as they are now. Idempotent: running it twice changes
 * nothing the second time. Call it inside the transaction of the write that changed the tasks.
 */
export async function reconcileTaskReminders(
  executor: Executor,
  userId: string,
  taskIds: string[],
  now: Date = new Date(),
): Promise<void> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return;

  const taskRows: TaskFacts[] = await executor
    .select({
      id: tasks.id,
      status: tasks.status,
      archivedAt: tasks.archivedAt,
      deletedAt: tasks.deletedAt,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      startDate: tasks.startDate,
      startTime: tasks.startTime,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)));
  const existing = await executor
    .select()
    .from(taskReminders)
    .where(and(eq(taskReminders.userId, userId), inArray(taskReminders.taskId, ids)));
  const byTask = new Map<string, ReminderRow[]>();
  for (const row of existing) byTask.set(row.taskId, [...(byTask.get(row.taskId) ?? []), row]);

  // Most writes touch tasks with no time and no reminders: nothing to do, and no settings to read.
  const worthwhile = taskRows.filter(
    (t) =>
      (byTask.get(t.id)?.length ?? 0) > 0 ||
      (!closed(t) && (timedAnchor(t) || env.calendarAvailable)),
  );
  if (worthwhile.length === 0) return;

  const settings = await loadNotificationSettings(executor, userId);
  const events = env.calendarAvailable
    ? await linkedEventStarts(executor, userId, ids, now)
    : new Map();

  for (const task of worthwhile) {
    const rows = byTask.get(task.id) ?? [];
    if (closed(task)) {
      const open = rows
        .filter((r) => r.status === "PENDING" || r.status === "SNOOZED")
        .map((r) => r.id);
      if (open.length > 0) {
        await executor
          .update(taskReminders)
          .set({ status: "CANCELLED" })
          .where(inArray(taskReminders.id, open));
      }
      continue;
    }

    // The two reminders the system makes: the default lead, and the one before a linked calendar event.
    const defaults: { kind: ReminderKind; spec: ReminderSpec; at: Date | null }[] = [];
    const lead = defaultLeadSpec(settings.leadMinutes);
    defaults.push({
      kind: "DEFAULT_LEAD",
      spec: lead,
      at: settings.categories.TASK_REMINDER ? remindInstant(lead, task, settings.timezone) : null,
    });
    const eventStart = events.get(task.id) ?? null;
    const calendarSpec: ReminderSpec = { type: "event-start", minutes: settings.leadMinutes };
    defaults.push({
      kind: "CALENDAR_START",
      spec: calendarSpec,
      at: settings.categories.CALENDAR_REMINDER
        ? remindInstant(calendarSpec, task, settings.timezone, eventStart)
        : null,
    });

    for (const wanted of defaults) {
      const row = rows.find((r) => r.kind === wanted.kind);
      if (wanted.at === null) {
        // Nothing to remind about any more (no time, no event, the category is off): the row goes.
        if (row) await executor.delete(taskReminders).where(eq(taskReminders.id, row.id));
        continue;
      }
      await settle(executor, userId, task.id, wanted.kind, wanted.spec, wanted.at, row, now);
    }

    // Custom reminders: each follows the task by its own spec.
    for (const row of rows.filter((r) => r.kind === "CUSTOM")) {
      const parsed = reminderSpecSchema.safeParse(row.spec);
      const at = parsed.success ? remindInstant(parsed.data, task, settings.timezone) : null;
      if (!parsed.success || at === null) {
        // It cannot apply to this task now (it lost its time): kept, but not waiting.
        if (row.status !== "CANCELLED") {
          await executor
            .update(taskReminders)
            .set({ status: "CANCELLED" })
            .where(eq(taskReminders.id, row.id));
        }
        continue;
      }
      await settle(executor, userId, task.id, "CUSTOM", parsed.data, at, row, now);
    }
  }
}

/** Makes one reminder row say what the task now says it should. */
async function settle(
  executor: Executor,
  userId: string,
  taskId: string,
  kind: ReminderKind,
  spec: ReminderSpec,
  at: Date,
  row: ReminderRow | undefined,
  now: Date,
): Promise<void> {
  const future = at.getTime() > now.getTime();
  if (!row) {
    // A reminder in the past is not made.
    if (!future) return;
    await executor
      .insert(taskReminders)
      .values({ userId, taskId, remindAt: at, kind, spec, status: "PENDING" })
      .onConflictDoNothing();
    return;
  }

  const unchanged = row.remindAt.getTime() === at.getTime() && sameSpec(row.spec, spec);
  if (unchanged) {
    // A reopened task brings back what closing it cancelled, if its time is still ahead.
    if (row.status === "CANCELLED" && future) {
      await executor
        .update(taskReminders)
        .set({ status: "PENDING", acknowledgedAt: null })
        .where(eq(taskReminders.id, row.id));
    }
    return;
  }

  // The time moved (or the lead or zone changed): start again from the new time, or drop it if that has passed.
  if (!future) {
    if (row.status === "PENDING" || row.status === "SNOOZED") {
      await executor
        .update(taskReminders)
        .set({ status: "CANCELLED" })
        .where(eq(taskReminders.id, row.id));
    }
    return;
  }
  await executor
    .update(taskReminders)
    .set({
      remindAt: at,
      spec,
      status: "PENDING",
      sentAt: null,
      snoozedUntil: null,
      acknowledgedAt: null,
    })
    .where(eq(taskReminders.id, row.id));
}

/** The start of the next event each task is linked to (or the last one, when all are over), by task id. */
async function linkedEventStarts(
  executor: Executor,
  userId: string,
  taskIds: string[],
  now: Date,
): Promise<Map<string, Date>> {
  const rows = await executor
    .select({ taskId: calendarTaskLinks.taskId, startAt: calendarEvents.startAt })
    .from(calendarTaskLinks)
    .innerJoin(
      calendarEvents,
      and(
        eq(calendarEvents.sourceId, calendarTaskLinks.sourceId),
        eq(calendarEvents.providerEventId, calendarTaskLinks.providerEventId),
      ),
    )
    .where(
      and(
        eq(calendarTaskLinks.userId, userId),
        inArray(calendarTaskLinks.taskId, taskIds),
        eq(calendarEvents.allDay, false),
        sql`${calendarEvents.status} <> 'cancelled'`,
      ),
    )
    .orderBy(asc(calendarEvents.startAt));
  const out = new Map<string, Date>();
  for (const row of rows) {
    const had = out.get(row.taskId);
    // Prefer the first event still ahead; otherwise keep the latest one seen.
    if (!had || had.getTime() <= now.getTime()) out.set(row.taskId, row.startAt);
  }
  return out;
}

/** After the person's time zone, default lead or categories change: every reminder is worked out again. */
export async function recomputeAllReminders(
  executor: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const withTimes = await executor
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        or(isNotNull(tasks.dueTime), isNotNull(tasks.startTime)),
        isNull(tasks.archivedAt),
        isNull(tasks.deletedAt),
      ),
    );
  const withReminders = await executor
    .selectDistinct({ id: taskReminders.taskId })
    .from(taskReminders)
    .where(eq(taskReminders.userId, userId));
  const linked = env.calendarAvailable
    ? await executor
        .selectDistinct({ id: calendarTaskLinks.taskId })
        .from(calendarTaskLinks)
        .where(eq(calendarTaskLinks.userId, userId))
    : [];
  await reconcileTaskReminders(
    executor,
    userId,
    [...withTimes, ...withReminders, ...linked].map((r) => r.id),
    now,
  );
}

// -- What the person sees and sets ------------------------------------------------------------------------------

export type ReminderDTO = {
  id: string;
  kind: ReminderKind;
  spec: ReminderSpec;
  /** When it fires, an ISO instant. */
  at: string;
  /** "15 min before". */
  label: string;
  snoozed: boolean;
};

/** The reminders waiting on a task (not the ones already sent or dropped). */
export async function listTaskReminders(userId: string, taskId: string): Promise<ReminderDTO[]> {
  const rows = await db
    .select()
    .from(taskReminders)
    .where(
      and(
        eq(taskReminders.userId, userId),
        eq(taskReminders.taskId, taskId),
        inArray(taskReminders.status, ["PENDING", "SNOOZED"]),
      ),
    )
    .orderBy(asc(taskReminders.remindAt));
  return rows.flatMap((row) => {
    const spec = reminderSpecSchema.safeParse(row.spec);
    if (!spec.success) return [];
    return [
      {
        id: row.id,
        kind: row.kind as ReminderKind,
        spec: spec.data,
        at: effectiveAt(row).toISOString(),
        label: describeReminder(spec.data),
        snoozed: row.status === "SNOOZED",
      },
    ];
  });
}

/**
 * Replaces a task's custom reminders with these (at most three). Ones that are already there and unchanged are
 * kept as they are. A reminder with no time to count from, or at a time that has passed, is refused.
 */
export async function setCustomReminders(
  userId: string,
  taskId: string,
  specs: unknown[],
  now: Date = new Date(),
): Promise<ReminderDTO[]> {
  if (specs.length > MAX_CUSTOM_REMINDERS) {
    throw new AppError(
      "VALIDATION_ERROR",
      `A task can have ${MAX_CUSTOM_REMINDERS} custom reminders.`,
    );
  }
  const parsed = specs.map((s) => customReminderSpecSchema.parse(s));

  await db.transaction(async (tx) => {
    const [task] = await tx
      .select({
        id: tasks.id,
        status: tasks.status,
        archivedAt: tasks.archivedAt,
        deletedAt: tasks.deletedAt,
        dueDate: tasks.dueDate,
        dueTime: tasks.dueTime,
        startDate: tasks.startDate,
        startTime: tasks.startTime,
      })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!task) throw new AppError("NOT_FOUND");
    if (closed(task)) {
      throw new AppError("VALIDATION_ERROR", "A finished task doesn't need a reminder.");
    }
    const { timezone } = await loadNotificationSettings(tx, userId);

    const planned = parsed.map((spec) => {
      const at = remindInstant(spec, task, timezone);
      if (at === null) {
        throw new AppError(
          "VALIDATION_ERROR",
          spec.type === "day-before"
            ? "Give the task a date first."
            : "Give the task a time first, then remind about it.",
        );
      }
      if (at.getTime() <= now.getTime()) {
        throw new AppError("VALIDATION_ERROR", "That time has already passed.");
      }
      return { spec, at };
    });

    const current = await tx
      .select()
      .from(taskReminders)
      .where(
        and(
          eq(taskReminders.userId, userId),
          eq(taskReminders.taskId, taskId),
          eq(taskReminders.kind, "CUSTOM"),
        ),
      );
    const keep = new Set<string>();
    const toAdd: typeof planned = [];
    for (const item of planned) {
      const same = current.find(
        (row) =>
          !keep.has(row.id) &&
          sameSpec(row.spec, item.spec) &&
          row.remindAt.getTime() === item.at.getTime() &&
          row.status !== "CANCELLED",
      );
      if (same) keep.add(same.id);
      else toAdd.push(item);
    }
    const drop = current.filter((row) => !keep.has(row.id)).map((row) => row.id);
    if (drop.length > 0) await tx.delete(taskReminders).where(inArray(taskReminders.id, drop));
    if (toAdd.length > 0) {
      await tx.insert(taskReminders).values(
        toAdd.map((item) => ({
          userId,
          taskId,
          remindAt: item.at,
          kind: "CUSTOM" as const,
          spec: item.spec,
          status: "PENDING" as const,
        })),
      );
    }
  });
  return listTaskReminders(userId, taskId);
}

export type InAppReminderDTO = {
  id: string;
  taskId: string;
  title: string;
  at: string;
  dueLabel: string | null;
};

/** Reminders that have come due and that the person has not yet opened, snoozed or dismissed (the Today banner). */
export async function dueInApp(
  userId: string,
  now: Date = new Date(),
): Promise<InAppReminderDTO[]> {
  const at = sql<Date>`case when ${taskReminders.status} = 'SNOOZED' then ${taskReminders.snoozedUntil} else ${taskReminders.remindAt} end`;
  const rows = await db
    .select({
      id: taskReminders.id,
      taskId: taskReminders.taskId,
      title: tasks.title,
      dueTime: tasks.dueTime,
      startTime: tasks.startTime,
      at,
    })
    .from(taskReminders)
    .innerJoin(tasks, eq(tasks.id, taskReminders.taskId))
    .where(
      and(
        eq(taskReminders.userId, userId),
        inArray(taskReminders.status, ["PENDING", "SENT", "SNOOZED"]),
        isNull(taskReminders.acknowledgedAt),
        sql`${at} <= ${now.toISOString()}::timestamptz`,
        sql`${at} > ${new Date(now.getTime() - 24 * 3_600_000).toISOString()}::timestamptz`,
        sql`${tasks.status} not in ('DONE', 'CANCELLED')`,
        isNull(tasks.archivedAt),
        isNull(tasks.deletedAt),
      ),
    )
    .orderBy(asc(at))
    .limit(20);
  return rows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    title: row.title,
    at: new Date(row.at).toISOString(),
    dueLabel: (row.dueTime ?? row.startTime)?.slice(0, 5) ?? null,
  }));
}

/**
 * When the next reminders will come due (within `hours`), so the open app can show each at its time without asking
 * the server every few seconds. Ids and times only.
 */
export async function upcomingInApp(
  userId: string,
  now: Date = new Date(),
  hours = 6,
): Promise<{ id: string; at: string }[]> {
  const at = sql<Date>`case when ${taskReminders.status} = 'SNOOZED' then ${taskReminders.snoozedUntil} else ${taskReminders.remindAt} end`;
  const rows = await db
    .select({ id: taskReminders.id, at })
    .from(taskReminders)
    .innerJoin(tasks, eq(tasks.id, taskReminders.taskId))
    .where(
      and(
        eq(taskReminders.userId, userId),
        inArray(taskReminders.status, ["PENDING", "SNOOZED"]),
        sql`${at} > ${now.toISOString()}::timestamptz`,
        sql`${at} <= ${new Date(now.getTime() + hours * 3_600_000).toISOString()}::timestamptz`,
        sql`${tasks.status} not in ('DONE', 'CANCELLED')`,
        isNull(tasks.archivedAt),
        isNull(tasks.deletedAt),
      ),
    )
    .orderBy(asc(at))
    .limit(50);
  return rows.map((row) => ({ id: row.id, at: new Date(row.at).toISOString() }));
}

export async function acknowledgeReminder(userId: string, id: string): Promise<void> {
  const rows = await db
    .update(taskReminders)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(taskReminders.id, id), eq(taskReminders.userId, userId)))
    .returning({ id: taskReminders.id });
  if (rows.length === 0) throw new AppError("NOT_FOUND");
}

export type SnoozeChoice = "15m" | "1h" | "tomorrow";

/** When a snooze choice ends: minutes from now, or tomorrow at the person's work start. */
export async function snoozeUntil(
  userId: string,
  choice: SnoozeChoice,
  now: Date = new Date(),
): Promise<Date> {
  if (choice === "15m") return new Date(now.getTime() + 15 * 60_000);
  if (choice === "1h") return new Date(now.getTime() + 60 * 60_000);
  const settings = await loadNotificationSettings(db, userId);
  const [prefs] = await db
    .select({ workStart: userPreferences.workStart })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  const today = getUserToday({ timezone: settings.timezone, startOfDay: "00:00" }, now);
  return dueInstant(
    addDays(today, 1),
    (prefs?.workStart ?? "09:00:00").slice(0, 5),
    settings.timezone,
  );
}

/**
 * Puts a reminder back until `until`. Allowed for one that is waiting, sent or already snoozed, on a task that is
 * still open. The person's own reminders only.
 */
export async function snoozeReminder(userId: string, id: string, until: Date): Promise<void> {
  const rows = await db
    .update(taskReminders)
    .set({ status: "SNOOZED", snoozedUntil: until, acknowledgedAt: null })
    .where(
      and(
        eq(taskReminders.id, id),
        eq(taskReminders.userId, userId),
        inArray(taskReminders.status, ["PENDING", "SENT", "SNOOZED"]),
        sql`exists (select 1 from ${tasks} where ${tasks.id} = ${taskReminders.taskId} and ${tasks.status} not in ('DONE','CANCELLED') and ${tasks.archivedAt} is null and ${tasks.deletedAt} is null)`,
      ),
    )
    .returning({ id: taskReminders.id });
  if (rows.length === 0) throw new AppError("NOT_FOUND");
}

/** The reminders waiting to be delivered: what the scan hands to the deliver job. */
export async function dueReminders(now: Date, limit = 500) {
  return db
    .select()
    .from(taskReminders)
    .where(
      or(
        and(eq(taskReminders.status, "PENDING"), lte(taskReminders.remindAt, now)),
        and(eq(taskReminders.status, "SNOOZED"), lte(taskReminders.snoozedUntil, now)),
      ),
    )
    .orderBy(asc(taskReminders.remindAt))
    .limit(limit);
}
