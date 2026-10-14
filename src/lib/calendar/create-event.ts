import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { calendarAccounts, calendarSources, calendarTaskLinks, tasks } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { getPreferences } from "@/lib/preferences";
import { hasWriteScope } from "./oauth";
import { getCalendarProvider } from "./providers";
import { accessTokenFor } from "./store";

// Creating a calendar event from a task (V2 feature 12 §7). Only after the person confirms, only with the write
// scope, and only through here: a task that changes later never changes the event on its own.

const MAX_EVENT_HOURS = 24;

export type CreateEventFromTask = {
  taskId: string;
  sourceId: string;
  start: Date;
  end: Date;
  reminderMinutes?: number;
  /** One per confirmation. A retry with the same key makes no second event. */
  idempotencyKey: string;
};

export type CreatedEvent = { providerEventId: string; htmlLink: string | null; created: boolean };

export async function createEventFromTask(
  userId: string,
  input: CreateEventFromTask,
): Promise<CreatedEvent> {
  if (!(input.end.getTime() > input.start.getTime())) {
    throw new AppError("VALIDATION_ERROR", "The event has to end after it starts.");
  }
  if (input.end.getTime() - input.start.getTime() > MAX_EVENT_HOURS * 3_600_000) {
    throw new AppError("VALIDATION_ERROR", "An event can be at most a day long.");
  }

  // Both are the person's own, or they are not found. Nothing says which one was wrong.
  const [task] = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)));
  if (!task) throw new AppError("NOT_FOUND");
  const [row] = await db
    .select({ source: calendarSources, account: calendarAccounts })
    .from(calendarSources)
    .innerJoin(calendarAccounts, eq(calendarAccounts.id, calendarSources.accountId))
    .where(and(eq(calendarSources.id, input.sourceId), eq(calendarSources.userId, userId)));
  if (!row) throw new AppError("NOT_FOUND");

  if (!hasWriteScope(row.account.scopes)) {
    throw new AppError("UNAUTHORIZED", "Allow Dayboard to create events first.");
  }
  if (row.account.status !== "ACTIVE") {
    throw new AppError("CONFLICT", "Reconnect Google Calendar first.");
  }

  // The same confirmation always names the same event, here and at Google.
  const eventId = createHash("sha256")
    .update(`${userId}:${input.taskId}:${input.idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);

  const [existing] = await db
    .select()
    .from(calendarTaskLinks)
    .where(
      and(
        eq(calendarTaskLinks.taskId, input.taskId),
        eq(calendarTaskLinks.providerEventId, eventId),
      ),
    );
  if (existing) return { providerEventId: eventId, htmlLink: null, created: false };

  const token = await accessTokenFor(row.account);
  if (!token.ok) throw new AppError("CONFLICT", "Reconnect Google Calendar first.");

  const { timezone } = await getPreferences(userId);
  const event = await getCalendarProvider().createEvent(
    { accessToken: token.accessToken },
    row.source.providerCalendarId,
    {
      eventId,
      title: task.title,
      description: `A task in Dayboard: ${env.NEXT_PUBLIC_APP_URL}/tasks?task=${task.id}`,
      start: input.start,
      end: input.end,
      timeZone: timezone,
      reminderMinutes: input.reminderMinutes,
    },
  );

  await db
    .insert(calendarTaskLinks)
    .values({
      taskId: task.id,
      userId,
      sourceId: row.source.id,
      providerEventId: event.providerEventId,
    })
    .onConflictDoNothing();
  return { providerEventId: event.providerEventId, htmlLink: event.htmlLink, created: true };
}
