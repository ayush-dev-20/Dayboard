import Link from "next/link";
import { SectionHeading } from "@/components/today/today-lists";
import { eventDays } from "@/lib/calendar/day";
import { getStatus, eventsBetween } from "@/lib/calendar/store";
import { addDays } from "@/lib/dates/calendar";
import { dueInstant } from "@/lib/dates/today";

// "Today's events" (V2 feature 12 §6): the person's Google events for their day, above the task lists. Quiet by
// design: nothing is drawn when no calendar is connected or the day has no events. Event titles are private data,
// so this renders on the server for the signed-in person only.

function time(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export async function TodayEvents({
  userId,
  today,
  timeZone,
}: {
  userId: string;
  today: string;
  timeZone: string;
}) {
  const [status, events] = await Promise.all([
    getStatus(userId),
    eventsBetween(
      userId,
      dueInstant(addDays(today, -1), null, timeZone),
      dueInstant(addDays(today, 2), null, timeZone),
    ),
  ]);
  const account = status.accounts[0];
  if (!account) return null;

  const todays = events
    .filter((event) => eventDays(event, timeZone).includes(today))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startAt.localeCompare(b.startAt));
  const needsReconnect = account.status === "NEEDS_RECONNECT";
  if (todays.length === 0 && !needsReconnect) return null;

  return (
    <section aria-labelledby="today-events" className="mt-6" data-testid="today-events">
      <SectionHeading id="today-events" label="Today's events" count={todays.length} />
      {todays.length > 0 ? (
        <ul className="border-t border-border">
          {todays.map((event) => (
            <li
              key={event.id}
              className="flex min-h-11 items-center gap-3 border-b border-border py-2 md:min-h-row"
            >
              <span className="w-20 shrink-0 type-data-sm text-muted-foreground">
                {event.allDay
                  ? "All day"
                  : `${time(event.startAt, timeZone)}–${time(event.endAt, timeZone)}`}
              </span>
              {event.calendar.color ? (
                <span
                  aria-hidden
                  title={event.calendar.name}
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: event.calendar.color }}
                />
              ) : null}
              <span
                className={
                  event.status === "tentative"
                    ? "min-w-0 flex-1 truncate italic"
                    : "min-w-0 flex-1 truncate"
                }
              >
                {event.htmlLink ? (
                  <a
                    href={event.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${event.title}, ${event.calendar.name}, opens in Google Calendar`}
                    className="type-body-md hover:underline"
                  >
                    {event.title}
                  </a>
                ) : (
                  <span className="type-body-md">{event.title}</span>
                )}
                {event.status === "tentative" ? (
                  <span className="ml-2 type-body-sm text-muted-foreground">Maybe</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {needsReconnect ? (
        <p className="mt-2 type-body-sm text-muted-foreground">
          Google Calendar needs reconnecting.{" "}
          <Link href="/settings/calendar" className="text-primary underline">
            Reconnect
          </Link>
        </p>
      ) : null}
    </section>
  );
}
