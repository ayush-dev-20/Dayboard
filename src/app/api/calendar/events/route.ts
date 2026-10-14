import { z } from "zod";
import { createEventFromTask } from "@/lib/calendar/create-event";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { addDays, daysBetween, isValidDateString } from "@/lib/dates/calendar";
import { dueInstant } from "@/lib/dates/today";
import { eventDays } from "@/lib/calendar/day";
import { MAX_EVENT_RANGE_DAYS, type EventsResponseEvent } from "@/lib/calendar/dto";
import { eventsBetween } from "@/lib/calendar/store";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import { handle, readJson } from "@/lib/api-route";

export const dynamic = "force-dynamic";

const dateParam = z.string().refine(isValidDateString, "Use a date like 2026-10-14.");
const querySchema = z.object({ from: dateParam, to: dateParam });

// Cached events for a range of the person's days (at most 62), as instants. The range is widened by a day each
// side, so an all-day event (stored by its UTC date) is never missed in a far time zone.
export async function GET(request: Request) {
  return handle("calendar.events", async () => {
    if (!env.calendarAvailable) throw new AppError("NOT_FOUND");
    const user = await requireUser();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", "That date range isn't valid.");
    const { from, to } = parsed.data;
    if (to < from || daysBetween(from, to) + 1 > MAX_EVENT_RANGE_DAYS) {
      throw new AppError("VALIDATION_ERROR", `Ask for ${MAX_EVENT_RANGE_DAYS} days or fewer.`);
    }

    const { timezone } = await getPreferences(user.id);
    const events = await eventsBetween(
      user.id,
      dueInstant(addDays(from, -1), null, timezone),
      dueInstant(addDays(to, 2), null, timezone),
    );
    const withDays: EventsResponseEvent[] = events.map((event) => ({
      ...event,
      days: eventDays(event, timezone),
      localStart: event.allDay
        ? null
        : new Intl.DateTimeFormat("en-GB", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(event.startAt)),
    }));
    return Response.json({ events: withDays }, { headers: { "Cache-Control": "no-store" } });
  });
}

const createSchema = z.strictObject({
  taskId: z.uuid(),
  sourceId: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  reminderMinutes: z.number().int().min(0).max(40_320).optional(),
  idempotencyKey: z.string().min(8).max(100),
});

// Creates a calendar event from a task, after the person confirmed it in the dialog. Needs the write scope.
export async function POST(request: Request) {
  return handle("calendar.createEvent", async () => {
    if (!env.calendarAvailable) throw new AppError("NOT_FOUND");
    const user = await requireUser();
    const body = await readJson(request, createSchema);
    const created = await createEventFromTask(user.id, {
      ...body,
      start: new Date(body.start),
      end: new Date(body.end),
    });
    return Response.json(
      {
        providerEventId: created.providerEventId,
        htmlLink: created.htmlLink,
        created: created.created,
      },
      { status: created.created ? 201 : 200, headers: { "Cache-Control": "no-store" } },
    );
  });
}
